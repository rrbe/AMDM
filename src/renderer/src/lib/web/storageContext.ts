import type { WebRpcRequest, WebStorageMode } from "@shared/webStorage";
import { randomUuid } from "../randomUuid";
import { BrowserStore } from "./browserStore";

type StorageContext =
  | { userId: string; mode: "server" }
  | { userId: string; mode: "browser"; store: BrowserStore };
let context: Promise<StorageContext> | undefined;
let currentMode: WebStorageMode = "server";
let clientId: string | undefined;

export function webClientId(): string {
  return (clientId ??= randomUuid());
}

export async function requestWebRpc<T>(
  method: string,
  args: unknown[],
  scope: Pick<WebRpcRequest, "storageMode" | "storageOwner" | "queryTimeoutMS">,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch("/api/rpc", {
    signal,
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ method, args, clientId: webClientId(), ...scope }),
  });
  const body = (await response.json()) as {
    ok: boolean;
    result?: T;
    error?: string;
  };
  if (!response.ok || !body.ok)
    throw new Error(body.error ?? `Request failed (${response.status}).`);
  return body.result as T;
}

export function webStorageContext(): Promise<StorageContext> {
  if (!context)
    context = (async () => {
      const { userId } = await requestWebRpc<{ userId: string }>(
        "app.context",
        [],
        { storageMode: "server" },
      );
      const stored = localStorage.getItem(`amdm:web-storage:${userId}`);
      if (stored !== null && stored !== "server" && stored !== "browser")
        throw new Error("Invalid Web storage mode.");
      currentMode = stored ?? "server";
      const key = `amdm:web-storage:${userId}`;
      const reloadIfChanged = (): void => {
        if ((localStorage.getItem(key) ?? "server") !== currentMode)
          window.location.reload();
      };
      // Pagehide releases live sessions/results; a restored page needs fresh state.
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) window.location.reload();
        else reloadIfChanged();
      });
      window.addEventListener("storage", (event) => {
        if (event.key === key) reloadIfChanged();
      });
      return currentMode === "browser"
        ? { userId, mode: "browser", store: new BrowserStore(userId) }
        : { userId, mode: "server" };
    })();
  return context.then((current) => {
    if (
      (localStorage.getItem(`amdm:web-storage:${current.userId}`) ??
        "server") !== current.mode
    ) {
      window.location.reload();
      throw new Error("Storage mode changed. Reloading AMDM.");
    }
    return current;
  });
}

export function currentWebStorageMode(): WebStorageMode {
  return currentMode;
}

export async function switchWebStorageMode(
  mode: WebStorageMode,
): Promise<void> {
  const current = await webStorageContext();
  if (mode === current.mode) return;
  localStorage.setItem(`amdm:web-storage:${current.userId}`, mode);
  // Page teardown closes SSE and releases the old mode's owned sessions/results.
  window.location.reload();
}

export async function webRpcWithSignal<T>(
  method: string,
  args: unknown[],
  signal?: AbortSignal,
): Promise<T> {
  const current = await webStorageContext();
  return requestWebRpc<T>(
    method,
    args,
    {
      storageMode: current.mode,
      storageOwner: current.userId,
      queryTimeoutMS:
        current.mode === "browser"
          ? (await current.store.getSettings()).queryTimeoutMS
          : undefined,
    },
    signal,
  );
}

export function webRpc<T>(method: string, ...args: unknown[]): Promise<T> {
  return webRpcWithSignal<T>(method, args);
}

export async function storedWebData<T>(
  method: string,
  args: unknown[],
  browser: (store: BrowserStore) => Promise<T>,
): Promise<T> {
  const current = await webStorageContext();
  return current.mode === "browser"
    ? browser(current.store)
    : webRpc<T>(method, ...args);
}
