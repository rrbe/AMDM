import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type {
  AppSettings,
  ConnectionInput,
  DocMutateRequest,
  DocReadRequest,
  SchemaTarget,
  ShellPageRequest,
  DocSetFieldRequest,
  DocUpdateRequest,
  SavedQueryInput,
  ShellRequest,
} from "../shared/types";
import { SessionManager } from "../main/mongo/sessionManager";
import {
  estimateCollectionCount,
  dropCollection,
  listCollections,
  listDatabases,
  listIndexes,
  listUsers,
  sampleFields,
} from "../main/mongo/catalog";
import {
  abortShell,
  executeShell,
  readShellPage,
  readShellTotal,
  releaseShellResult,
} from "../main/mongo/shellEngine";
import {
  deleteDocumentOnDb,
  setFieldOnDb,
  replaceDocumentOnDb,
  readDocumentOnDb,
} from "../main/mongo/docOpsCore";
import { analyzeCollectionSchemaOnDb } from "../main/mongo/schemaAnalysisCore";
import { serializerPool } from "../main/workers/serializerPool";
import { shellResults } from "../main/mongo/shellResults";
import {
  schemaTargetKey,
  cloneMongoJsonSchema,
} from "../shared/schemaStoreCore";
import { WebStore } from "./webStore";
import { BrowserSessions } from "./browserSessions";
import { QUERY_TIMEOUTS_MS } from "../shared/types";
import {
  webHistorySummary,
  type WebRpcRequest,
  type WebStorageMode,
} from "../shared/webStorage";
import type { DecryptedConnection } from "../main/mongo/uri";

const MAX_BODY_BYTES = 1024 * 1024;

const MIME: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface WebServerOptions {
  store: WebStore;
  origin: string;
  staticDir: string;
}

interface RequestContext {
  mode: WebStorageMode;
  owner: string;
  browser: BrowserSessions;
  sessionId(id: string): string;
  decryptedInput(input: ConnectionInput): DecryptedConnection;
  timeoutMS(): number;
  active(): boolean;
  onResponseClose(listener: () => void): () => void;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(data);
}

function readBody(req: IncomingMessage): Promise<WebRpcRequest> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("Request body is too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        const value = JSON.parse(
          Buffer.concat(chunks).toString("utf8"),
        ) as Partial<WebRpcRequest>;
        if (
          !value ||
          typeof value.method !== "string" ||
          !Array.isArray(value.args) ||
          typeof value.clientId !== "string" ||
          !/^[a-f0-9-]{36}$/i.test(value.clientId) ||
          !["server", "browser"].includes(value.storageMode ?? "") ||
          (value.storageMode === "browser" &&
            (!QUERY_TIMEOUTS_MS.includes(
              value.queryTimeoutMS as (typeof QUERY_TIMEOUTS_MS)[number],
            ) ||
              typeof value.storageOwner !== "string"))
        ) {
          throw new Error("Invalid RPC request.");
        }
        resolveBody({
          method: value.method,
          args: value.args,
          clientId: value.clientId,
          storageMode: value.storageMode!,
          storageOwner: value.storageOwner,
          queryTimeoutMS: value.queryTimeoutMS,
        });
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function userFrom(req: IncomingMessage): string {
  const raw = req.headers["x-forwarded-user"];
  if (typeof raw !== "string") throw new Error("Authentication required.");
  const user = raw.trim();
  if (!user || user.length > 256 || /[\u0000-\u001f\u007f]/.test(user)) {
    throw new Error("Invalid authenticated user.");
  }
  return user;
}

function objectArg(args: unknown[], index: number): Record<string, unknown> {
  const value = args[index];
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid RPC arguments.");
  return value as Record<string, unknown>;
}

function stringArg(args: unknown[], index: number): string {
  const value = args[index];
  if (typeof value !== "string" || !value)
    throw new Error("Invalid RPC arguments.");
  return value;
}

function connectionInput(args: unknown[], index = 0): ConnectionInput {
  const value = objectArg(args, index);
  const auth = value.auth as Record<string, unknown> | undefined;
  const ssh = value.ssh as Record<string, unknown> | undefined;
  const tls = value.tls as Record<string, unknown> | undefined;
  if (
    typeof value.id !== "string" ||
    typeof value.name !== "string" ||
    !value.name.trim() ||
    typeof value.host !== "string" ||
    !value.host.trim() ||
    typeof value.useSrv !== "boolean" ||
    !auth ||
    !["none", "scram"].includes(String(auth.type)) ||
    !ssh ||
    ssh.enabled !== false ||
    !tls ||
    typeof tls.enabled !== "boolean"
  ) {
    throw new Error("Invalid connection input.");
  }
  if (value.options) {
    const options = objectArg([value.options], 0);
    if (Object.values(options).some((item) => typeof item !== "string")) {
      throw new Error("Invalid connection options.");
    }
  }
  return value as unknown as ConnectionInput;
}

function shellRequest(args: unknown[], context: RequestContext): ShellRequest {
  const value = objectArg(args, 0);
  const connectionId = String(value.connectionId ?? "");
  const database = String(value.database ?? "");
  const code = value.code;
  if (!connectionId || !database || typeof code !== "string")
    throw new Error("Invalid Shell request.");
  return {
    ...(value as unknown as ShellRequest),
    connectionId: context.sessionId(connectionId),
    execId:
      typeof value.execId === "string" && value.execId
        ? `${context.owner}:${value.execId}`
        : undefined,
  };
}

function documentRequest<T extends DocMutateRequest>(
  args: unknown[],
  context: RequestContext,
): { externalConnectionId: string; request: T } {
  const value = objectArg(args, 0);
  const connectionId = String(value.connectionId ?? "");
  if (
    !connectionId ||
    typeof value.database !== "string" ||
    !value.database ||
    typeof value.collection !== "string" ||
    !value.collection ||
    !("id" in value)
  ) {
    throw new Error("Invalid document request.");
  }
  return {
    externalConnectionId: connectionId,
    request: {
      ...value,
      connectionId: context.sessionId(connectionId),
    } as unknown as T,
  };
}

function ownerId(user: string): string {
  return createHash("sha256").update(user).digest("hex");
}

interface ReadTask {
  connectionId: string;
  controller: AbortController;
}

async function dispatch(
  store: WebStore,
  sessions: SessionManager,
  user: string,
  method: string,
  args: unknown[],
  reads: Map<string, ReadTask>,
  context: RequestContext,
): Promise<unknown> {
  const { owner } = context;
  if (method === "app.context") return { userId: ownerId(user) };
  if (
    context.mode === "browser" &&
    ([
      "connections.list",
      "connections.save",
      "connections.delete",
      "connections.buildUri",
      "schemas.get",
      "schemas.saveDraft",
      "schemas.overwriteDraft",
    ].includes(method) ||
      method.startsWith("queries.") ||
      method.startsWith("history.") ||
      method.startsWith("settings."))
  )
    throw new Error("Browser metadata is stored only in IndexedDB.");
  switch (method) {
    case "connections.list":
      return store.listConnections(user);
    case "connections.save":
      return store.saveConnection(user, connectionInput(args));
    case "connections.delete": {
      const id = stringArg(args, 0);
      const sessionId = context.sessionId(id);
      for (const task of reads.values())
        if (task.connectionId === sessionId) task.controller.abort();
      await sessions.disconnect(sessionId);
      store.deleteConnection(user, id);
      return;
    }
    case "connections.cachedAuthorization":
      return sessions.cachedAuthorization(
        context.decryptedInput(connectionInput(args)),
      );
    case "connections.test":
      return sessions.test(context.decryptedInput(connectionInput(args)));
    case "connections.buildUri":
      return store.buildConnectionUri(
        user,
        connectionInput(args),
        objectArg(args, 1).includePassword === true,
      );
    case "session.connect": {
      if (context.mode === "browser") {
        if (!context.active())
          throw new Error("The browser page is closed. Reload AMDM.");
        const input = connectionInput(args);
        const connection = context.browser.register(owner, input);
        let connected = false;
        const unsubscribe = context.onResponseClose(() => {
          if (context.browser.getDecrypted(connection.config.id) !== connection)
            return;
          context.browser.forget(connection.config.id, connection);
          void sessions.disconnect(connection.config.id);
        });
        try {
          const status = await sessions.connect(connection.config.id);
          connected = status.state === "connected";
          return { ...status, id: input.id };
        } finally {
          unsubscribe();
          if (!connected)
            context.browser.forget(connection.config.id, connection);
        }
      }
      const id = stringArg(args, 0);
      const status = await sessions.connect(context.sessionId(id));
      return { ...status, id };
    }
    case "session.disconnect": {
      const id = context.sessionId(stringArg(args, 0));
      for (const task of reads.values())
        if (task.connectionId === id) task.controller.abort();
      const current = context.browser.getDecrypted(id);
      await sessions.disconnect(id);
      if (current) context.browser.forget(id, current);
      return;
    }
    case "session.authorization":
      return sessions.authorization(
        context.sessionId(stringArg(args, 0)),
        context.decryptedInput(connectionInput(args, 1)),
      );
    case "session.status": {
      const id = stringArg(args, 0);
      return { ...sessions.getStatus(context.sessionId(id)), id };
    }
    case "catalog.databases":
      return listDatabases(context.sessionId(stringArg(args, 0)), sessions);
    case "catalog.collections":
      return listCollections(
        context.sessionId(stringArg(args, 0)),
        stringArg(args, 1),
        sessions,
      );
    case "catalog.collectionCount":
      return estimateCollectionCount(
        context.sessionId(stringArg(args, 0)),
        stringArg(args, 1),
        stringArg(args, 2),
        sessions,
      );
    case "catalog.dropCollection": {
      const connectionId = stringArg(args, 0);
      const database = stringArg(args, 1);
      const collection = stringArg(args, 2);
      let ok = false;
      try {
        await dropCollection(
          context.sessionId(connectionId),
          database,
          collection,
          {
            timeoutMS: context.timeoutMS(),
            signal: AbortSignal.timeout(30_000),
          },
          sessions,
        );
        ok = true;
      } finally {
        store.audit({
          user,
          action: "collection:drop",
          connectionId,
          database,
          collection,
          ok,
        });
      }
      return;
    }
    case "schemas.get":
    case "schemas.analyze":
    case "schemas.saveDraft":
    case "schemas.overwriteDraft": {
      const target = objectArg(args, 0) as unknown as SchemaTarget;
      schemaTargetKey(target);
      const connectionId = context.sessionId(target.connectionId);
      if (method === "schemas.get") return store.getSchema(user, target);
      if (method === "schemas.analyze") {
        const analysis = await analyzeCollectionSchemaOnDb(
          sessions.getClient(connectionId).db(target.database),
          target.collection,
          context.timeoutMS(),
        );
        return context.mode === "browser"
          ? analysis
          : store.saveSchemaAnalysis(user, target, analysis);
      }
      return store.saveSchemaDraft(
        user,
        target,
        method === "schemas.saveDraft"
          ? cloneMongoJsonSchema(args[1])
          : undefined,
      );
    }
    case "catalog.indexes":
      return listIndexes(
        context.sessionId(stringArg(args, 0)),
        stringArg(args, 1),
        stringArg(args, 2),
        sessions,
      );
    case "catalog.users":
      return listUsers(
        context.sessionId(stringArg(args, 0)),
        stringArg(args, 1),
        sessions,
      );
    case "catalog.sampleFields":
      return sampleFields(
        context.sessionId(stringArg(args, 0)),
        stringArg(args, 1),
        stringArg(args, 2),
        sessions,
      );
    case "shell.execute": {
      const external = objectArg(args, 0);
      const request = shellRequest(args, context);
      let ok = false;
      try {
        const result = await executeShell(request, owner, sessions);
        ok = result.kind !== "error";
        if (context.mode === "server")
          store.addHistory(user, {
            code: request.code,
            connectionId: String(external.connectionId),
            database: request.database,
            ok,
            summary: webHistorySummary(
              result.kind,
              result.count,
              result.elapsedMs,
              result.errorName,
            ),
          });
        return result;
      } finally {
        store.audit({
          user,
          action: "shell",
          connectionId: String(external.connectionId),
          database: request.database,
          ok,
        });
      }
    }
    case "shell.page": {
      const request = objectArg(args, 0) as unknown as ShellPageRequest;
      return readShellPage(
        { ...request, execId: `${owner}:${request.execId}` },
        owner,
      );
    }
    case "shell.total":
      return readShellTotal(stringArg(args, 0), owner);
    case "shell.release":
      return releaseShellResult(stringArg(args, 0), owner);
    case "shell.abort":
      return abortShell(`${owner}:${stringArg(args, 0)}`);
    case "queries.list":
      return store.listQueries(user);
    case "queries.save": {
      const input = objectArg(args, 0) as unknown as SavedQueryInput;
      if (typeof input.name !== "string" || typeof input.code !== "string")
        throw new Error("Invalid saved query.");
      if (input.connectionId) context.sessionId(input.connectionId);
      return store.saveQuery(user, input);
    }
    case "queries.delete":
      return store.deleteQuery(user, stringArg(args, 0));
    case "history.list":
      return store.listHistory(user);
    case "history.clear":
      return store.clearHistory(user);
    case "docs.cancelRead": {
      const task = reads.get(`${owner}:${stringArg(args, 0)}`);
      if (!task) return false;
      task.controller.abort();
      return true;
    }
    case "docs.read": {
      const { request } = documentRequest<DocReadRequest>(args, context);
      if (typeof request.taskId !== "string" || !request.taskId)
        throw new Error("Missing document refresh task id.");
      const key = `${owner}:${request.taskId}`;
      const controller = new AbortController();
      reads.get(key)?.controller.abort();
      reads.set(key, { connectionId: request.connectionId, controller });
      try {
        const document = await readDocumentOnDb(
          sessions.getClient(request.connectionId).db(request.database),
          request.collection,
          request.id,
          {
            signal: controller.signal,
            timeoutMS: context.timeoutMS(),
          },
        );
        return document === null
          ? { ok: true, found: false }
          : {
              ok: true,
              found: true,
              document: await serializerPool.serializeOne(document),
            };
      } catch (error) {
        return {
          ok: false,
          found: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        if (reads.get(key)?.controller === controller) reads.delete(key);
      }
    }
    case "docs.update": {
      const { externalConnectionId, request } =
        documentRequest<DocUpdateRequest>(args, context);
      if (typeof request.documentEjson !== "string")
        throw new Error("Invalid document update.");
      const result = await replaceDocumentOnDb(
        sessions.getClient(request.connectionId).db(request.database),
        request.collection,
        request.id,
        request.documentEjson,
      );
      store.audit({
        user,
        action: "doc:update",
        connectionId: externalConnectionId,
        database: request.database,
        collection: request.collection,
        documentId: request.id,
        ok: result.ok,
      });
      return result;
    }
    case "docs.setField": {
      const { externalConnectionId, request } =
        documentRequest<DocSetFieldRequest>(args, context);
      if (
        typeof request.path !== "string" ||
        typeof request.valueEjson !== "string"
      ) {
        throw new Error("Invalid document field update.");
      }
      const result = await setFieldOnDb(
        sessions.getClient(request.connectionId).db(request.database),
        request.collection,
        request.id,
        request.path,
        request.valueEjson,
      );
      store.audit({
        user,
        action: "doc:setField",
        connectionId: externalConnectionId,
        database: request.database,
        collection: request.collection,
        documentId: request.id,
        ok: result.ok,
      });
      return result;
    }
    case "docs.delete": {
      const { externalConnectionId, request } =
        documentRequest<DocMutateRequest>(args, context);
      const result = await deleteDocumentOnDb(
        sessions.getClient(request.connectionId).db(request.database),
        request.collection,
        request.id,
      );
      store.audit({
        user,
        action: "doc:delete",
        connectionId: externalConnectionId,
        database: request.database,
        collection: request.collection,
        documentId: request.id,
        ok: result.ok,
      });
      return result;
    }
    case "settings.get":
      return store.getSettings(user);
    case "settings.update":
      return store.updateSettings(
        user,
        objectArg(args, 0) as Partial<AppSettings>,
      );
    default:
      throw new Error("Unsupported RPC method.");
  }
}

function serveStatic(
  staticDir: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  let pathname: string;
  try {
    pathname = decodeURIComponent(
      new URL(req.url ?? "/", "http://localhost").pathname,
    );
  } catch {
    res.writeHead(400).end();
    return;
  }
  const root = resolve(staticDir);
  let path = resolve(root, `.${pathname}`);
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    res.writeHead(404).end();
    return;
  }
  if (!existsSync(path) || statSync(path).isDirectory())
    path = resolve(root, "index.html");
  if (!existsSync(path)) {
    res.writeHead(404).end();
    return;
  }
  const extension = extname(path);
  const accepted = new Map(
    (req.headers["accept-encoding"] ?? "").toLowerCase().split(",").map((entry) => {
      const [name, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((value) => value.trim().startsWith("q="));
      const weight = quality ? Number(quality.trim().slice(2)) : 1;
      return [name.trim(), Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0];
    }),
  );
  const variants = [
    { encoding: "br", suffix: ".br" },
    { encoding: "gzip", suffix: ".gz" },
  ].map((variant) => ({ ...variant, quality: accepted.get(variant.encoding) ?? accepted.get("*") ?? 0 }))
    .filter((variant) => variant.quality > 0 && variant.quality >= (accepted.get("identity") ?? 0))
    .sort((a, b) => b.quality - a.quality);
  const variant = variants.find((variant) => existsSync(path + variant.suffix));
  if (!variant && (accepted.get("identity") === 0 || (!accepted.has("identity") && accepted.get("*") === 0))) {
    res.writeHead(406, { vary: "Accept-Encoding" }).end();
    return;
  }
  if (variant) path += variant.suffix;
  const size = statSync(path).size;
  res.writeHead(200, {
    "content-type": MIME[extension] ?? "application/octet-stream",
    "content-length": size,
    ...(variant ? { "content-encoding": variant.encoding } : {}),
    vary: "Accept-Encoding",
    "cache-control":
      extension === ".html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    "content-security-policy":
      "default-src 'self'; img-src 'self' http: https:; media-src 'self' http: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  const stream = createReadStream(path);
  stream.once("error", (error) => res.destroy(error));
  res.once("close", () => stream.destroy());
  stream.pipe(res);
}

export function createWebRequestHandler({
  store,
  origin,
  staticDir,
}: WebServerOptions) {
  const browser = new BrowserSessions();
  const sessions = new SessionManager({
    getDecrypted: (id) =>
      id.startsWith("browser:")
        ? browser.getDecrypted(id)
        : store.getDecrypted(id),
  });
  const reads = new Map<string, ReadTask>();
  const streams = new Map<
    ServerResponse,
    { user: string; mode: WebStorageMode; owner: string }
  >();
  const requestContext = (
    user: string,
    clientId: string,
    mode: WebStorageMode,
    queryTimeoutMS: number | undefined,
    response: ServerResponse,
  ): RequestContext => {
    const owner = `${ownerId(user)}:${clientId}:${mode}`;
    return {
      mode,
      owner,
      browser,
      active: () =>
        [...streams.values()].some((stream) => stream.owner === owner),
      onResponseClose: (listener) => {
        response.once("close", listener);
        return () => {
          response.removeListener("close", listener);
        };
      },
      sessionId: (id) =>
        mode === "browser"
          ? browser.sessionId(owner, id)
          : store.sessionId(user, id),
      decryptedInput: (input) =>
        mode === "browser"
          ? browser.decryptedInput(owner, input)
          : store.decryptedInput(user, input),
      timeoutMS: () =>
        (mode === "browser"
          ? queryTimeoutMS
          : store.getSettings(user).queryTimeoutMS) || 30_000,
    };
  };
  const closeBrowserOwner = async (owner: string): Promise<void> => {
    for (const id of browser.ids(owner)) {
      const current = browser.getDecrypted(id);
      await sessions.disconnect(id);
      if (current) browser.forget(id, current);
    }
  };
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === "/healthz") {
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && req.url?.split("?")[0] === "/api/events") {
      try {
        if (req.headers.origin && req.headers.origin !== origin)
          throw new Error("Invalid request origin.");
        const user = userFrom(req);
        const params = new URL(req.url!, origin).searchParams;
        const mode = params.get("storageMode");
        if (mode !== "server" && mode !== "browser")
          throw new Error("Invalid storage mode.");
        if (mode === "browser" && params.get("storageOwner") !== ownerId(user))
          throw new Error("Authenticated user changed. Reload AMDM.");
        const clientId = params.get("clientId");
        if (!clientId || !/^[a-f0-9-]{36}$/i.test(clientId))
          throw new Error("Invalid client id.");
        const context = requestContext(user, clientId, mode, undefined, res);
        const { owner } = context;
        const prefix =
          mode === "browser" ? `browser:${owner}:` : `${ownerId(user)}:`;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        res.write(": connected\n\n");
        streams.set(res, { user, mode, owner });
        const sessionIds =
          mode === "browser"
            ? browser.ids(owner)
            : store
                .listConnections(user)
                .map((connection) => context.sessionId(connection.id));
        for (const id of sessionIds) {
          res.write(
            `data: ${JSON.stringify({ ...sessions.getStatus(id), id: id.slice(prefix.length) })}\n\n`,
          );
        }
        const unsubscribe = sessions.onStatusChanged((status) => {
          if (!status.id.startsWith(prefix)) return;
          if (
            !res.write(
              `data: ${JSON.stringify({ ...status, id: status.id.slice(prefix.length) })}\n\n`,
            )
          )
            res.end();
        });
        const heartbeat = setInterval(() => {
          if (!res.write(": heartbeat\n\n")) res.end();
        }, 15_000);
        heartbeat.unref();
        res.once("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
          streams.delete(res);
          for (const [key, task] of reads)
            if (key.startsWith(`${owner}:`)) task.controller.abort();
          void shellResults.closeOwner(owner);
          if (mode === "browser") {
            void closeBrowserOwner(owner);
          } else if (
            ![...streams.values()].some(
              (stream) => stream.user === user && stream.mode === "server",
            )
          ) {
            for (const connection of store.listConnections(user))
              void sessions.disconnect(context.sessionId(connection.id));
          }
        });
      } catch (error) {
        sendJson(res, 400, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return;
    }
    if (req.method !== "POST" || req.url !== "/api/rpc") {
      if (req.method === "GET" || req.method === "HEAD")
        serveStatic(staticDir, req, res);
      else sendJson(res, 404, { ok: false, error: "Not found." });
      return;
    }

    try {
      if (req.headers.origin !== origin)
        throw new Error("Invalid request origin.");
      if (
        !req.headers["content-type"]
          ?.toLowerCase()
          .startsWith("application/json")
      ) {
        throw new Error("Content-Type must be application/json.");
      }
      const user = userFrom(req);
      const body = await readBody(req);
      if (body.storageMode === "browser" && body.storageOwner !== ownerId(user))
        throw new Error("Authenticated user changed. Reload AMDM.");
      const result = await dispatch(
        store,
        sessions,
        user,
        body.method,
        body.args,
        reads,
        requestContext(
          user,
          body.clientId,
          body.storageMode,
          body.queryTimeoutMS,
          res,
        ),
      );
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  return {
    handle,
    closeSessions: async () => {
      for (const stream of streams.keys()) stream.end();
      for (const task of reads.values()) task.controller.abort();
      await sessions.closeAll();
      browser.clear();
    },
  };
}

export function createWebServer(options: WebServerOptions) {
  const app = createWebRequestHandler(options);
  return { server: createServer(app.handle), closeSessions: app.closeSessions };
}
