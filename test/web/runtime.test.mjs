import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { MongoMemoryServer } from "mongodb-memory-server";
import { MongoClient } from "mongodb";

const root = resolve(import.meta.dirname, "../..");

test(
  "built Web server runs outside the repository, serves paged results and stops with an open event stream",
  { timeout: 120_000 },
  async () => {
    const profile = await mkdtemp(join(tmpdir(), "amdm-web-runtime-"));
    const binary = join(
      homedir(),
      ".cache/mongodb-binaries/mongod-arm64-darwin-8.2.1",
    );
    let mongo, database, server, events;
    let log = "";
    try {
      mongo = await MongoMemoryServer.create(
        existsSync(binary)
          ? { binary: { systemBinary: binary, version: "8.2.1" } }
          : undefined,
      );
      database = new MongoClient(mongo.getUri());
      await database.connect();
      await database
        .db("runtime")
        .collection("items")
        .insertMany([{ n: 1 }, { n: 2 }, { n: 3 }]);
      const reservation = createServer();
      await new Promise((resolveListen) =>
        reservation.listen(0, "127.0.0.1", resolveListen),
      );
      const port = reservation.address().port;
      await new Promise((resolveClose) => reservation.close(resolveClose));
      const origin = `http://127.0.0.1:${port}`;
      server = spawn(
        process.execPath,
        [join(root, "out/web-server/index.mjs")],
        {
          cwd: profile,
          env: {
            ...process.env,
            AMDM_WEB_ORIGIN: origin,
            AMDM_WEB_PORT: String(port),
            AMDM_WEB_DATA_DIR: join(profile, "data"),
            AMDM_WEB_MASTER_KEY: Buffer.alloc(32, 8).toString("base64"),
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      server.stdout.on("data", (chunk) => {
        log += chunk;
      });
      server.stderr.on("data", (chunk) => {
        log += chunk;
      });
      await new Promise((resolveReady, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`Web startup timed out: ${log}`)),
          10_000,
        );
        server.once("exit", (code) => {
          clearTimeout(timer);
          reject(new Error(`Web exited ${code}: ${log}`));
        });
        server.stdout.on("data", () => {
          if (log.includes("AMDM Web listening")) {
            clearTimeout(timer);
            resolveReady();
          }
        });
      });
      const clientId = crypto.randomUUID();
      const call = async (method, ...args) => {
        const response = await fetch(`${origin}/api/rpc`, {
          method: "POST",
          headers: {
            origin,
            "content-type": "application/json",
            "x-forwarded-user": "runtime",
          },
          body: JSON.stringify({ method, args, clientId, storageMode: 'server' }),
        });
        const body = await response.json();
        assert.equal(body.ok, true, JSON.stringify(body));
        return body.result;
      };
      assert.match(await (await fetch(origin)).text(), /AMDM/);
      const connection = await call("connections.save", {
        id: "",
        name: "Runtime",
        useSrv: false,
        host: new URL(mongo.getUri()).host,
        auth: { type: "none" },
        ssh: { enabled: false },
        tls: { enabled: false },
      });
      assert.equal(
        (await call("session.connect", connection.id)).state,
        "connected",
      );
      events = await fetch(`${origin}/api/events?clientId=${clientId}&storageMode=server`, {
        headers: { "x-forwarded-user": "runtime" },
      });
      assert.equal(events.status, 200);
      assert.ok(
        (
          await call("catalog.sampleFields", connection.id, "runtime", "items")
        ).includes("n"),
      );
      const result = await call("shell.execute", {
        connectionId: connection.id,
        database: "runtime",
        code: "db.items.find({}).sort({ n: 1 })",
        pageSize: 2,
        execId: crypto.randomUUID(),
      });
      assert.equal(result.kind, "documents");
      assert.equal(result.count, 2);
      const page = await call("shell.page", {
        resultId: result.resultId,
        skip: 2,
        pageSize: 2,
        execId: crypto.randomUUID(),
      });
      assert.equal(page.count, 1);
      assert.deepEqual(page.data[0].n, { $numberInt: "3" });
      const stopped = once(server, "exit");
      if (process.platform === "win32") {
        // child.kill() terminates Windows processes without delivering a signal.
        await events.body.cancel();
        await call("session.disconnect", connection.id);
      }
      server.kill("SIGTERM");
      const [code] = await Promise.race([
        stopped,
        new Promise((_, reject) => {
          const timer = setTimeout(
            () => reject(new Error(`Web shutdown timed out: ${log}`)),
            10_000,
          );
          timer.unref();
        }),
      ]);
      if (process.platform !== "win32") assert.equal(code, 0, log);
      assert.doesNotMatch(
        log,
        /Cannot find module|ERR_MODULE_NOT_FOUND|serializer worker exited/,
      );
    } finally {
      await events?.body?.cancel().catch(() => {});
      if (server?.exitCode == null) server?.kill("SIGKILL");
      await database?.close();
      await mongo?.stop();
      await rm(profile, { recursive: true, force: true });
    }
  },
);
