import type { ConnectionConfig } from "@shared/types";

interface PasswordRequest {
  id: number;
  connection: ConnectionConfig;
  resolve(value: string | null): void;
}
const requests: PasswordRequest[] = [];
let nextPromptId = 0;
const listeners = new Set<() => void>();
const publish = (): void => {
  for (const listener of listeners) listener();
};

export function subscribePasswordPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function pendingPasswordPrompt(): PasswordRequest | null {
  return requests[0] ?? null;
}
export function requestConnectionPassword(
  connection: ConnectionConfig,
): Promise<string | null> {
  return new Promise((resolve) => {
    requests.push({ id: ++nextPromptId, connection, resolve });
    publish();
  });
}
export function answerPasswordPrompt(value: string | null): void {
  requests.shift()?.resolve(value);
  publish();
}
export function cancelConnectionPassword(id: string): void {
  for (let i = requests.length - 1; i >= 0; i--) {
    if (requests[i].connection.id === id)
      requests.splice(i, 1)[0].resolve(null);
  }
  publish();
}
