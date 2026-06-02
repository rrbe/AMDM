/**
 * Serializer worker (ADR-0004 rules 3 & 4).
 *
 * Runs the heavy CPU off the main process event loop: the BSON→EJSON encoding
 * of query results and the schema-sampling field extraction. If this ran on the
 * main thread, a large result set would stall *all* IPC (catalog loads, other
 * queries) for the whole app — exactly the kind of jank we're replacing.
 *
 * Protocol: each job carries `items`, an array where every element is the BSON
 * encoding of a `{ v: <value> }` wrapper. BSON needs a document at the top, so
 * wrapping lets us ship scalars / arrays / documents through one uniform path.
 * The main thread does the cheap binary `BSON.serialize`; we do the expensive
 * `EJSON.stringify` + parse (serialize op) or path walk (fields op) here.
 */
import { parentPort, type MessagePort } from 'node:worker_threads'
import { deserialize } from 'bson'
import { serializeValue, extractFieldPaths } from './serialize-core'

type Job =
  | { id: number; op: 'serialize'; items: Uint8Array[] }
  | { id: number; op: 'fields'; items: Uint8Array[] }

interface Response {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

const port = parentPort as MessagePort | null

function unwrap(item: Uint8Array): unknown {
  return (deserialize(item) as { v: unknown }).v
}

port?.on('message', (job: Job) => {
  const reply: Response = { id: job.id, ok: true }
  try {
    if (job.op === 'serialize') {
      reply.result = job.items.map((it) => serializeValue(unwrap(it)))
    } else {
      reply.result = extractFieldPaths(job.items.map(unwrap))
    }
  } catch (err) {
    reply.ok = false
    reply.error = err instanceof Error ? err.message : String(err)
  }
  port!.postMessage(reply)
})
