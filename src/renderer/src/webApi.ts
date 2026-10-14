import type { Api } from "@shared/ipc";
import type { ConnectionStatus } from "@shared/types";

import {
  webRpc as rpc,
  webRpcWithSignal,
  storedWebData,
  webStorageContext,
  currentWebStorageMode,
  webClientId,
} from "@renderer/lib/web/storageContext";
import {
  requestConnectionPassword,
  cancelConnectionPassword,
} from "@renderer/lib/web/passwordPrompt";
import { webConnectionUri, webHistorySummary } from "@shared/webStorage";
import type { SchemaAnalysis } from "@shared/types";

const connecting = new Map<string, AbortController>();

function unavailable(): Promise<never> {
  return Promise.reject(new Error("This feature is unavailable on AMDM Web."));
}

export const webApi: Api = {
  app: {
    openSettings: async () => {
      if (window.location.hash === "#settings") return;
      window.history.pushState(
        {
          ...window.history.state,
          amdmRoute: "settings",
          webStorageMode: currentWebStorageMode(),
        },
        "",
        "#settings",
      );
      window.dispatchEvent(new Event("popstate"));
    },
  },
  connections: {
    list: () =>
      storedWebData("connections.list", [], (store) => store.listConnections()),
    save: (input) =>
      storedWebData("connections.save", [input], (store) =>
        store.saveConnection(input),
      ),
    delete: async (id) => {
      const context = await webStorageContext();
      if (context.mode === "server") return rpc("connections.delete", id);
      connecting.get(id)?.abort();
      cancelConnectionPassword(id);
      await rpc("session.disconnect", id);
      await context.store.deleteConnection(id);
    },
    test: (input) => rpc("connections.test", input),
    cachedAuthorization: (input) =>
      rpc("connections.cachedAuthorization", input),
    diagnose: unavailable,
    buildUri: (input, opts) =>
      storedWebData("connections.buildUri", [input, opts], async () =>
        webConnectionUri(input, input.password, opts.includePassword),
      ),
  },
  session: {
    connect: async (id) => {
      const context = await webStorageContext();
      if (context.mode === "server") return rpc("session.connect", id);
      const controller = new AbortController();
      connecting.set(id, controller);
      try {
        const connection = await context.store.getConnection(id);
        if (!connection) throw new Error("Connection not found.");
        if (controller.signal.aborted) return { id, state: "disconnected" };
        const password =
          connection.auth.type === "scram"
            ? await requestConnectionPassword(connection)
            : undefined;
        if (password === null || controller.signal.aborted)
          return { id, state: "disconnected" };
        return await webRpcWithSignal(
          "session.connect",
          [{ ...connection, password }],
          controller.signal,
        );
      } catch (error) {
        if (controller.signal.aborted) return { id, state: "disconnected" };
        throw error;
      } finally {
        if (connecting.get(id) === controller) connecting.delete(id);
      }
    },
    disconnect: (id) => {
      connecting.get(id)?.abort();
      cancelConnectionPassword(id);
      return rpc("session.disconnect", id);
    },
    status: (id) => rpc("session.status", id),
    authorization: (id, input) => rpc("session.authorization", id, input),
    onStatusChanged: (listener) => {
      let events: EventSource | undefined;
      let closed = false;
      void webStorageContext()
        .then((context) => {
          if (closed) return;
          const params = new URLSearchParams({
            clientId: webClientId(),
            storageMode: context.mode,
            storageOwner: context.userId,
          });
          events = new EventSource(`/api/events?${params}`);
          events.onmessage = (event) =>
            listener(JSON.parse(event.data) as ConnectionStatus);
        })
        .catch((error: unknown) => console.error("[Web status stream]", error));
      const close = (): void => {
        closed = true;
        events?.close();
      };
      window.addEventListener("pagehide", close);
      return () => {
        window.removeEventListener("pagehide", close);
        close();
      };
    },
  },
  catalog: {
    databases: (id) => rpc("catalog.databases", id),
    collections: (id, database) => rpc("catalog.collections", id, database),
    collectionCount: (id, database, collection) =>
      rpc("catalog.collectionCount", id, database, collection),
    dropCollection: (id, database, collection) =>
      rpc("catalog.dropCollection", id, database, collection),
    indexes: (id, database, collection) =>
      rpc("catalog.indexes", id, database, collection),
    users: (id, database) => rpc("catalog.users", id, database),
    sampleFields: (id, database, collection) =>
      rpc("catalog.sampleFields", id, database, collection),
  },
  schemas: {
    get: (target) =>
      storedWebData(
        "schemas.get",
        [target],
        async (store) => (await store.getSchema(target)) ?? null,
      ),
    analyze: async (target) => {
      const context = await webStorageContext();
      if (context.mode === "server") return rpc("schemas.analyze", target);
      const analysis = await rpc<SchemaAnalysis>("schemas.analyze", target);
      return context.store.saveAnalysis(target, analysis);
    },
    saveDraft: (target, draft) =>
      storedWebData("schemas.saveDraft", [target, draft], (store) =>
        store.saveDraft(target, draft),
      ),
    overwriteDraft: (target) =>
      storedWebData("schemas.overwriteDraft", [target], (store) =>
        store.saveDraft(target),
      ),
  },
  shell: {
    execute: async (request) => {
      const result = await rpc<Awaited<ReturnType<Api["shell"]["execute"]>>>(
        "shell.execute",
        request,
      );
      const context = await webStorageContext();
      if (context.mode === "browser")
        await context.store.addHistory({
          code: request.code,
          connectionId: request.connectionId,
          database: request.database,
          ok: result.kind !== "error",
          summary: webHistorySummary(
            result.kind,
            result.count,
            result.elapsedMs,
            result.errorName,
          ),
        });
      return result;
    },
    page: (request) => rpc("shell.page", request),
    total: (id) => rpc("shell.total", id),
    release: (id) => rpc("shell.release", id),
    abort: (execId) => rpc("shell.abort", execId),
  },
  queries: {
    list: () =>
      storedWebData("queries.list", [], (store) => store.listQueries()),
    save: (input) =>
      storedWebData("queries.save", [input], (store) => store.saveQuery(input)),
    delete: (id) =>
      storedWebData("queries.delete", [id], (store) => store.deleteQuery(id)),
  },
  history: {
    list: () =>
      storedWebData("history.list", [], (store) => store.listHistory()),
    clear: () =>
      storedWebData("history.clear", [], (store) => store.clearHistory()),
  },
  docs: {
    read: (request) => rpc("docs.read", request),
    cancelRead: (taskId) => rpc("docs.cancelRead", taskId),
    update: (request) => rpc("docs.update", request),
    setField: (request) => rpc("docs.setField", request),
    delete: (request) => rpc("docs.delete", request),
  },
  io: {
    chooseExportDirectory: unavailable,
    cancelExport: unavailable,
    onExportProgress: () => () => {},
    openExportedFile: unavailable,
    revealExportedFile: unavailable,
    export: unavailable,
    import: unavailable,
  },
  settings: {
    get: () =>
      storedWebData("settings.get", [], (store) => store.getSettings()),
    update: (patch) =>
      storedWebData("settings.update", [patch], (store) =>
        store.updateSettings(patch),
      ),
  },
  updates: {
    checkForUpdates: async () => false,
    getState: async () => ({
      available: false,
      phase: "idle",
      automaticallyChecksForUpdates: false,
      availableVersion: null,
      downloadProgress: null,
    }),
    setAutomaticChecks: async () => ({
      available: false,
      phase: "idle",
      automaticallyChecksForUpdates: false,
      availableVersion: null,
      downloadProgress: null,
    }),
    showAvailableUpdate: async () => false,
    cancelDownload: async () => false,
    onStateChanged: () => () => {},
  },
  dialog: {
    openFile: unavailable,
  },
};
