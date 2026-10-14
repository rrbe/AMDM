import {
  DEFAULT_SETTINGS,
  type AppSettings,
  type ConnectionConfig,
  type ConnectionInput,
  type HistoryEntry,
  type SavedQuery,
  type SavedQueryInput,
  type SchemaAnalysis,
  type SchemaModel,
  type SchemaTarget,
  type MongoJsonSchema,
} from "@shared/types";
import { browserConnection, webSavedQuery } from "@shared/webStorage";
import { mergeWebSettings } from "@shared/webSettings";
import {
  modelWithAnalysis,
  modelWithDraft,
  schemaTargetKey,
} from "@shared/schemaStoreCore";
import { randomUuid } from "../randomUuid";

function requestValue<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = transaction.onerror = () =>
      reject(
        transaction.error ?? new Error("Browser storage transaction failed."),
      );
  });
}

/** Metadata belongs to the authenticated user on this browser origin. Secrets are never written here. */
export class BrowserStore {
  private opened?: Promise<IDBDatabase>;

  constructor(readonly userId: string) {}

  private database(): Promise<IDBDatabase> {
    if (!this.opened) {
      this.opened = new Promise((resolve, reject) => {
        const request = indexedDB.open(`amdm-web:${this.userId}`, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          db.createObjectStore("connections", { keyPath: "id" });
          db.createObjectStore("queries", { keyPath: "id" });
          db.createObjectStore("history", { keyPath: "id" }).createIndex(
            "ranAt",
            "ranAt",
          );
          db.createObjectStore("settings");
          db.createObjectStore("schemas");
        };
        request.onsuccess = () => {
          const db = request.result;
          db.onversionchange = () => {
            db.close();
            this.opened = undefined;
          };
          window.addEventListener(
            "pagehide",
            () => {
              db.close();
              this.opened = undefined;
            },
            { once: true },
          );
          resolve(db);
        };
        request.onerror = () => reject(request.error);
        request.onblocked = () =>
          reject(new Error("Close other AMDM tabs to open browser storage."));
      });
    }
    return this.opened;
  }

  private async read<T>(
    name: string,
    key: IDBValidKey,
  ): Promise<T | undefined> {
    const db = await this.database();
    return requestValue<T | undefined>(
      db.transaction(name).objectStore(name).get(key),
    );
  }

  private async list<T>(name: string): Promise<T[]> {
    const db = await this.database();
    return requestValue<T[]>(db.transaction(name).objectStore(name).getAll());
  }

  private async change<T>(
    name: string,
    key: IDBValidKey,
    update: (previous: unknown, store: IDBObjectStore) => T,
  ): Promise<T> {
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(name, "readwrite");
      const store = transaction.objectStore(name);
      let value: T;
      let error: unknown;
      transaction.oncomplete = () => resolve(value);
      transaction.onabort = transaction.onerror = () =>
        reject(error ?? transaction.error);
      const request = store.get(key);
      request.onsuccess = () => {
        try {
          value = update(request.result, store);
        } catch (failure) {
          error = failure;
          transaction.abort();
        }
      };
    });
  }

  listConnections(): Promise<ConnectionConfig[]> {
    return this.list("connections");
  }
  getConnection(id: string): Promise<ConnectionConfig | undefined> {
    return this.read("connections", id);
  }

  saveConnection(input: ConnectionInput): Promise<ConnectionConfig> {
    const id = input.copyFromId ? randomUuid() : input.id || randomUuid();
    return this.change(
      "connections",
      input.copyFromId || id,
      (previous, store) => {
        if (input.ssh.enabled)
          throw new Error("SSH connections are not supported on AMDM Web.");
        if (input.copyFromId && !previous)
          throw new Error("Source connection not found.");
        const connection = browserConnection(
          input,
          id,
          Date.now(),
          input.copyFromId
            ? undefined
            : (previous as ConnectionConfig | undefined),
        );
        store.put(connection);
        return connection;
      },
    );
  }

  async deleteConnection(id: string): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(
      ["connections", "settings", "schemas"],
      "readwrite",
    );
    const done = transactionDone(transaction);
    transaction.objectStore("connections").delete(id);
    const settingsStore = transaction.objectStore("settings");
    const settings = settingsStore.get("settings");
    settings.onsuccess = () => {
      if (settings.result)
        settingsStore.put(
          {
            ...settings.result,
            connectionOrder: settings.result.connectionOrder.filter(
              (item: string) => item !== id,
            ),
          },
          "settings",
        );
    };
    const models = transaction.objectStore("schemas").openCursor();
    models.onsuccess = () => {
      const cursor = models.result;
      if (!cursor) return;
      if ((cursor.value as SchemaModel).target.connectionId === id)
        cursor.delete();
      cursor.continue();
    };
    await done;
  }

  listQueries(): Promise<SavedQuery[]> {
    return this.list("queries");
  }

  saveQuery(input: SavedQueryInput): Promise<SavedQuery> {
    const id = input.id || randomUuid();
    return this.change("queries", id, (previous, store) => {
      const query = webSavedQuery(
        input,
        id,
        Date.now(),
        previous as SavedQuery | undefined,
      );
      store.put(query);
      return query;
    });
  }

  async deleteQuery(id: string): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction("queries", "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("queries").delete(id);
    await done;
  }

  async getSettings(): Promise<AppSettings> {
    return {
      ...DEFAULT_SETTINGS,
      ...(await this.read<Partial<AppSettings>>("settings", "settings")),
    };
  }

  updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    return this.change("settings", "settings", (previous, store) => {
      const settings = mergeWebSettings(
        { ...DEFAULT_SETTINGS, ...(previous as Partial<AppSettings>) },
        patch,
      );
      store.put(settings, "settings");
      return settings;
    });
  }

  async listHistory(): Promise<HistoryEntry[]> {
    const limit = (await this.getSettings()).historyLimit;
    const db = await this.database();
    return new Promise((resolve, reject) => {
      const entries: HistoryEntry[] = [];
      const transaction = db.transaction("history", "readwrite");
      transaction.oncomplete = () => resolve(entries);
      transaction.onabort = transaction.onerror = () =>
        reject(transaction.error);
      const request = transaction
        .objectStore("history")
        .index("ranAt")
        .openCursor(null, "prev");
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (entries.length < limit) entries.push(cursor.value as HistoryEntry);
        else cursor.delete();
        cursor.continue();
      };
    });
  }

  async addHistory(entry: Omit<HistoryEntry, "id" | "ranAt">): Promise<void> {
    const limit = (await this.getSettings()).historyLimit;
    const db = await this.database();
    const transaction = db.transaction("history", "readwrite");
    const done = transactionDone(transaction);
    const store = transaction.objectStore("history");
    store.add({ ...entry, id: randomUuid(), ranAt: Date.now() });
    let count = 0;
    const request = store.index("ranAt").openCursor(null, "prev");
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (++count > limit) cursor.delete();
      cursor.continue();
    };
    await done;
  }

  async clearHistory(): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction("history", "readwrite");
    const done = transactionDone(transaction);
    transaction.objectStore("history").clear();
    await done;
  }

  getSchema(target: SchemaTarget): Promise<SchemaModel | undefined> {
    return this.read("schemas", schemaTargetKey(target));
  }

  saveAnalysis(
    target: SchemaTarget,
    analysis: SchemaAnalysis,
  ): Promise<SchemaModel> {
    const key = schemaTargetKey(target);
    return this.change("schemas", key, (previous, store) => {
      const model = modelWithAnalysis(
        target,
        analysis,
        previous as SchemaModel | undefined,
      );
      store.put(model, key);
      return model;
    });
  }

  saveDraft(
    target: SchemaTarget,
    draft?: MongoJsonSchema,
  ): Promise<SchemaModel> {
    const key = schemaTargetKey(target);
    return this.change("schemas", key, (previous, store) => {
      const model = modelWithDraft(previous as SchemaModel | undefined, draft);
      store.put(model, key);
      return model;
    });
  }
}
