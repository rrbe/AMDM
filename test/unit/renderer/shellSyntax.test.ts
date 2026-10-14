import { javascript } from '@codemirror/lang-javascript'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { isShellText } from '@renderer/lib/shellSyntax'

describe('editor text context', () => {
  it.each([
    '// db.items.find().sort({ n: ',
    '/*\ndb.items.find().sort({ n: ',
    '`\ndb.items.find().sort({ n: ',
    '"db.items.find().sort({ n: '
  ])('suppresses inline hints in %s', (code) => {
    const state = EditorState.create({ doc: code, extensions: [javascript()] })
    expect(isShellText(state, code.length)).toBe(true)
  })
  it('allows JavaScript inside template interpolation', () => {
    const code = '`value ${db.items.find().sort({ n: '
    const state = EditorState.create({ doc: code, extensions: [javascript()] })
    expect(isShellText(state, code.length)).toBe(false)
  })
})
