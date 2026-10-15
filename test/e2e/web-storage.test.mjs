import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer, request as httpRequest } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import {
  DebuggerClient,
  launchPackaged,
  waitForTarget,
  waitForUi,
  waitForExpression,
  clickElement as clickWithFrames,
  assertRuntimeHealthy,
  quitPackaged,
} from "../helpers/packagedElectron.mjs";

const root = resolve(import.meta.dirname, "../..");
const user = "web-storage-e2e";
const userId = createHash("sha256").update(user).digest("hex");
const fixtureClient = crypto.randomUUID();
// These controls are static; Linux's embedded page can suspend animation frames after reload.
const clickElement = (client, expression, clickCount = 1) =>
  clickWithFrames(client, expression, clickCount, false);

async function until(predicate, message) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(25);
  }
  throw new Error(message);
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen) =>
    server.listen(0, "127.0.0.1", resolveListen),
  );
  const port = server.address().port;
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

test(
  "Web storage modes preserve separate data, never persist browser passwords, and prompt on reconnect",
  { timeout: 180_000 },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "amdm-web-storage-e2e-"));
    const clients = [];
    const requests = [];
    let database, mongo, proxy, backend, application, renderer, main;
    let backendLog = "";
    let phase = "start services";
    let evaluation = "";
    const diagnostics = join(root, "dist/e2e-validation/web-storage");
    try {
      await mkdir(diagnostics, { recursive: true });
      const binary = join(
        homedir(),
        ".cache/mongodb-binaries/mongod-arm64-darwin-8.2.1",
      );
      database = await MongoMemoryServer.create(
        existsSync(binary)
          ? { binary: { systemBinary: binary, version: "8.2.1" } }
          : undefined,
      );
      mongo = new MongoClient(database.getUri());
      await mongo.connect();
      const password = "browser-password-never-persisted";
      await mongo.db("webstorage").command({
        createUser: "browser",
        pwd: password,
        roles: [{ role: "readWrite", db: "webstorage" }],
      });
      await mongo
        .db("webstorage")
        .collection("items")
        .insertMany([{ n: 1 }, { n: 2 }, { n: 3 }]);
      const backendPort = await freePort();
      proxy = createServer((incoming, outgoing) => {
        const buffers = [];
        if (incoming.url === "/api/rpc") {
          incoming.on("data", (chunk) => buffers.push(chunk));
          incoming.on("end", () => {
            const body = JSON.parse(Buffer.concat(buffers).toString("utf8"));
            // Record only transport ownership, never credentials or query text.
            requests.push({
              method: body.method,
              storageMode: body.storageMode,
              clientId: body.clientId,
            });
          });
        }
        const upstream = httpRequest(
          {
            host: "127.0.0.1",
            port: backendPort,
            path: incoming.url,
            method: incoming.method,
            headers: { ...incoming.headers, "x-forwarded-user": user },
          },
          (response) => {
            outgoing.writeHead(response.statusCode, response.headers);
            response.pipe(outgoing);
          },
        );
        upstream.on("error", (error) => {
          if (!outgoing.destroyed) outgoing.destroy(error);
        });
        outgoing.once("close", () => upstream.destroy());
        incoming.pipe(upstream);
      });
      await new Promise((resolveListen) =>
        proxy.listen(0, "127.0.0.1", resolveListen),
      );
      const origin = `http://127.0.0.1:${proxy.address().port}`;
      const dataDir = join(profile, "server-data");
      backend = spawn(
        process.execPath,
        [join(root, "out/web-server/index.mjs")],
        {
          cwd: profile,
          env: {
            ...process.env,
            AMDM_WEB_ORIGIN: origin,
            AMDM_WEB_PORT: String(backendPort),
            AMDM_WEB_DATA_DIR: dataDir,
            AMDM_WEB_MASTER_KEY: Buffer.alloc(32, 4).toString("base64"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      backend.stdout.on("data", (chunk) => {
        backendLog += chunk;
      });
      backend.stderr.on("data", (chunk) => {
        backendLog += chunk;
      });
      await until(
        () => backendLog.includes("AMDM Web listening"),
        "Built Web server did not start",
      );
      const serverCall = async (method, ...args) => {
        const response = await fetch(`${origin}/api/rpc`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            method,
            args,
            clientId: fixtureClient,
            storageMode: "server",
          }),
        });
        const body = await response.json();
        assert.equal(body.ok, true, body.error);
        return body.result;
      };
      await serverCall("settings.update", { language: "en" });
      const serverConnection = await serverCall("connections.save", {
        id: "server-connection",
        name: "Server connection",
        host: new URL(database.getUri()).host,
        useSrv: false,
        auth: { type: "none" },
        ssh: { enabled: false },
        tls: { enabled: false },
      });
      await serverCall("queries.save", {
        name: "Server-only query",
        code: "db.serverOnly.find({})",
      });
      const statePath = join(dataDir, "users", userId, "state.json");
      const serverSnapshot = await readFile(statePath, "utf8");
      await writeFile(
        join(profile, "settings.json"),
        JSON.stringify({
          version: 1,
          settings: { language: "en", automaticUpdateChecks: false },
        }),
      );
      application = await launchPackaged(root, profile);
      // Wait for normal app startup before creating a window through the main inspector.
      await waitForTarget(
        application.rendererPort,
        (target) => target.type === "page" && target.url.startsWith("file://"),
      );
      main = await DebuggerClient.connect(
        (await waitForTarget(application.mainPort, () => true))
          .webSocketDebuggerUrl,
      );
      clients.push(main);
      // A browser page has no Electron preload. Use the app's actual Renderer engine with the same boundary.
      phase = "create Web window";
      // Native window work must run on Electron's event loop outside inspector evaluation.
      // Keep animation-frame click checks active if the desktop window takes focus.
      await main.evaluate(`setTimeout(() => {
      const { BrowserWindow } = process.getBuiltinModule('module').createRequire(${JSON.stringify(join(root, "package.json"))})('electron');
      globalThis.webStorageTestWindow = new BrowserWindow({ width: 1440, height: 900, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
      void globalThis.webStorageTestWindow.loadURL(${JSON.stringify(origin)});
    }, 0); true`);
      phase = "attach Web Renderer";
      renderer = await DebuggerClient.connect(
        (
          await waitForTarget(
            application.rendererPort,
            (target) => target.type === "page" && target.url.startsWith(origin),
          )
        ).webSocketDebuggerUrl,
      );
      clients.push(renderer);
      const evaluate = renderer.evaluate.bind(renderer);
      renderer.evaluate = async (expression) => {
        evaluation =
          expression.match(/window\.api\.[a-zA-Z]+\.[a-zA-Z]+/)?.[0] ??
          (expression.includes("requestAnimationFrame")
            ? "click layout frames"
            : "DOM evaluation");
        return evaluate(expression);
      };
      const activateWebRenderer = async () => {
        await main.evaluate(`setTimeout(() => {
          globalThis.webStorageTestWindow.show();
          globalThis.webStorageTestWindow.focus();
          globalThis.webStorageTestWindow.webContents.focus();
        }, 0); true`);
        // Hosted desktops can deny native foreground focus even when the page is visible.
        await renderer.call("Emulation.setFocusEmulationEnabled", { enabled: true });
        await waitForExpression(
          renderer,
          'document.hasFocus() && document.visibilityState === "visible"',
        );
      };
      await renderer.call("Page.enable");
      await activateWebRenderer();
      await waitForUi(renderer);
      await waitForExpression(
        renderer,
        'document.querySelector(".side-foot-version")?.textContent.includes("Server")',
      );
      assert.equal(
        await renderer.evaluate("typeof window.require"),
        "undefined",
      );
      assert.deepEqual(
        (await renderer.evaluate("window.api.connections.list()")).map(
          (connection) => connection.id,
        ),
        [serverConnection.id],
      );

      const reload = async () => {
        const previous = renderer.events.filter(
          (event) => event.method === "Page.loadEventFired",
        ).length;
        await renderer.call("Page.reload");
        await until(
          () =>
            renderer.events.filter(
              (event) => event.method === "Page.loadEventFired",
            ).length > previous,
          "Web page did not reload",
        );
        await activateWebRenderer();
        await waitForUi(renderer);
      };
      const clickButton = (label) =>
        clickElement(
          renderer,
          `[...document.querySelectorAll('button')].find((button) => button.textContent.trim() === ${JSON.stringify(label)})`,
        );
      const switchMode = async (label) => {
        phase = `open settings for ${label}`;
        await renderer.evaluate("window.api.app.openSettings()");
        phase = `select Storage section for ${label}`;
        await clickButton("Storage");
        phase = `open storage dropdown for ${label}`;
        await clickElement(
          renderer,
          `document.querySelector(${JSON.stringify('[role="combobox"][aria-label="Storage location"]')})`,
        );
        phase = `select ${label}`;
        await clickElement(
          renderer,
          `[...document.querySelectorAll('[role=option]')].find((option) => option.textContent.trim() === ${JSON.stringify(label)})`,
        );
        phase = `confirm ${label}`;
        const dialogs = renderer.events.filter(
          (event) => event.method === "Page.javascriptDialogOpening",
        ).length;
        const loads = renderer.events.filter(
          (event) => event.method === "Page.loadEventFired",
        ).length;
        const click = clickButton("Apply and reload");
        await until(
          () =>
            renderer.events.filter(
              (event) => event.method === "Page.javascriptDialogOpening",
            ).length > dialogs,
          "Storage switch confirmation did not open",
        );
        await renderer.call("Page.handleJavaScriptDialog", { accept: true });
        await click;
        await until(
          () =>
            renderer.events.filter(
              (event) => event.method === "Page.loadEventFired",
            ).length > loads,
          "Storage mode did not reload",
        );
        await activateWebRenderer();
        await waitForUi(renderer);
        phase = `verify ${label}`;
      };
      phase = "switch to browser mode";
      await switchMode("Browser storage");
      assert.deepEqual(
        await renderer.evaluate("window.api.connections.list()"),
        [],
      );
      await renderer.evaluate(
        'window.api.settings.update({ language: "en", queryLimit: 5, contextPanelWidth: 420, contextPanelOpen: false })',
      );
      const localInput = {
        id: "browser-connection",
        name: "Browser connection",
        host: new URL(database.getUri()).host,
        useSrv: false,
        auth: { type: "scram", username: "browser", authSource: "webstorage" },
        password,
        ssh: { enabled: false },
        tls: { enabled: false },
      };
      phase = "save browser connection";
      const saved = await renderer.evaluate(
        `window.api.connections.save(${JSON.stringify(localInput)})`,
      );
      assert.equal(saved.hasPassword, false);
      phase = "copy browser connection";
      const copy = await renderer.evaluate(
        `window.api.connections.save(${JSON.stringify({ ...localInput, id: "", copyFromId: saved.id, name: "Copy" })})`,
      );
      assert.notEqual(copy.id, saved.id);
      assert.equal(copy.hasPassword, false);
      await renderer.evaluate(
        'window.api.queries.save({ name: "Browser-only query", code: "db.items.find({n:1})" })',
      );
      phase = "reload browser metadata";
      await reload();
      await waitForExpression(
        renderer,
        'document.querySelector(".side-foot-version")?.textContent.includes("Browser")',
      );
      phase = "close settings after reload";
      await clickButton("Back");
      await waitForExpression(
        renderer,
        '!document.querySelector("[role=dialog]")',
      );
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".conn-item")].find((item) => item.textContent.includes("Browser connection"))',
        2,
      );
      await waitForExpression(
        renderer,
        '!!document.querySelector("form#web-connection-password input[type=password]")',
      );
      assert.equal(
        await renderer.evaluate(
          'document.querySelector("form#web-connection-password input").value',
        ),
        "",
      );
      await clickElement(
        renderer,
        'document.querySelector("form#web-connection-password input")',
      );
      await renderer.call("Input.insertText", { text: password });
      await clickElement(
        renderer,
        'document.querySelector("button[form=web-connection-password]")',
      );
      await waitForExpression(
        renderer,
        '!!document.querySelector(".conn-status[aria-label=Connected]")',
      );
      phase = "execute browser query";
      const result = await renderer.evaluate(
        `window.api.shell.execute({ connectionId: ${JSON.stringify(saved.id)}, database: 'webstorage', code: 'db.items.find({}).sort({n:1})', pageSize: 2, execId: crypto.randomUUID() })`,
      );
      assert.equal(result.count, 2);
      phase = "page browser query";
      const page = await renderer.evaluate(
        `window.api.shell.page({ resultId: ${JSON.stringify(result.resultId)}, skip: 2, pageSize: 2, execId: crypto.randomUUID() })`,
      );
      assert.deepEqual(page.data[0].n, { $numberInt: "3" });
      const target = {
        connectionId: saved.id,
        database: "webstorage",
        collection: "items",
      };
      phase = "analyze browser schema";
      await renderer.evaluate(
        `window.api.schemas.analyze(${JSON.stringify(target)})`,
      );
      await renderer.evaluate(
        `window.api.schemas.saveDraft(${JSON.stringify(target)}, { bsonType: 'object', required: ['n'] })`,
      );
      assert.equal(
        (await renderer.evaluate("window.api.history.list()")).length,
        1,
      );
      phase = "inspect persisted IndexedDB";
      const persisted = await renderer.evaluate(`(async () => {
      const db = await new Promise((resolve, reject) => { const request = indexedDB.open('amdm-web:${userId}'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
      const data = await Promise.all([...db.objectStoreNames].map((name) => new Promise((resolve, reject) => { const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); })));
      db.close(); return JSON.stringify(data);
    })()`);
      assert.doesNotMatch(persisted, /browser-password-never-persisted/);
      assert.equal(await readFile(statePath, "utf8"), serverSnapshot);
      const oldClient = requests
        .filter(
          (request) =>
            request.storageMode === "browser" &&
            request.method === "session.connect",
        )
        .at(-1).clientId;
      phase = "reconnect after reload";
      await reload();
      if (
        await renderer.evaluate(
          '[...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Back")',
        )
      )
        await clickButton("Back");
      assert.deepEqual(
        (await renderer.evaluate("window.api.queries.list()")).map(
          (query) => query.name,
        ),
        ["Browser-only query"],
      );
      assert.deepEqual(
        (
          await renderer.evaluate(
            `window.api.schemas.get(${JSON.stringify(target)})`,
          )
        ).draft.required,
        ["n"],
      );
      assert.equal(
        (await renderer.evaluate("window.api.settings.get()"))
          .contextPanelWidth,
        420,
      );
      assert.equal(
        (await renderer.evaluate("window.api.history.list()")).length,
        1,
      );
      const browserStatus = async () => {
        const response = await fetch(`${origin}/api/rpc`, {
          method: "POST",
          headers: { origin, "content-type": "application/json" },
          body: JSON.stringify({
            method: "session.status",
            args: [saved.id],
            clientId: oldClient,
            storageMode: "browser",
            storageOwner: userId,
            queryTimeoutMS: 30_000,
          }),
        });
        return (await response.json()).result;
      };
      await until(
        async () => (await browserStatus()).state === "disconnected",
        "Reload retained the old browser connection",
      );
      const connects = requests.filter(
        (request) =>
          request.storageMode === "browser" &&
          request.method === "session.connect",
      ).length;
      await clickElement(
        renderer,
        '[...document.querySelectorAll(".conn-item")].find((item) => item.textContent.includes("Browser connection"))',
        2,
      );
      await waitForExpression(
        renderer,
        '!!document.querySelector("form#web-connection-password input[type=password]")',
      );
      assert.equal(
        await renderer.evaluate(
          'document.querySelector("form#web-connection-password input").value',
        ),
        "",
      );
      await clickButton("Cancel");
      await waitForExpression(
        renderer,
        '!document.querySelector("form#web-connection-password")',
      );
      assert.equal(
        requests.filter(
          (request) =>
            request.storageMode === "browser" &&
            request.method === "session.connect",
        ).length,
        connects,
      );
      assert.equal(
        (
          await renderer.evaluate(
            `window.api.session.status(${JSON.stringify(saved.id)})`,
          )
        ).state,
        "disconnected",
      );
      assert.deepEqual(
        requests.filter(
          (request) =>
            request.storageMode === "browser" &&
            /^(connections\.(save|list|delete)|queries\.|history\.|settings\.|schemas\.(get|saveDraft|overwriteDraft))/.test(
              request.method,
            ),
        ),
        [],
      );
      await switchMode("Server storage (default)");
      assert.deepEqual(
        (await renderer.evaluate("window.api.connections.list()")).map(
          (connection) => connection.name,
        ),
        ["Server connection"],
      );
      assert.deepEqual(
        (await renderer.evaluate("window.api.queries.list()")).map(
          (query) => query.name,
        ),
        ["Server-only query"],
      );
      assert.equal(await readFile(statePath, "utf8"), serverSnapshot);
      await switchMode("Browser storage");
      assert.equal(
        (await renderer.evaluate("window.api.connections.list()")).length,
        2,
      );
      assert.deepEqual(
        (await renderer.evaluate("window.api.queries.list()")).map(
          (query) => query.name,
        ),
        ["Browser-only query"],
      );
      await renderer.evaluate(
        `window.api.connections.delete(${JSON.stringify(copy.id)})`,
      );
      await renderer.evaluate("window.api.history.clear()");
      assert.equal(
        (await renderer.evaluate("window.api.connections.list()")).length,
        1,
      );
      assert.deepEqual(
        await renderer.evaluate("window.api.history.list()"),
        [],
      );
      assertRuntimeHealthy(clients, application);
      assert.doesNotMatch(
        backendLog,
        /Cannot find module|ERR_MODULE_NOT_FOUND/,
      );
      const screenshot = await renderer.call("Page.captureScreenshot", {
        format: "png",
      });
      await writeFile(
        join(diagnostics, "storage.png"),
        Buffer.from(screenshot.data, "base64"),
      );
      await quitPackaged(application, main, clients);
      application = undefined;
    } catch (error) {
      const failedEvaluation = evaluation;
      error.message = `${phase} (${failedEvaluation}): ${error.message}`;
      const [pageState] = await Promise.allSettled([
        renderer?.evaluate(`({
          url: location.href,
          focused: document.hasFocus(),
          visibility: document.visibilityState,
          history: window.history.state,
          dialogs: [...document.querySelectorAll('[role=dialog]')].map(dialog => dialog.textContent),
          activeElement: document.activeElement?.outerHTML
        })`),
      ]);
      await writeFile(
        join(diagnostics, "failure.log"),
        `Phase: ${phase}\nEvaluation: ${failedEvaluation}\nPage: ${JSON.stringify(pageState)}\nRequests: ${JSON.stringify(requests)}\n${error.stack}\n${backendLog}\n${application?.logs ?? ""}`,
      );
      throw error;
    } finally {
      for (const client of clients) client.close();
      await application?.stop();
      if (backend?.exitCode == null) {
        const stopped = once(backend, "exit");
        backend.kill("SIGTERM");
        await Promise.race([stopped, delay(5_000)]);
        if (backend.exitCode == null) backend.kill("SIGKILL");
      }
      if (proxy) await new Promise((resolveClose) => proxy.close(resolveClose));
      await mongo?.close();
      await database?.stop();
      await rm(profile, { recursive: true, force: true });
    }
  },
);
