import { BSON, type Document } from 'bson'
import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * Native plain-`.bson` codec — the mongodump *directory-dump* file format: a
 * flat sequence of length-prefixed BSON documents laid end to end. This is NOT
 * the `--archive` stream (which wraps multiple namespaces in a private framing
 * we deliberately don't reimplement). The same shape is what a real
 * `mongodump --out <dir>` writes per collection and what `mongorestore` reads,
 * so our files interoperate both ways.
 *
 * Pure + dependency-light (only `bson` + node `zlib`) so it unit-tests without a
 * live connection — see `test/unit/main/bsonFileCore.test.ts`.
 */

// promoteValues:false keeps Int32 / Double / Long as wrapper types so
// re-inserting a parsed document preserves its exact numeric BSON subtype
// (type fidelity — same concern as docOps' _id handling).
const DESERIALIZE_OPTS = { promoteValues: false } as const

/** RFC 1952 gzip magic — the first two bytes of any gzip stream. */
export function isGzip(buf: Uint8Array): boolean {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b
}

/**
 * Walk a plain-`.bson` buffer into documents by the int32-LE length that
 * prefixes each one. Throws on a truncated / malformed stream rather than
 * silently dropping data (unsupported-not-silent, per the project's ethos).
 */
export function parseBsonDocs(buf: Buffer): Document[] {
  const docs: Document[] = []
  const total = buf.length
  let offset = 0
  while (offset < total) {
    if (offset + 4 > total) {
      throw new Error(`Truncated BSON: ${total - offset} trailing byte(s) at offset ${offset}`)
    }
    const size = buf.readInt32LE(offset)
    // A BSON document is at minimum 5 bytes (int32 length + terminating null).
    if (size < 5 || offset + size > total) {
      throw new Error(`Invalid BSON length ${size} at offset ${offset} (file size ${total})`)
    }
    docs.push(BSON.deserialize(buf.subarray(offset, offset + size), DESERIALIZE_OPTS))
    offset += size
  }
  return docs
}

/** Serialize one document to its length-prefixed BSON bytes (for streaming export). */
export function encodeBsonDoc(doc: Document): Uint8Array {
  return BSON.serialize(doc)
}

/** Concatenate documents into a single plain-`.bson` buffer (tests / small writes). */
export function encodeBsonDocs(docs: Document[]): Buffer {
  return docs.length ? Buffer.concat(docs.map((d) => BSON.serialize(d))) : Buffer.alloc(0)
}

/** Decode a `.bson` or gzipped `.bson.gz` buffer into documents (gzip auto-detected). */
export function decodeBsonFile(raw: Buffer): Document[] {
  return parseBsonDocs(isGzip(raw) ? gunzipSync(raw) : raw)
}

/** Gzip a plain-`.bson` buffer — the `mongodump --gzip` equivalent. */
export function gzipBson(buf: Buffer): Buffer {
  return gzipSync(buf)
}
