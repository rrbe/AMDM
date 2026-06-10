/**
 * Pure helpers for the Console result view: flatten captured shell output
 * (print/printjson/console.* lines, EJSON-canonical payloads) into display
 * lines the virtualized view can render — and back into plain text for ⌘C.
 * printjson payloads reuse the JSON view's shell-style line formatter, so
 * `ObjectId("..")` / `ISODate("..")` render identically in both views.
 */
import type { ShellOutputLine } from '@shared/types'
import { toJsonLines, type JsonToken } from './format'

export interface ConsoleLine {
  /** Indentation depth (2-space units; always 0 for text lines). */
  depth: number
  /** Plain text of the line (indent-free). */
  text: string
  /** Syntax tokens when the line comes from a printjson payload. */
  tokens?: JsonToken[]
  /** Console channel — 'warn'/'error' tint the line. */
  level: 'log' | 'warn' | 'error'
}

/** Flatten output entries into individual display lines, in call order. */
export function toConsoleLines(output: ShellOutputLine[]): ConsoleLine[] {
  const lines: ConsoleLine[] = []
  for (const entry of output) {
    const level = entry.level ?? 'log'
    if (entry.kind === 'json') {
      for (const jl of toJsonLines(entry.data)) {
        lines.push({ depth: jl.depth, text: jl.text, tokens: jl.tokens, level })
      }
    } else {
      // A printed string may itself contain newlines — one display line each.
      for (const text of String(entry.text ?? '').split('\n')) {
        lines.push({ depth: 0, text, level })
      }
    }
  }
  return lines
}

/** The whole console as plain text (the ⌘C payload when nothing is selected). */
export function consoleText(output: ShellOutputLine[]): string {
  return toConsoleLines(output)
    .map((l) => '  '.repeat(l.depth) + l.text)
    .join('\n')
}
