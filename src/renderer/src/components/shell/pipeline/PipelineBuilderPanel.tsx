import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import { Button } from '@renderer/components/common/Button'
import { Select } from '@renderer/components/ui/Select'
import type { StageTarget } from '@renderer/lib/stageCompletion'
import { StageCard } from './StageCard'

/**
 * The aggregation pipeline builder — a collapsible panel beside the editor.
 * Build stages (type + JSON body), reorder by drag, preview each stage's output,
 * then "apply" the generated `db.<coll>.aggregate([...])` into the editor. Lives
 * on the active tab (`tab.pipeline`); renders nothing until opened.
 */
export function PipelineBuilderPanel(): JSX.Element | null {
  const { t } = useTranslation()
  const pipeline = useAppStore((s) => getActiveTab(s).pipeline)
  const activeConnectionId = useAppStore((s) => s.activeConnectionId)
  const activeDatabase = useAppStore((s) => getActiveTab(s).activeDatabase)
  const catalogs = useAppStore((s) => s.catalogs)
  const previews = useAppStore((s) => s.pipelinePreviews)
  const togglePipeline = useAppStore((s) => s.togglePipeline)
  const setCollection = useAppStore((s) => s.setPipelineCollection)
  const addStage = useAppStore((s) => s.addPipelineStage)
  const moveStage = useAppStore((s) => s.movePipelineStage)
  const applyPipeline = useAppStore((s) => s.applyPipeline)
  const sampleFields = useAppStore((s) => s.sampleFields)

  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const collection = pipeline?.collection ?? ''
  // Warm the field cache so stage-body completion has names to offer.
  useEffect(() => {
    if (activeConnectionId && activeDatabase && collection) {
      void sampleFields(activeConnectionId, activeDatabase, collection)
    }
  }, [activeConnectionId, activeDatabase, collection, sampleFields])

  if (!pipeline) return null

  const collOptions = (
    (activeConnectionId && catalogs[activeConnectionId]?.collections[activeDatabase]) || []
  ).map((c) => ({ label: c.name, value: c.name }))
  // Keep the current collection selectable even if the catalog isn't loaded yet.
  if (collection && !collOptions.some((o) => o.value === collection)) {
    collOptions.unshift({ label: collection, value: collection })
  }

  const target: StageTarget | null =
    activeConnectionId && collection ? { connId: activeConnectionId, db: activeDatabase, coll: collection } : null

  const onDrop = (to: number): void => {
    if (dragIndex !== null && dragIndex !== to) moveStage(dragIndex, to)
    setDragIndex(null)
  }

  return (
    <div className="pipeline-panel">
      <div className="pipeline-head">
        <span className="pipeline-title">{t('builder.title')}</span>
        <span className="spacer" />
        <button
          className="pipeline-close"
          onClick={togglePipeline}
          data-tip={t('builder.close')}
          aria-label={t('builder.close')}
        >
          <X size={15} />
        </button>
      </div>

      <div className="pipeline-target">
        <span className="pipeline-target-db" data-tip={t('builder.collection')}>
          {activeDatabase || t('builder.noDb')}
        </span>
        <Select
          className="pipeline-coll"
          value={collection}
          onChange={setCollection}
          options={collOptions}
          placeholder={t('builder.selectCollection')}
          aria-label={t('builder.collection')}
        />
      </div>

      <div className="pipeline-stages">
        {pipeline.stages.length === 0 ? (
          <div className="pipeline-empty muted">{t('builder.empty')}</div>
        ) : (
          pipeline.stages.map((stage, i) => (
            <StageCard
              key={stage.id}
              stage={stage}
              index={i}
              target={target}
              preview={previews[stage.id]}
              dragging={dragIndex === i}
              onDragStart={setDragIndex}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onDragEnd={() => setDragIndex(null)}
            />
          ))
        )}
      </div>

      <div className="pipeline-foot">
        <Button onClick={() => addStage()} data-tip={t('builder.addStageTip')}>
          <Plus size={14} /> {t('builder.addStage')}
        </Button>
        <span className="spacer" />
        <Button variant="primary" disabled={!collection} onClick={applyPipeline} data-tip={t('builder.applyTip')}>
          {t('builder.apply')}
        </Button>
      </div>
    </div>
  )
}
