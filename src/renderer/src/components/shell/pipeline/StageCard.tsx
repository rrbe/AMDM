import { useTranslation } from 'react-i18next'
import { GripVertical, Play, X } from 'lucide-react'
import { useAppStore, type StagePreview } from '@renderer/store/useAppStore'
import { STAGE_OPS, isWriteStage, type AggregationStage } from '@renderer/lib/pipelineBuilder'
import { indentFor, toJsonLines } from '@renderer/lib/format'
import { Select } from '@renderer/components/ui/Select'
import { StageEditor } from './StageEditor'
import type { StageTarget } from '@renderer/lib/stageCompletion'
import styles from './pipeline.module.css'

interface StageCardProps {
  stage: AggregationStage
  index: number
  target: StageTarget | null
  preview?: StagePreview
  dragging: boolean
  onDragStart: (index: number) => void
  onDragOver: (e: React.DragEvent, index: number) => void
  onDrop: (index: number) => void
  onDragEnd: () => void
}

const OP_OPTIONS = STAGE_OPS.map((o) => ({ label: o.op, value: o.op }))

/** One stage in the builder: type dropdown, enable toggle, preview / remove,
    a CodeMirror body, and (once previewed) its sample count + a sample drawer. */
export function StageCard({
  stage,
  index,
  target,
  preview,
  dragging,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd
}: StageCardProps): JSX.Element {
  const { t } = useTranslation()
  const setOp = useAppStore((s) => s.setPipelineStageOp)
  const setBody = useAppStore((s) => s.setPipelineStageBody)
  const toggle = useAppStore((s) => s.togglePipelineStage)
  const remove = useAppStore((s) => s.removePipelineStage)
  const runPreview = useAppStore((s) => s.previewPipelineStage)

  // A write stage ($out/$merge) must never be "previewed" — that would run the
  // server-side write. Disabled here (and stripped in buildPreviewCode as a
  // backstop). Also block re-clicks while a preview is already in flight.
  const writeStage = isWriteStage(stage.op)
  const previewDisabled = !stage.enabled || writeStage || (preview?.loading ?? false)
  const isError = preview?.result?.kind === 'error'
  const cls = [styles.stageCard, !stage.enabled && styles.disabled, isError && styles.error, dragging && styles.dragging]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} onDragOver={(e) => onDragOver(e, index)} onDrop={() => onDrop(index)}>
      <div className={styles.stageHead}>
        <span
          className={styles.stageDrag}
          draggable
          onDragStart={() => onDragStart(index)}
          onDragEnd={onDragEnd}
          data-tip={t('builder.drag')}
          aria-label={t('builder.drag')}
        >
          <GripVertical size={14} />
        </span>
        <span className={styles.stageNum}>{index + 1}</span>
        <Select
          className={styles.stageOp}
          value={stage.op}
          onChange={(op) => setOp(stage.id, op)}
          options={OP_OPTIONS}
          aria-label={t('builder.stageType')}
        />
        <span className={styles.spacer} />
        <button
          className={styles.stageIconBtn}
          disabled={previewDisabled}
          onClick={() => void runPreview(index)}
          data-tip={writeStage ? t('builder.previewWriteDisabled') : t('builder.preview')}
          aria-label={t('builder.preview')}
        >
          <Play size={13} />
        </button>
        <label className={styles.stageEnable} data-tip={t('builder.enableTip')}>
          <input type="checkbox" checked={stage.enabled} onChange={() => toggle(stage.id)} />
        </label>
        <button
          className={styles.stageIconBtn}
          onClick={() => remove(stage.id)}
          data-tip={t('builder.removeStage')}
          aria-label={t('builder.removeStage')}
        >
          <X size={14} />
        </button>
      </div>

      <StageEditor value={stage.body} onChange={(body) => setBody(stage.id, body)} target={target} />

      {preview && <PreviewFooter preview={preview} />}
    </div>
  )
}

function PreviewFooter({ preview }: { preview: StagePreview }): JSX.Element | null {
  const { t } = useTranslation()
  if (preview.loading) return <div className={`${styles.stagePreview} muted`}>{t('builder.previewing')}</div>

  const r = preview.result
  if (!r) return null
  if (r.kind === 'error')
    return <div className={`${styles.stagePreview} ${styles.err}`}>{r.error ?? t('builder.previewFailed')}</div>

  const docs = Array.isArray(r.data) ? (r.data as unknown[]) : []
  const count = r.count ?? docs.length
  return (
    <details className={styles.stagePreview}>
      <summary>
        {t('builder.previewCount', { count })}
        {r.truncated ? '+' : ''}
      </summary>
      <div className={styles.stagePreviewBox}>
        {toJsonLines(docs).map((line, i) => (
          <pre key={i} className={styles.stagePreviewLine}>
            {indentFor(line.depth)}
            {line.text}
          </pre>
        ))}
      </div>
    </details>
  )
}
