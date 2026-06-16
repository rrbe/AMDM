import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'
import { useAppStore, getActiveTab } from '@renderer/store/useAppStore'
import { Button } from '@renderer/components/common/Button'
import { Select } from '@renderer/components/ui/Select'
import type { StageTarget } from '@renderer/lib/stageCompletion'
import { StageCard } from './StageCard'
import styles from './pipeline.module.css'

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
  const loadCollections = useAppStore((s) => s.loadCollections)

  const [dragIndex, setDragIndex] = useState<number | null>(null)

  const collection = pipeline?.collection ?? ''
  // Ensure the collection dropdown has options even when the db was never
  // expanded in the explorer (catalog collections lazy-load on demand).
  useEffect(() => {
    if (activeConnectionId && activeDatabase) void loadCollections(activeConnectionId, activeDatabase)
  }, [activeConnectionId, activeDatabase, loadCollections])

  // Warm the field cache so stage-body completion has names to offer.
  useEffect(() => {
    if (activeConnectionId && activeDatabase && collection) {
      void sampleFields(activeConnectionId, activeDatabase, collection)
    }
  }, [activeConnectionId, activeDatabase, collection, sampleFields])

  // Once collections arrive, default to the first if none was guessed at open.
  const firstColl =
    (activeConnectionId && catalogs[activeConnectionId]?.collections[activeDatabase]?.[0]?.name) || ''
  useEffect(() => {
    if (pipeline?.open && !pipeline.collection && firstColl) setCollection(firstColl)
  }, [pipeline?.open, pipeline?.collection, firstColl, setCollection])

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
    <div className={styles.pipelinePanel}>
      <div className={styles.pipelineHead}>
        <span className={styles.pipelineTitle}>{t('builder.title')}</span>
        <span className={styles.spacer} />
        <button
          className={styles.pipelineClose}
          onClick={togglePipeline}
          data-tip={t('builder.close')}
          aria-label={t('builder.close')}
        >
          <X size={15} />
        </button>
      </div>

      <div className={styles.pipelineTarget}>
        <span className={styles.pipelineTargetDb} data-tip={t('builder.collection')}>
          {activeDatabase || t('builder.noDb')}
        </span>
        <Select
          className={styles.pipelineColl}
          value={collection}
          onChange={setCollection}
          options={collOptions}
          placeholder={t('builder.selectCollection')}
          aria-label={t('builder.collection')}
        />
      </div>

      <div className={styles.pipelineStages}>
        {pipeline.stages.length === 0 ? (
          <div className={`${styles.pipelineEmpty} muted`}>{t('builder.empty')}</div>
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

      <div className={styles.pipelineFoot}>
        <Button onClick={() => addStage()} data-tip={t('builder.addStageTip')}>
          <Plus size={14} /> {t('builder.addStage')}
        </Button>
        <span className={styles.spacer} />
        <Button variant="primary" disabled={!collection} onClick={applyPipeline} data-tip={t('builder.applyTip')}>
          {t('builder.apply')}
        </Button>
      </div>
    </div>
  )
}
