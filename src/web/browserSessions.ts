import type { ConnectionInput } from "../shared/types";
import { browserConnection } from "../shared/webStorage";
import type { ConnectionSource } from "../main/mongo/sessionManager";
import type { DecryptedConnection } from "../main/mongo/uri";

/** Only live page-owned connection inputs; no file or browser persistence. */
export class BrowserSessions implements ConnectionSource {
  private connections = new Map<string, DecryptedConnection>();

  sessionId(owner: string, id: string): string {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id))
      throw new Error("Invalid connection id.");
    return `browser:${owner}:${id}`;
  }

  decryptedInput(owner: string, input: ConnectionInput): DecryptedConnection {
    const id = input.id ? this.sessionId(owner, input.id) : "";
    const current = this.connections.get(id);
    return {
      config: browserConnection(input, id, Date.now()),
      password:
        input.auth.type === "scram"
          ? (input.password ?? current?.password)
          : undefined,
    };
  }

  register(owner: string, input: ConnectionInput): DecryptedConnection {
    const connection = this.decryptedInput(owner, input);
    // Each connect supplies its own password, including an explicitly empty one.
    connection.password =
      input.auth.type === "scram" ? input.password : undefined;
    if (input.auth.type === "scram" && typeof input.password !== "string")
      throw new Error("Enter the connection password.");
    this.connections.set(connection.config.id, connection);
    return connection;
  }

  getDecrypted(id: string): DecryptedConnection | null {
    return this.connections.get(id) ?? null;
  }

  forget(id: string, expected?: DecryptedConnection): void {
    if (!expected || this.connections.get(id) === expected)
      this.connections.delete(id);
  }

  ids(owner: string): string[] {
    return [...this.connections.keys()].filter((id) =>
      id.startsWith(`browser:${owner}:`),
    );
  }

  clear(): void {
    this.connections.clear();
  }
}
