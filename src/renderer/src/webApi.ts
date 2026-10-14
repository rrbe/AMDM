import type { Api } from "@shared/ipc";
import { randomUuid } from "@renderer/lib/randomUuid";
import type { ConnectionStatus } from "@shared/types";

interface RpcResponse<T> {
  ok: boolean;
  result?: T;
  error?: string;
}

let clientId: string | undefined;
function webClientId(): string {
  return (clientId ??= randomUuid());
}

async function rpc<T>(method: string, ...args: unknown[]): Promise<T> {
  const response = await fetch("/api/rpc", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args, clientId: webClientId() }),
  });
  const body = (await response.json()) as RpcResponse<T>;
  if (!response.ok || !body.ok)
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body.result as T;
}

function unavailable(): Promise<never> {
  return Promise.reject(new Error("This feature is unavailable on AMDM Web."));
}

export const webApi: Api = {
  app: {
    openSettings: async () => {
      if (window.location.hash === "#settings") return;
      window.history.pushState(
        { ...window.history.state, amdmRoute: "settings" },
        "",
        "#settings",
      );
      window.dispatchEvent(new Event("popstate"));
    },
  },
  connections: {
    list: () => rpc("connections.list"),
    save: (input) => rpc("connections.save", input),
    delete: (id) => rpc("connections.delete", id),
    test: (input) => rpc("connections.test", input),
    cachedAuthorization: (input) =>
      rpc("connections.cachedAuthorization", input),
    diagnose: unavailable,
    buildUri: (input, opts) => rpc("connections.buildUri", input, opts),
  },
  session: {
    connect: (id) => rpc("session.connect", id),
    disconnect: (id) => rpc("session.disconnect", id),
    status: (id) => rpc("session.status", id),
    authorization: (id, input) => rpc("session.authorization", id, input),
    onStatusChanged: (listener) => {
      const events = new EventSource(`/api/events?clientId=${webClientId()}`);
      events.onmessage = (event) =>
        listener(JSON.parse(event.data) as ConnectionStatus);
      const close = (): void => events.close();
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
    get: (target) => rpc("schemas.get", target),
    analyze: (target) => rpc("schemas.analyze", target),
    saveDraft: (target, draft) => rpc("schemas.saveDraft", target, draft),
    overwriteDraft: (target) => rpc("schemas.overwriteDraft", target),
  },
  shell: {
    execute: (request) => rpc("shell.execute", request),
    page: (request) => rpc("shell.page", request),
    total: (id) => rpc("shell.total", id),
    release: (id) => rpc("shell.release", id),
    abort: (execId) => rpc("shell.abort", execId),
  },
  queries: {
    list: () => rpc("queries.list"),
    save: (input) => rpc("queries.save", input),
    delete: (id) => rpc("queries.delete", id),
  },
  history: {
    list: () => rpc("history.list"),
    clear: () => rpc("history.clear"),
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
    get: () => rpc("settings.get"),
    update: (patch) => rpc("settings.update", patch),
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
