/**
 * CodeMirror completion source for a pipeline-builder *stage body*.
 *
 * Unlike the shell editor's source, a stage body has no `db.<coll>.` text to
 * infer context from, so the target collection is supplied by the builder. We
 * offer:
 *  - `$<word>` → aggregation stages + expression/accumulator operators
 *  - bare word → the target collection's sampled field names + shell globals
 *
 * Reads the live store outside React; never throws (returns null).
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { useAppStore } from '@renderer/store/useAppStore'
import { lengthBoost } from '@renderer/lib/mongoCompletion'
import { AGG_STAGES, AGG_EXPR_OPERATORS, SHELL_GLOBALS, JS_LITERALS } from '@renderer/lib/completionRegistry'

export interface StageTarget {
  connId: string
  db: string
  coll: string
}

/**
 * Build a completion source bound to a (live) target collection. `target` is a
 * thunk so the source stays a stable reference while the collection it reads can
 * change without reconfiguring CodeMirror.
 */
export function makeStageCompletionSource(
  target: () => StageTarget | null
): (context: CompletionContext) => CompletionResult | null {
  return (context) => {
    try {
      const token = context.matchBefore(/[\w$]*/)
      if ((!token || token.from === token.to) && !context.explicit) return null
      const before = context.state.sliceDoc(0, context.pos)

      // `$<word>` → aggregation stages + expression operators
      const dollar = /(\$[\w$]*)$/.exec(before)
      if (dollar) {
        const word = dollar[1]
        const map = new Map<string, Completion>()
        for (const l of AGG_STAGES) map.set(l, { label: l, type: 'property', detail: 'agg stage' })
        for (const l of AGG_EXPR_OPERATORS) if (!map.has(l)) map.set(l, { label: l, type: 'property', detail: 'expr op' })
        return { from: context.pos - word.length, options: [...map.values()], validFor: /^\$[\w$]*$/ }
      }

      // bare word → target field names + shell globals + literals
      const word = /([\w$]*)$/.exec(before)?.[1] ?? ''
      const options: Completion[] = []
      const tgt = target()
      if (tgt) {
        for (const f of useAppStore.getState().getFields(tgt.connId, tgt.db, tgt.coll)) {
          options.push({ label: f, type: 'variable', detail: 'field', boost: lengthBoost(f) })
        }
      }
      for (const g of SHELL_GLOBALS) options.push({ label: g, type: 'keyword', detail: 'constructor' })
      for (const kw of JS_LITERALS) options.push({ label: kw, type: 'keyword', detail: 'literal' })
      if (options.length === 0) return null
      return { from: context.pos - word.length, options, validFor: /^[\w$]*$/ }
    } catch {
      return null
    }
  }
}
