import { buildMongoUri } from "./connectionUri";
import type {
  ConnectionConfig,
  ConnectionInput,
  SavedQuery,
  SavedQueryInput,
} from "./types";

export type WebStorageMode = "server" | "browser";

export interface WebRpcRequest {
  method: string;
  args: unknown[];
  clientId: string;
  storageMode: WebStorageMode;
  storageOwner?: string;
  queryTimeoutMS?: number;
}

export function browserConnection(
  input: ConnectionInput,
  id: string,
  now: number,
  existing?: ConnectionConfig,
): ConnectionConfig {
  return {
    id,
    name: input.name,
    color: input.color,
    useSrv: input.useSrv,
    host: input.host,
    port: input.port,
    replicaSet: input.replicaSet,
    defaultDatabase: input.defaultDatabase,
    options: input.options,
    auth: {
      type: input.auth.type,
      username: input.auth.username,
      authSource: input.auth.authSource,
      mechanism: input.auth.mechanism,
    },
    ssh: { enabled: false },
    tls: {
      enabled: input.tls.enabled,
      allowInvalidCertificates: input.tls.allowInvalidCertificates,
      caFile: input.tls.caFile,
      certificateKeyFile: input.tls.certificateKeyFile,
    },
    hasPassword: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function webSavedQuery(
  input: SavedQueryInput,
  id: string,
  now: number,
  existing?: SavedQuery,
): SavedQuery {
  return {
    id: existing?.id ?? id,
    name: input.name,
    code: input.code,
    connectionId: input.connectionId,
    database: input.database,
    folder: input.folder?.trim() || undefined,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

export function webHistorySummary(
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

export function webConnectionUri(
  input: ConnectionInput,
  password: string | undefined,
  includePassword: boolean,
): string {
  const scram = input.auth.type === "scram" && !!input.auth.username?.trim();
  return buildMongoUri({
    useSrv: input.useSrv,
    host: input.host.trim(),
    port: input.useSrv ? null : (input.port ?? 27017),
    replicaSet: input.replicaSet?.trim() || undefined,
    defaultDatabase: input.defaultDatabase?.trim() || undefined,
    authType: input.auth.type,
    username: input.auth.username?.trim() || undefined,
    password: scram ? (includePassword ? password : "<password>") : undefined,
    encodePassword: !scram || includePassword,
    authSource: input.auth.authSource?.trim() || undefined,
    tlsEnabled: input.tls.enabled,
    tlsAllowInvalid: !!input.tls.allowInvalidCertificates,
    options: input.options,
  });
}
