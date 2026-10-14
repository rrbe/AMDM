import { createWriteStream } from 'node:fs'
import { unlink } from 'node:fs/promises'
import { createGzip } from 'node:zlib'
import type { Document } from 'bson'
import { encodeBsonDoc } from './bsonFileCore'

/**
 * Streaming file writers for export. Electron-free (only node fs/zlib + bson) so
 * the streaming + gzip + flush path unit/integration-tests against a real cursor
 * without the dialog/session wiring — the effectful shell lives in exporter.ts.
 */

/**
 * Write `chunk` to `stream`, awaiting drain on backpressure. Rejects if the
 * stream errors mid-write so a failure (e.g. disk full) surfaces instead of
 * hanging forever on a 'drain' that never comes.
 */
export function writeChunk(
  stream: NodeJS.WritableStream,
  chunk: string | Uint8Array
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.write(chunk)) {
      resolve()
      return
    }
    const cleanup = (): void => {
      stream.removeListener('error', onError)
      stream.removeListener('close', onClose)
      stream.removeListener('drain', onDrain)
    }
    const onError = (e: Error): void => {
      cleanup()
      reject(e)
    }
    const onClose = (): void => {
      cleanup()
      reject(new Error('Write stream closed before draining.'))
    }
    const onDrain = (): void => {
      cleanup()
      resolve()
    }
    stream.once('error', onError)
    stream.once('close', onClose)
    stream.once('drain', onDrain)
  })
}

/**
 * Stream documents to a plain `.bson` file (optionally gzipped), one serialized
 * document at a time so memory stays bounded regardless of collection size.
 * Returns the number of documents written. On any failure the
 * half-written file is removed, so a crashed export never leaves a truncated
 * `.bson` at the user's chosen path.
 */
export async function streamBsonToFile(
  docs: AsyncIterable<Document>,
  filePath: string,
  gzip: boolean
): Promise<number> {
  const file = createWriteStream(filePath)
  const gz = gzip ? createGzip() : null
  const sink: NodeJS.WritableStream = gz ?? file
  if (gz) gz.pipe(file)
  // Resolves once the bytes are fully flushed to disk (through gzip if present).
  const flushed = new Promise<void>((resolve, reject) => {
    file.on('finish', resolve)
    file.on('error', reject)
    gz?.on('error', reject)
  })

  let count = 0
  try {
    for await (const doc of docs) {
      await writeChunk(sink, encodeBsonDoc(doc))
      count++
    }
    sink.end()
    await flushed
  } catch (e) {
    gz?.destroy()
    file.destroy()
    await unlink(filePath).catch(() => {})
    throw e
  }
  return count
}
