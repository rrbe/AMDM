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
} from "../main/store/schemaStoreCore";
import { WebStore } from "./webStore";

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

interface RpcBody {
  clientId: string;
  method: string;
  args: unknown[];
}

function historySummary(
  kind: string,
  count?: number,
  elapsedMs?: number,
  errorName?: string,
): string {
  if (kind === "documents") return `${count ?? 0} docs · ${elapsedMs ?? 0}ms`;
  if (kind === "explain") return `explain · ${elapsedMs ?? 0}ms`;
  if (kind === "error") return errorName ?? "error";
  return `${kind} · ${elapsedMs ?? 0}ms`;
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

function readBody(req: IncomingMessage): Promise<RpcBody> {
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
        ) as Partial<RpcBody>;
        if (
          !value ||
          typeof value.method !== "string" ||
          !Array.isArray(value.args) ||
          typeof value.clientId !== "string" ||
          !/^[a-f0-9-]{36}$/i.test(value.clientId)
        ) {
          throw new Error("Invalid RPC request.");
        }
        resolveBody({
          method: value.method,
          args: value.args,
          clientId: value.clientId,
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

function shellRequest(
  args: unknown[],
  store: WebStore,
  user: string,
  owner: string,
): ShellRequest {
  const value = objectArg(args, 0);
  const connectionId = String(value.connectionId ?? "");
  const database = String(value.database ?? "");
  const code = value.code;
  if (!connectionId || !database || typeof code !== "string")
    throw new Error("Invalid Shell request.");
  return {
    ...(value as unknown as ShellRequest),
    connectionId: store.sessionId(user, connectionId),
    execId:
      typeof value.execId === "string" && value.execId
        ? `${owner}:${value.execId}`
        : undefined,
  };
}

function documentRequest<T extends DocMutateRequest>(
  args: unknown[],
  store: WebStore,
  user: string,
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
      connectionId: store.sessionId(user, connectionId),
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
  owner: string,
): Promise<unknown> {
  switch (method) {
    case "connections.list":
      return store.listConnections(user);
    case "connections.save":
      return store.saveConnection(user, connectionInput(args));
    case "connections.delete": {
      const id = stringArg(args, 0);
      const sessionId = store.sessionId(user, id);
      for (const task of reads.values())
        if (task.connectionId === sessionId) task.controller.abort();
      await sessions.disconnect(sessionId);
      store.deleteConnection(user, id);
      return;
    }
    case "connections.cachedAuthorization":
      return sessions.cachedAuthorization(
        store.decryptedInput(user, connectionInput(args)),
      );
    case "connections.test":
      return sessions.test(store.decryptedInput(user, connectionInput(args)));
    case "connections.buildUri":
      return store.buildConnectionUri(
        user,
        connectionInput(args),
        objectArg(args, 1).includePassword === true,
      );
    case "session.connect": {
      const id = stringArg(args, 0);
      const status = await sessions.connect(store.sessionId(user, id));
      return { ...status, id };
    }
    case "session.disconnect": {
      const id = store.sessionId(user, stringArg(args, 0));
      for (const task of reads.values())
        if (task.connectionId === id) task.controller.abort();
      return sessions.disconnect(id);
    }
    case "session.authorization":
      return sessions.authorization(
        store.sessionId(user, stringArg(args, 0)),
        store.decryptedInput(user, connectionInput(args, 1)),
      );
    case "session.status": {
      const id = stringArg(args, 0);
      return { ...sessions.getStatus(store.sessionId(user, id)), id };
    }
    case "catalog.databases":
      return listDatabases(store.sessionId(user, stringArg(args, 0)), sessions);
    case "catalog.collections":
      return listCollections(
        store.sessionId(user, stringArg(args, 0)),
        stringArg(args, 1),
        sessions,
      );
    case "catalog.collectionCount":
      return estimateCollectionCount(
        store.sessionId(user, stringArg(args, 0)),
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
          store.sessionId(user, connectionId),
          database,
          collection,
          {
            timeoutMS: store.getSettings(user).queryTimeoutMS || 30_000,
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
      const connectionId = store.sessionId(user, target.connectionId);
      if (method === "schemas.get") return store.getSchema(user, target);
      if (method === "schemas.analyze") {
        const analysis = await analyzeCollectionSchemaOnDb(
          sessions.getClient(connectionId).db(target.database),
          target.collection,
          store.getSettings(user).queryTimeoutMS || 30_000,
        );
        return store.saveSchemaAnalysis(user, target, analysis);
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
        store.sessionId(user, stringArg(args, 0)),
        stringArg(args, 1),
        stringArg(args, 2),
        sessions,
      );
    case "catalog.users":
      return listUsers(
        store.sessionId(user, stringArg(args, 0)),
        stringArg(args, 1),
        sessions,
      );
    case "catalog.sampleFields":
      return sampleFields(
        store.sessionId(user, stringArg(args, 0)),
        stringArg(args, 1),
        stringArg(args, 2),
        sessions,
      );
    case "shell.execute": {
      const external = objectArg(args, 0);
      const request = shellRequest(args, store, user, owner);
      let ok = false;
      try {
        const result = await executeShell(request, owner, sessions);
        ok = result.kind !== "error";
        store.addHistory(user, {
          code: request.code,
          connectionId: String(external.connectionId),
          database: request.database,
          ok,
          summary: historySummary(
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
      if (input.connectionId) store.sessionId(user, input.connectionId);
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
      const { request } = documentRequest<DocReadRequest>(args, store, user);
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
            timeoutMS: store.getSettings(user).queryTimeoutMS || 30_000,
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
        documentRequest<DocUpdateRequest>(args, store, user);
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
        documentRequest<DocSetFieldRequest>(args, store, user);
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
        documentRequest<DocMutateRequest>(args, store, user);
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
  const size = statSync(path).size;
  res.writeHead(200, {
    "content-type": MIME[extname(path)] ?? "application/octet-stream",
    "content-length": size,
    "cache-control":
      extname(path) === ".html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    "content-security-policy":
      "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'",
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
  const sessions = new SessionManager(store);
  const reads = new Map<string, ReadTask>();
  const streams = new Map<ServerResponse, string>();
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
        const prefix = `${ownerId(user)}:`;
        const clientId = new URL(req.url!, origin).searchParams.get("clientId");
        if (!clientId || !/^[a-f0-9-]{36}$/i.test(clientId))
          throw new Error("Invalid client id.");
        const owner = `${ownerId(user)}:${clientId}`;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-store",
          "x-accel-buffering": "no",
        });
        res.write(": connected\n\n");
        streams.set(res, user);
        for (const connection of store.listConnections(user)) {
          const status = sessions.getStatus(
            store.sessionId(user, connection.id),
          );
          res.write(
            `data: ${JSON.stringify({ ...status, id: connection.id })}\n\n`,
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
          if (![...streams.values()].includes(user)) {
            for (const connection of store.listConnections(user)) {
              void sessions.disconnect(store.sessionId(user, connection.id));
            }
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
      const result = await dispatch(
        store,
        sessions,
        user,
        body.method,
        body.args,
        reads,
        `${ownerId(user)}:${body.clientId}`,
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
    },
  };
}

export function createWebServer(options: WebServerOptions) {
  const app = createWebRequestHandler(options);
  return { server: createServer(app.handle), closeSessions: app.closeSessions };
}
