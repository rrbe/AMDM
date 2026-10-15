import { linter, lintKeymap, setDiagnostics } from '@codemirror/lint'
import type { Extension } from '@codemirror/state'
import { keymap, ViewPlugin, type EditorView, type ViewUpdate } from '@codemirror/view'
import { getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { tsAutocomplete } from './tsAutocomplete/tsAutocompleteClient'

function activeCatalog() {
  const state = useAppStore.getState()
  const tab = getActiveTab(state)
  const connectionId = tab.connectionId
  const database = tab.activeDatabase
  return {
    tabId: tab.id,
    connectionId,
    database,
    collections:
      connectionId && database ? state.catalogs[connectionId]?.collections[database] : undefined
  }
}

/** Debounce analysis, keep at most one request in flight, and discard stale replies. */
export function shellDiagnostics(
  collectionMessage: (name: string, database: string) => string
): Extension {
  return [
    linter(null),
    keymap.of(lintKeymap),
    ViewPlugin.fromClass(
      class {
        private catalog = activeCatalog()
        private revision = 0
        private timer: ReturnType<typeof setTimeout> | undefined
        private running = false
        private destroyed = false
        private activated = !__WEB__
        private unsubscribe: () => void

        constructor(private view: EditorView) {
          this.unsubscribe = useAppStore.subscribe(() => {
            const next = activeCatalog()
            const previous = this.catalog
            if (
              next.tabId === previous.tabId &&
              next.connectionId === previous.connectionId &&
              next.database === previous.database &&
              next.collections === previous.collections
            )
              return
            this.catalog = next
            this.schedule()
          })
          this.schedule()
        }

        update(update: ViewUpdate): void {
          if (update.docChanged || (update.focusChanged && update.view.hasFocus)) this.schedule()
        }

        private schedule(): void {
          this.revision++
          clearTimeout(this.timer)
          this.activated ||= this.view.hasFocus
          if (!this.activated) return
          this.timer = setTimeout(() => void this.run(), 350)
        }

        private async run(): Promise<void> {
          if (this.running || this.destroyed) return
          const revision = this.revision
          const { database, collections } = this.catalog
          const code = this.view.state.doc.toString()
          if (!code.trim()) {
            this.view.dispatch(setDiagnostics(this.view.state, []))
            return
          }
          this.running = true
          const diagnostics = await tsAutocomplete.diagnose(code, {
            database,
            collections: collections?.map((collection) => collection.name) ?? null
          })
          this.running = false
          if (this.destroyed) return
          if (revision !== this.revision) {
            this.schedule()
            return
          }
          this.view.dispatch(
            setDiagnostics(
              this.view.state,
              (diagnostics ?? []).map((item) => ({
                ...item,
                source: 'Mongosh',
                message:
                  item.collectionName === undefined
                    ? item.message
                    : collectionMessage(item.collectionName, database)
              }))
            )
          )
        }

        destroy(): void {
          this.destroyed = true
          clearTimeout(this.timer)
          this.unsubscribe()
        }
      }
    )
  ]
}
