/**
 * Renderer-facing re-export of the shared connection-string helpers, plus the
 * UI-only preset color swatches. The parse/build logic itself lives in
 * `@shared/connectionUri` so the main process can reuse it (export with the
 * decrypted password).
 */
import { formatMongoHosts, splitHostPort } from '@shared/connectionUri'

export {
  parseMongoUri,
  buildMongoUri,
  formatMongoHosts,
  type ParsedUri,
  type BuildUriInput
} from '@shared/connectionUri'

export interface ConnectionMember {
  host: string
  port: string
}

export interface ConnectionOption {
  key: string
  value: string
}

/** Convert the persisted seed list into editable host/port rows. */
export function parseConnectionMembers(
  hosts: string,
  legacyPort?: number | null
): ConnectionMember[] {
  return formatMongoHosts(hosts, legacyPort)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      const member = splitHostPort(value)
      return { host: member.host, port: String(member.port ?? 27017) }
    })
}

/** Convert editable rows back to the persisted MongoDB seed-list shape. */
export function formatConnectionMembers(members: ConnectionMember[]): string {
  return members
    .filter((member) => member.host.trim())
    .map((member) => {
      const rawHost = member.host.trim()
      const host = rawHost.startsWith('[') && rawHost.endsWith(']') ? rawHost.slice(1, -1) : rawHost
      const formattedHost = host.includes(':') ? `[${host}]` : host
      const port = member.port.trim()
      return port ? `${formattedHost}:${port}` : formattedHost
    })
    .join(',')
}

export function connectionMembersAreValid(members: ConnectionMember[]): boolean {
  return (
    members.length > 0 &&
    members.every((member) => {
      const port = Number(member.port)
      return (
        member.host.trim().length > 0 &&
        /^\d+$/.test(member.port.trim()) &&
        Number.isInteger(port) &&
        port >= 1 &&
        port <= 65535
      )
    })
  )
}

/** Keep readPreference in its dedicated control and everything else in the editable table. */
export function splitConnectionOptions(options: Record<string, string> = {}): {
  readPreference: string
  custom: ConnectionOption[]
} {
  const entries = Object.entries(options)
  return {
    readPreference: entries.find(([key]) => key.toLowerCase() === 'readpreference')?.[1] ?? '',
    custom: entries.filter(([key]) => key.toLowerCase() !== 'readpreference').map(([key, value]) => ({ key, value }))
  }
}

/** Convert editable option rows back to the persisted MongoClient option map. */
export function buildConnectionOptions(readPreference: string, custom: ConnectionOption[]): Record<string, string> {
  const options = Object.fromEntries(
    custom
      .map(({ key, value }) => [key.trim(), value.trim()])
      .filter(([key]) => key && key.toLowerCase() !== 'readpreference')
  )
  if (readPreference) options.readPreference = readPreference
  return options
}

export function inferAuthType(fields: {
  username: string
  password: string
  authSource: string
}): 'none' | 'scram' {
  return fields.username.trim() || fields.password || fields.authSource.trim() ? 'scram' : 'none'
}

/** The preset color swatches offered for tagging a connection. */
export const PRESET_COLORS = [
  '#ef4444', // red
  '#f59e0b', // amber
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899' // pink
] as const
