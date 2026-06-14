import { useTranslation } from 'react-i18next'
import { GripVertical, Play, X } from 'lucide-react'
import { useAppStore, type StagePreview } from '@renderer/store/useAppStore'
import { STAGE_OPS, type AggregationStage } from '@renderer/lib/pipelineBuilder'
import { indentFor, toJsonLines } from '@renderer/lib/format'
import { Select } from '@renderer/components/ui/Select'
import { StageEditor } from './StageEditor'
import type { StageTarget } from '@renderer/lib/stageCompletion'

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

  const isError = preview?.result?.kind === 'error'
  const cls = ['stage-card', !stage.enabled && 'disabled', isError && 'error', dragging && 'dragging']
    .filter(Boolean)
    .join(' ')

  return (
    <div className={cls} onDragOver={(e) => onDragOver(e, index)} onDrop={() => onDrop(index)}>
      <div className="stage-head">
        <span
          className="stage-drag"
          draggable
          onDragStart={() => onDragStart(index)}
          onDragEnd={onDragEnd}
          data-tip={t('builder.drag')}
          aria-label={t('builder.drag')}
        >
          <GripVertical size={14} />
        </span>
        <span className="stage-num">{index + 1}</span>
        <Select
          className="stage-op"
          value={stage.op}
          onChange={(op) => setOp(stage.id, op)}
          options={OP_OPTIONS}
          aria-label={t('builder.stageType')}
        />
        <span className="spacer" />
        <button
          className="stage-icon-btn"
          disabled={!stage.enabled}
          onClick={() => void runPreview(index)}
          data-tip={t('builder.preview')}
          aria-label={t('builder.preview')}
        >
          <Play size={13} />
        </button>
        <label className="stage-enable" data-tip={t('builder.enableTip')}>
          <input type="checkbox" checked={stage.enabled} onChange={() => toggle(stage.id)} />
        </label>
        <button
          className="stage-icon-btn"
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
  if (preview.loading) return <div className="stage-preview muted">{t('builder.previewing')}</div>

  const r = preview.result
  if (!r) return null
  if (r.kind === 'error') return <div className="stage-preview err">{r.error ?? t('builder.previewFailed')}</div>

  const docs = Array.isArray(r.data) ? (r.data as unknown[]) : []
  const count = r.count ?? docs.length
  return (
    <details className="stage-preview">
      <summary>
        {t('builder.previewCount', { count })}
        {r.truncated ? '+' : ''}
      </summary>
      <div className="stage-preview-box">
        {toJsonLines(docs).map((line, i) => (
          <pre key={i} className="stage-preview-line">
            {indentFor(line.depth)}
            {line.text}
          </pre>
        ))}
      </div>
    </details>
  )
}
