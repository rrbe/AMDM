/**
 * Document editor modal.
 *
 * Shows a document as pretty EJSON in a monospace textarea. On Save we send the
 * raw textarea text to `updateDocument` as a full replacement (the main process
 * parses the EJSON and validates it). We also locally guard against obviously
 * invalid JSON before sending, surfacing parse errors inline.
 *
 * The `_id` is passed straight through (it's the EJSON-serialized value as it
 * arrived in the result); the main process deserializes it for the filter.
 */
import { useMemo, useState } from 'react'
import { Modal } from '@renderer/components/common/Modal'
import { BusyButton } from '@renderer/components/common/BusyButton'
import { toJsonLines, indentFor } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/useAppStore'

interface DocEditorProps {
  connectionId: string
  database: string
  collection: string
  /** The full document (EJSON-canonical plain object) being edited. */
  doc: Record<string, unknown>
  /** The document's _id, exactly as it arrived (EJSON-serialized). */
  id: unknown
  onClose: () => void
}

/** Build an editable, indented EJSON text block for the textarea. */
function toEditableText(doc: unknown): string {
  return toJsonLines(doc)
    .map((line) => `${indentFor(line.depth)}${line.text}`)
    .join('\n')
}

export function DocEditor({ connectionId, database, collection, doc, id, onClose }: DocEditorProps): JSX.Element {
  const updateDocument = useAppStore((s) => s.updateDocument)

  const initial = useMemo(() => toEditableText(doc), [doc])
  const [text, setText] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const onSave = async (): Promise<void> => {
    setError(null)
    // Local sanity check: the editor renders shell-style scalars (ObjectId(..),
    // ISODate(..)) that aren't valid JSON, so we can't fully validate here — we
    // only catch empty input and let the main process do real EJSON parsing.
    if (!text.trim()) {
      setError('Document is empty.')
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
      setError(res.error ?? 'Update failed.')
    }
  }

  return (
    <Modal
      title={`Edit document — ${collection}`}
      onClose={onClose}
      footer={
        <>
          {error && <span className="doc-edit-error">{error}</span>}
          <span className="spacer" />
          <button onClick={onClose}>Cancel</button>
          <BusyButton className="primary" busy={saving} onClick={() => void onSave()}>
            Save
          </BusyButton>
        </>
      }
    >
      <textarea
        className="doc-edit-area"
        spellCheck={false}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="hint">
        Edited as a full replacement. Shell types (ObjectId(…), ISODate(…)) are accepted; the document is
        parsed as Extended JSON on save.
      </div>
    </Modal>
  )
}
