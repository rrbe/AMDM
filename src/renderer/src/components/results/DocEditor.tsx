/** Load the stored document by its canonical BSON id before editing a full replacement. */
import { useLayoutEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ResizableModal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { toStrictEjson } from '@renderer/lib/resultCopy'
import { randomUuid } from '@renderer/lib/randomUuid'
import i18n from '@renderer/i18n'
import { useAppStore } from '@renderer/store/useAppStore'

interface DocEditorProps {
  connectionId: string
  database: string
  collection: string
  /** The document's _id, exactly as it arrived (EJSON-serialized). */
  id: unknown
  onClose: () => void
}

export function DocEditor({ connectionId, database, collection, id, onClose }: DocEditorProps): React.JSX.Element {
  const { t } = useTranslation()
  const updateDocument = useAppStore((s) => s.updateDocument)
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useLayoutEffect(() => {
    const taskId = `document-edit:${randomUuid()}`
    const { readDocument, cancelDocumentRead, notify } = useAppStore.getState()
    let pending = true
    setText(null)
    setError(null)
    void readDocument({ connectionId, database, collection, id, taskId }).then((result) => {
      if (!pending) return
      pending = false
      if (result.ok && result.found) {
        setText(toStrictEjson(result.document))
        return
      }
      const message = result.ok ? i18n.t('result.documentMissing') :
        i18n.t('result.documentRefreshFailed', { error: result.error ?? i18n.t('notify.unknown') })
      setError(message)
      notify({ variant: 'warn', title: message, source: 'document' })
    })
    return () => {
      if (pending) {
        pending = false
        void cancelDocumentRead(taskId)
      }
    }
  }, [connectionId, database, collection, id])

  const onSave = async (): Promise<void> => {
    setError(null)
    if (text === null) return
    if (!text.trim()) {
      setError(t('docEditor.errorEmpty'))
      return
    }
    setSaving(true)
    const res = await updateDocument({
      connectionId,
      database,
      collection,
      id,
      documentEjson: text
    })
    setSaving(false)
    if (res.ok) {
      onClose()
    } else {
      setError(res.error ?? t('docEditor.errorUpdateFailed'))
    }
  }

  return (
    <ResizableModal
      sizeKey="document-editor"
      title={t('docEditor.title', { collection })}
      className="h-[560px] min-h-[420px]"
      bodyClassName="flex flex-col gap-2"
      onClose={onClose}
      footer={
        <>
          {error && <span className="doc-edit-error">{error}</span>}
          <span className="spacer" />
          <Button onClick={onClose}>{t('docEditor.cancel')}</Button>
          <Button variant="primary" busy={saving} disabled={text === null} onClick={() => void onSave()}>
            {t('docEditor.save')}
          </Button>
        </>
      }
    >
      <textarea
        className="doc-edit-area"
        spellCheck={false}
        value={text ?? ''}
        disabled={text === null || saving}
        placeholder={text === null && !error ? t('common.loading') : undefined}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="hint">
        {t('docEditor.hint')}
      </div>
    </ResizableModal>
  )
}
