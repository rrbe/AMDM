import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionInput } from "../../../src/shared/types";
import {
  browserConnection,
  webConnectionUri,
} from "../../../src/shared/webStorage";

const input: ConnectionInput = {
  id: "local",
  name: "Private",
  useSrv: false,
  host: "localhost:27017",
  previewResources: false,
  cdnPrefix: "https://cdn.example.com/",
  auth: { type: "scram", username: "user", authSource: "admin" },
  ssh: { enabled: false },
  tls: { enabled: false },
  password: "password-not-stored",
  sshPassword: "ssh-not-stored",
  sshPassphrase: "passphrase-not-stored",
  jumpSshPassphrase: "jump-not-stored",
};
afterEach(() => vi.unstubAllGlobals());

describe("Web storage boundaries", () => {
  it("persists only connection metadata even when the input carries credentials or extra auth fields", () => {
    const connection = browserConnection(
      {
        ...input,
        auth: { ...input.auth, password: "nested-not-stored" },
      } as ConnectionInput,
      "new",
      100,
    );
    const serialized = JSON.stringify(connection);
    expect(connection).toMatchObject({
      id: "new",
      hasPassword: false,
      previewResources: false,
      cdnPrefix: input.cdnPrefix,
      createdAt: 100,
      ssh: { enabled: false },
    });
    expect(serialized).not.toContain("not-stored");
    expect(serialized).not.toContain("copyFromId");
    expect(webConnectionUri(connection, undefined, true)).not.toContain(
      "password-not-stored",
    );
    expect(webConnectionUri(connection, undefined, false)).toContain(
      "<password>",
    );
  });

  it("defaults to server storage and keeps the selection under the authenticated user", async () => {
    vi.resetModules();
    const values = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const reload = vi.fn();
    const listeners = new Map<
      string,
      (event: { persisted?: boolean; key?: string }) => void
    >();
    vi.stubGlobal("window", {
      location: { reload },
      addEventListener: (
        name: string,
        listener: (event: { persisted?: boolean; key?: string }) => void,
      ) => listeners.set(name, listener),
    });
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { userId: "alice" } }),
    }));
    vi.stubGlobal("fetch", fetch);
    const storage =
      await import("../../../src/renderer/src/lib/web/storageContext");
    expect(await storage.webStorageContext()).toMatchObject({
      userId: "alice",
      mode: "server",
    });
    listeners.get("pageshow")!({ persisted: false });
    expect(reload).not.toHaveBeenCalled();
    listeners.get("pageshow")!({ persisted: true });
    expect(reload).toHaveBeenCalledOnce();
    reload.mockClear();
    await storage.switchWebStorageMode("browser");
    expect(values.get("amdm:web-storage:alice")).toBe("browser");
    expect(reload).toHaveBeenCalledOnce();
    reload.mockClear();
    listeners.get("storage")!({ key: "unrelated" });
    expect(reload).not.toHaveBeenCalled();
    listeners.get("storage")!({ key: "amdm:web-storage:alice" });
    expect(reload).toHaveBeenCalledOnce();
    await expect(storage.webStorageContext()).rejects.toThrow(
      "Storage mode changed",
    );
    expect(JSON.parse(fetch.mock.calls[0][1]!.body)).toMatchObject({
      method: "app.context",
      storageMode: "server",
    });
  });

  it("does not reuse another user’s browser storage choice", async () => {
    vi.resetModules();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) =>
        key === "amdm:web-storage:alice" ? "browser" : null,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, result: { userId: "bob" } }),
      })),
    );
    vi.stubGlobal("window", {
      location: { reload: vi.fn() },
      addEventListener: vi.fn(),
    });
    const storage =
      await import("../../../src/renderer/src/lib/web/storageContext");
    expect(await storage.webStorageContext()).toMatchObject({
      userId: "bob",
      mode: "server",
    });
  });
});
