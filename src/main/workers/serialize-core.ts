/**
 * Pure serialization/extraction helpers shared by the serializer worker and the
 * main-thread inline fallback (see serializerPool.ts). No worker/driver imports
 * here so both sides can use the exact same logic — keeping behavior identical
 * whether a job ran off-thread or degraded to inline.
 */
import { EJSON } from 'bson'

/** Cap on sampled field paths (ADR-0004 rule 4: bounded). */
const MAX_FIELDS = 500

/** BSON value → plain JSON-cloneable EJSON-canonical value (safe over IPC). */
export function serializeValue(value: unknown): unknown {
  return JSON.parse(EJSON.stringify(value, { relaxed: false }))
}

function isBsonLike(v: unknown): boolean {
  return (
    v instanceof Date ||
    (typeof v === 'object' && v !== null && '_bsontype' in (v as Record<string, unknown>))
  )
}

function collectPaths(
  obj: Record<string, unknown>,
  prefix: string,
  out: Set<string>,
  depth: number
): void {
  for (const [k, v] of Object.entries(obj)) {
    if (out.size >= MAX_FIELDS) return
    const path = prefix ? `${prefix}.${k}` : k
    out.add(path)
    if (depth < 2 && v && typeof v === 'object' && !Array.isArray(v) && !isBsonLike(v)) {
      collectPaths(v as Record<string, unknown>, path, out, depth + 1)
    }
  }
}

/** Dot-pathed field names from a set of sampled documents, sorted + bounded. */
export function extractFieldPaths(docs: unknown[]): string[] {
  const out = new Set<string>()
  for (const d of docs) {
    if (d && typeof d === 'object' && !Array.isArray(d)) {
      collectPaths(d as Record<string, unknown>, '', out, 0)
    }
  }
  return [...out].sort()
}
