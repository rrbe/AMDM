/**
 * Pure console-output helpers (lib/consoleOutput): flattening captured shell
 * output into display lines, and the plain-text dump for ⌘C.
 */
import { describe, it, expect } from 'vitest'
import { consoleText, toConsoleLines } from '../../../src/renderer/src/lib/consoleOutput'
import type { ShellOutputLine } from '../../../src/shared/types'

describe('toConsoleLines', () => {
  it('keeps text lines as-is with their level', () => {
    const out: ShellOutputLine[] = [
      { kind: 'text', text: 'hello' },
      { kind: 'text', text: 'boom', level: 'error' }
    ]
    const lines = toConsoleLines(out)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ depth: 0, text: 'hello', level: 'log' })
    expect(lines[1]).toMatchObject({ text: 'boom', level: 'error' })
    expect(lines[0].tokens).toBeUndefined()
  })

  it('splits embedded newlines into separate display lines', () => {
    const lines = toConsoleLines([{ kind: 'text', text: 'a\nb\nc' }])
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
  })

  it('expands printjson payloads into indented, tokenized JSON lines', () => {
    const lines = toConsoleLines([
      { kind: 'json', data: { _id: { $oid: '65f1a2b3c4d5e6f7a8b9c0d1' }, n: 1 } }
    ])
    // { ... } over multiple lines, shell-style ObjectId rendering.
    expect(lines.length).toBeGreaterThan(2)
    expect(lines[0].text).toBe('{')
    expect(lines.some((l) => l.text.includes('ObjectId("65f1a2b3c4d5e6f7a8b9c0d1")'))).toBe(true)
    expect(lines.every((l) => l.level === 'log')).toBe(true)
    expect(lines[1].depth).toBe(1)
    expect(lines[1].tokens?.length).toBeGreaterThan(0)
  })

  it('preserves call order across mixed entries', () => {
    const lines = toConsoleLines([
      { kind: 'text', text: 'before' },
      { kind: 'json', data: 42 },
      { kind: 'text', text: 'after' }
    ])
    expect(lines.map((l) => l.text)).toEqual(['before', '42', 'after'])
  })
})

describe('consoleText', () => {
  it('joins lines with indentation for the ⌘C payload', () => {
    const text = consoleText([
      { kind: 'text', text: 'count: 3' },
      { kind: 'json', data: { a: 1 } }
    ])
    expect(text).toBe('count: 3\n{\n  "a": 1\n}')
  })
})
