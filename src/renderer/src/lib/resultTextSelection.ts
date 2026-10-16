/** Copy mounted result lines using source values attached to complete BSON Date tokens. */
export function resultSelectionText(root: HTMLElement): string | null {
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null

  const lines: string[] = []
  for (const pre of root.querySelectorAll('pre')) {
    if (!range.intersectsNode(pre)) continue
    const part = document.createRange()
    part.selectNodeContents(pre)
    if (pre.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset)
    if (pre.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset)
    if (part.collapsed && pre.textContent !== '') continue
    let text = part.toString()
    // Work backwards so replacing a token cannot move earlier text offsets.
    const tokens = Array.from(pre.querySelectorAll<HTMLElement>('[data-copy-text]')).reverse()
    for (const token of tokens) {
      const tokenRange = document.createRange()
      tokenRange.selectNodeContents(token.firstChild!)
      // Partial selections retain exactly the selected characters.
      if (part.compareBoundaryPoints(Range.START_TO_START, tokenRange) > 0 ||
          part.compareBoundaryPoints(Range.END_TO_END, tokenRange) < 0) continue
      const prefix = part.cloneRange()
      prefix.setEnd(tokenRange.startContainer, tokenRange.startOffset)
      const start = prefix.toString().length
      text = text.slice(0, start) + token.dataset.copyText! + text.slice(start + tokenRange.toString().length)
    }
    lines.push(text)
  }
  return lines.length ? lines.join('\n') : null
}
