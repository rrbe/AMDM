/**
 * Pure decision logic for the editor's inline ghost-text hint.
 *
 * Given the text immediately before the cursor, returns the single most-likely
 * value to insert at a value slot — the passive counterpart to the value
 * dropdown in `mongoCompletion.ts`. Deliberately narrow: only fires on
 * unambiguous spots, so the ghost is never noisy.
 *  - inside `sort({ field: `      → `-1` (descending / "newest first")
 *  - inside a projection `{ field: ` → `1` (include)
 * Booleans are left to the dropdown — true/false are equally likely, so the
 * ghost must not guess. Never throws; returns null when nothing applies.
 */
import { atValueSlot, isInsideSort, isInsideProjection } from '@renderer/lib/mongoCompletion'

// Only the local context matters for the hint, so cap the work on huge scripts.
const WINDOW = 200

export function computeInlineHint(before: string): { insert: string } | null {
  const tail = before.length > WINDOW ? before.slice(before.length - WINDOW) : before
  if (atValueSlot(tail) == null) return null
  if (isInsideSort(tail)) return { insert: '-1' }
  if (isInsideProjection(tail)) return { insert: '1' }
  return null
}
