import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { defaultRangeExtractor, observeElementOffset, useVirtualizer } from '@tanstack/react-virtual'
import { Eye, Loader2 } from 'lucide-react'
import type { GridHeightMode } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { IS_WEB } from '@renderer/lib/platform'
import { useAppStore } from '@renderer/store/useAppStore'
import { formatScalar, isExpandable, summarize } from '@renderer/lib/ejson'
import {
  GRID_FIELD_LIMIT,
  GRID_GAP,
  gridAnchorOffset,
  gridColumnCount,
  gridFields,
  gridDocumentFieldCounts,
  gridScrollGeometry,
  gridRowFieldCounts,
  gridRows,
  gridVisibleFieldIndexes
} from '@renderer/lib/gridLayout'
import { inlineText } from '@renderer/lib/format'
import { computeSelection } from '@renderer/lib/selection'
import { confirmDeleteDoc, docHasId, type DocActionContext } from '@renderer/lib/docActions'
import { claimCopyFocus, useCopyHotkey } from '@renderer/lib/useCopyHotkey'
import { copyText, plainScalarText, toCsv, toPlainJson, toPlainKeyValue, toTsv } from '@renderer/lib/resultCopy'
import { resourcePreview } from '@renderer/lib/resourcePreview'
import { ContextMenu, type ContextMenuEntry } from '@renderer/components/ContextMenu'
import { Tooltip } from '@renderer/components/ui/Tooltip'
import { AdvancedJsonCopyModal } from './AdvancedJsonCopyModal'
import { DocEditor } from './DocEditor'
import { JsonPreviewModal, type JsonPreviewSource } from './JsonPreviewModal'
import { jsonCopyMenuItems, resultExportMenuItem, type ExportDocuments } from './documentFormatMenus'
import { ResourcePreview, useResourcePreviewSettings } from './ResourcePreview'
import { useResultTimeZone } from './ResultTimeZone'
import styles from './GridView.module.css'

interface FieldFocus {
  docIndex: number
  field: string | null
}

export interface GridViewState {
  firstDocIndex: number
  rowOffset: number
  focused: FieldFocus | null
  anchor: number | null
  heightMode?: GridHeightMode
}

interface GridViewProps {
  docs: unknown[]
  visibleFields: string[] | null
  onSelectFields: () => void
  fontSize: number
  selectedDocIndexes: Set<number>
  onSelectedDocIndexesChange: (selection: Set<number>) => void
  onExport: ExportDocuments
  docCtx?: DocActionContext | null
  viewState: GridViewState
  heightMode: GridHeightMode
}

export function GridView({
  docs,
  visibleFields,
  onSelectFields,
  fontSize,
  selectedDocIndexes,
  onSelectedDocIndexesChange,
  onExport,
  docCtx,
  viewState,
  heightMode
}: GridViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  const [viewport, setViewport] = useState({ top: 0, height: 0 })
  const focused = viewState.focused
  const [activeDocIndex, setActiveDocIndex] = useState<number | null>(null)
  const [activeFieldIndex, setActiveFieldIndex] = useState<number | null>(null)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<{
    value: unknown
    title: string
    documentView: boolean
    source?: JsonPreviewSource
  } | null>(null)
  const [advancedCopy, setAdvancedCopy] = useState<unknown[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)
  const [prepared, setPrepared] = useState<{ docs: unknown[]; fields: string[] | null; counts: number[] }>()
  useEffect(() => {
    if (heightMode !== 'expanded') {
      setPrepared(undefined)
      return
    }
    const controller = new AbortController()
    void gridDocumentFieldCounts(docs, visibleFields, controller.signal).then((counts) => {
      if (counts && !controller.signal.aborted) setPrepared({ docs, fields: visibleFields, counts })
    })
    return () => controller.abort()
  }, [docs, visibleFields, heightMode])
  const expanded = heightMode === 'expanded'
  const counts = expanded && prepared?.docs === docs && prepared.fields === visibleFields ? prepared.counts : undefined
  const loading = expanded && !counts
  const rows = useMemo(
    () => gridRows(docs.length, columns, fontSize, counts && gridRowFieldCounts(counts, columns)),
    [docs.length, columns, fontSize, counts]
  )
  const getRowKey = useCallback(
    (index: number) => `${columns}:${rows[index].size}:${index}`,
    [columns, rows]
  )
  const anchorOffset = () => gridAnchorOffset(
    rows, Math.floor(viewState.firstDocIndex / columns), viewState.heightMode === heightMode ? viewState.rowOffset : 0
  )
  const reportOffset = useRef<((offset: number, scrolling: boolean) => void) | null>(null)
  const virtualizer = useVirtualizer({
    count: loading ? 0 : rows.length,
    getScrollElement: () => parentRef.current,
    getItemKey: getRowKey,
    estimateSize: (index) => rows[index].size,
    overscan: 2,
    paddingStart: GRID_GAP,
    paddingEnd: GRID_GAP,
    initialOffset: anchorOffset,
    rangeExtractor: (range) => {
      const indexes = defaultRangeExtractor(range)
      const activeRow = activeDocIndex === null ? -1 : Math.floor(activeDocIndex / columns)
      if (activeRow >= 0 && activeRow < range.count && !indexes.includes(activeRow)) {
        indexes.push(activeRow)
        indexes.sort((a, b) => a - b)
      }
      return indexes
    },
    observeElementOffset: (instance, callback) => {
      reportOffset.current = callback
      return observeElementOffset(instance, (top, scrolling) => {
        const { scale } = gridScrollGeometry(instance.getTotalSize(), instance.scrollRect?.height ?? 0)
        callback(top * scale, scrolling)
      })
    }
  })
  const { height, scale } = gridScrollGeometry(virtualizer.getTotalSize(), viewport.height)
  const logicalTop = viewport.top * scale
  const origin = logicalTop - viewport.top

  useLayoutEffect(() => {
    const element = parentRef.current!
    const resize = (): void => {
      setColumns(gridColumnCount(element.clientWidth))
      if (expanded) setViewport({ top: element.scrollTop, height: element.clientHeight })
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded])

  useLayoutEffect(() => {
    if (loading) return
    const element = parentRef.current!
    element.scrollTop = anchorOffset() / scale
    const offset = element.scrollTop * scale
    if (virtualizer.scrollOffset !== offset) reportOffset.current?.(offset, false)
    if (expanded) setViewport({ top: element.scrollTop, height: element.clientHeight })
    viewState.heightMode = heightMode
  }, [rows, columns, heightMode, expanded, loading, scale, viewState, virtualizer])

  useLayoutEffect(() => {
    setActiveDocIndex(null)
    setActiveFieldIndex(null)
    setPreview(null)
    setEditIndex(null)
    setAdvancedCopy(null)
    setMenu(null)
  }, [viewState])

  const selectField = (docIndex: number, field: string | null): void => {
    const next = { docIndex, field }
    viewState.anchor = null
    viewState.focused = next
    onSelectedDocIndexesChange(new Set())
  }

  const selectDocument = (docIndex: number, event: MouseEvent): void => {
    const next = computeSelection(selectedDocIndexes, docIndex, viewState.anchor, {
      shift: event.shiftKey,
      meta: event.metaKey,
      ctrl: event.ctrlKey
    })
    viewState.anchor = next.anchor
    viewState.focused = null
    onSelectedDocIndexesChange(next.selection)
  }

  const fieldValue = (target: FieldFocus): unknown =>
    target.field === null ? docs[target.docIndex] : (docs[target.docIndex] as Record<string, unknown>)[target.field]

  useCopyHotkey(() => {
    if (preview || editIndex !== null || advancedCopy) return null
    if (selectedDocIndexes.size) {
      const picked = [...selectedDocIndexes].sort((a, b) => a - b).map((index) => docs[index])
      return toPlainJson(picked.length === 1 ? picked[0] : picked)
    }
    if (!focused) return null
    const value = fieldValue(focused)
    return isExpandable(value) ? toPlainJson(value) : plainScalarText(value)
  })

  const openPreview = (docIndex: number, field: string | null = null): void => {
    const doc = docs[docIndex]
    setPreview({
      value: field === null ? doc : (doc as Record<string, unknown>)[field],
      title: field ?? t('result.documentPreviewTitle'),
      documentView: field === null,
      source: docCtx
        ? { ...docCtx, ...(docHasId(doc) ? { id: doc._id } : {}), ...(field === null ? {} : { field: [field] }) }
        : undefined
    })
  }

  const openMenu = (event: MouseEvent, docIndex: number, field?: string | null): void => {
    event.preventDefault()
    const doc = docs[docIndex]
    const fieldTarget = field === undefined ? null : { docIndex, field }
    const selected =
      fieldTarget || !selectedDocIndexes.has(docIndex)
        ? [doc]
        : [...selectedDocIndexes].sort((a, b) => a - b).map((index) => docs[index])
    if (fieldTarget) selectField(docIndex, fieldTarget.field)
    else if (!selectedDocIndexes.has(docIndex)) {
      viewState.anchor = docIndex
      viewState.focused = null
      onSelectedDocIndexesChange(new Set([docIndex]))
    }
    const items: ContextMenuEntry[] = [
      { label: t('result.dataMenu.view'), onClick: () => openPreview(docIndex, field ?? null) },
      { label: t('result.selectFields'), onClick: onSelectFields }
    ]
    if (docCtx && docHasId(doc)) items.push({ label: t('tree.editDoc'), onClick: () => setEditIndex(docIndex) })
    items.push({
      label: t('result.dataMenu.copy'),
      children: fieldTarget
        ? [
            ...(field == null ? [] : [{ label: t('result.dataMenu.copyKey'), onClick: () => void copyText(field) }]),
            {
              label: t('result.dataMenu.copyValue'),
              onClick: () => {
                const value = fieldValue(fieldTarget)
                void copyText(isExpandable(value) ? toPlainJson(value) : plainScalarText(value))
              }
            },
            ...(field == null
              ? []
              : [
                  {
                    label: t('result.dataMenu.copyKeyValue'),
                    onClick: () => void copyText(toPlainKeyValue(field, fieldValue(fieldTarget)))
                  }
                ])
          ]
        : [
            ...jsonCopyMenuItems(selected, (text) => void copyText(text), setAdvancedCopy),
            {
              label: t('result.copy.csv'),
              onClick: () => void copyText(toCsv(selected, useAppStore.getState().settings.resultFieldSort))
            },
            {
              label: t('result.copy.tsv'),
              onClick: () => void copyText(toTsv(selected, useAppStore.getState().settings.resultFieldSort))
            }
          ]
    })
    if (!IS_WEB) items.push(resultExportMenuItem(selected, onExport))
    if (docCtx && docHasId(doc))
      items.push('separator', {
        label: t('tree.deleteDoc'),
        danger: true,
        onClick: () => void confirmDeleteDoc(docCtx, doc._id)
      })
    setMenu({ x: event.clientX, y: event.clientY, items })
  }

  const editDoc = editIndex === null ? undefined : docs[editIndex]
  return (
    <div
      ref={parentRef}
      className={styles.scroller}
      style={{ fontSize }}
      aria-busy={loading}
      tabIndex={-1}
      onMouseDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return
        claimCopyFocus((event.target as Element).closest<HTMLButtonElement>('button') ?? parentRef.current)
      }}
      onFocusCapture={(event) => {
        const card = (event.target as Element).closest<HTMLElement>('[data-doc-index]')
        setActiveDocIndex(card ? Number(card.dataset.docIndex) : null)
        const field = (event.target as Element).closest<HTMLElement>('[data-grid-field-index]')
        setActiveFieldIndex(field ? Number(field.dataset.gridFieldIndex) : null)
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setActiveDocIndex(null)
          setActiveFieldIndex(null)
        }
      }}
      onScroll={(event) => {
        const top = event.currentTarget.scrollTop
        if (expanded) setViewport({ top, height: event.currentTarget.clientHeight })
        if (loading || !rows.length) return
        const offset = top * scale
        const row = virtualizer.getVirtualItemForOffset(offset)
        if (!row) return
        viewState.firstDocIndex = row.index * columns
        viewState.rowOffset = offset - row.start
        viewState.heightMode = heightMode
      }}
    >
      {docs.length === 0 && <div className="center-msg muted">{t('tree.noDocuments')}</div>}
      {loading && (
        <div className={styles.loading} role="status">
          <Loader2 size={20} className="animate-spin" aria-label={t('common.loading')} />
        </div>
      )}
      <div className={styles.inner} style={{ height: loading ? viewport.height : height }}>
        {virtualizer.getVirtualItems().map((row) => {
          const top = Math.max(0, row.start - origin)
          const clipped = Math.max(0, origin - row.start)
          return (
            <div
              key={row.key}
              className={styles.row}
              style={{
                transform: `translateY(${top}px)`,
                height: Math.max(0, Math.min(row.size - GRID_GAP - clipped, height - top)),
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
              }}
            >
              {Array.from({ length: Math.min(columns, docs.length - row.index * columns) }, (_, column) => {
                const index = row.index * columns + column
                return (
                  <GridCard
                    key={index}
                    doc={docs[index]}
                    index={index}
                    visibleFields={visibleFields}
                    selected={selectedDocIndexes.has(index)}
                    focused={selectedDocIndexes.size === 0 && focused?.docIndex === index ? focused : null}
                    expanded={expanded}
                    rowStart={row.start}
                    scrollTop={logicalTop}
                    clipped={clipped}
                    viewportHeight={viewport.height}
                    lineHeight={fontSize + 11}
                    activeFieldIndex={activeDocIndex === index ? activeFieldIndex : null}
                    onSelect={(event) => selectDocument(index, event)}
                    onFieldSelect={(field) => selectField(index, field)}
                    onPreview={(field) => openPreview(index, field)}
                    onMenu={(event, field) => openMenu(event, index, field)}
                  />
                )
              })}
            </div>
          )
        })}
      </div>
      {preview && (
        <JsonPreviewModal
          {...preview}
          fontSize={fontSize}
          onValueChange={(value) => setPreview((current) => (current ? { ...current, value } : current))}
          onClose={() => setPreview(null)}
        />
      )}
      {docCtx && docHasId(editDoc) && (
        <DocEditor {...docCtx} id={editDoc._id} onClose={() => setEditIndex(null)} />
      )}
      {advancedCopy && <AdvancedJsonCopyModal documents={advancedCopy} onClose={() => setAdvancedCopy(null)} />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

interface GridCardProps {
  doc: unknown
  index: number
  visibleFields: string[] | null
  selected: boolean
  focused: FieldFocus | null
  expanded: boolean
  clipped: number
  rowStart: number
  scrollTop: number
  viewportHeight: number
  lineHeight: number
  activeFieldIndex: number | null
  onSelect: (event: MouseEvent) => void
  onFieldSelect: (field: string | null) => void
  onPreview: (field?: string | null) => void
  onMenu: (event: MouseEvent, field?: string | null) => void
}

function GridCard({
  doc,
  index,
  visibleFields,
  selected,
  focused,
  expanded,
  clipped,
  rowStart,
  scrollTop,
  viewportHeight,
  lineHeight,
  activeFieldIndex,
  onSelect,
  onFieldSelect,
  onPreview,
  onMenu
}: GridCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const sort = useAppStore((state) => state.settings.resultFieldSort)
  const idFirst = useAppStore((state) => state.settings.resultIdFirst)
  const fields = useMemo(() => gridFields(doc, visibleFields, sort, idFirst), [doc, visibleFields, sort, idFirst])
  const fieldCount = fields === null ? 1 : fields.length
  const fieldIndexes = expanded
    ? gridVisibleFieldIndexes(fieldCount, rowStart + 41, scrollTop, viewportHeight, lineHeight, activeFieldIndex)
    : Array.from({ length: Math.min(fieldCount, GRID_FIELD_LIMIT) }, (_, index) => index)
  return (
    <article
      className={`${styles.card}${selected ? ` ${styles.selected}` : ''}`}
      data-doc-index={index}
      onContextMenu={(event) => onMenu(event)}
    >
      <div className={styles.header}>
        <button
          type="button"
          className={styles.handle}
          aria-pressed={selected}
          aria-label={`${t('tree.documentType')} ${index + 1}`}
          onClick={onSelect}
          onDoubleClick={() => onPreview()}
        >
          {index + 1}
        </button>
      </div>
      <div className={styles.fields}>
        {fieldIndexes.map((fieldIndex) => {
          const field = fields === null ? null : fields[fieldIndex]
          return (
            <GridField
              key={field ?? 'value'}
              field={field}
              value={field === null ? doc : (doc as Record<string, unknown>)[field]}
              focused={focused !== null && focused.field === field}
              index={fieldIndex}
              top={4 + fieldIndex * lineHeight - clipped}
              onSelect={() => onFieldSelect(field)}
              onPreview={() => onPreview(field)}
              onMenu={(event) => {
                event.stopPropagation()
                onMenu(event, field)
              }}
            />
          )
        })}
        {fields?.length === 0 && (
          <span className={styles.empty}>{Object.keys(doc as object).length === 0 ? '{}' : '—'}</span>
        )}
      </div>
      <div className={styles.footer}>
        {!expanded && fields !== null && fields.length > GRID_FIELD_LIMIT && (
          <button
            type="button"
            aria-label={`${t('result.dataMenu.view')} ${t('result.gridMoreFields', { count: fields.length - GRID_FIELD_LIMIT })}`}
            onClick={() => onPreview()}
          >
            <Eye size={14} aria-hidden="true" />
            {t('result.gridMoreFields', { count: fields.length - GRID_FIELD_LIMIT })}
          </button>
        )}
      </div>
    </article>
  )
}

function GridField({
  field,
  value,
  focused,
  index,
  top,
  onSelect,
  onPreview,
  onMenu
}: {
  field: string | null
  value: unknown
  focused: boolean
  index: number
  top: number
  onSelect: () => void
  onPreview: () => void
  onMenu: (event: MouseEvent) => void
}): React.JSX.Element {
  const timeZone = useResultTimeZone()
  const settings = useResourcePreviewSettings()
  const display = useMemo(
    () =>
      isExpandable(value)
        ? { text: summarize(value), type: Array.isArray(value) ? 'array' : 'object' }
        : formatScalar(value, timeZone),
    [value, timeZone]
  )
  const text = inlineText(display.text)
  const keyText = field === null ? null : inlineText(field)
  const resource = resourcePreview(value, settings)
  return (
    <div
      className={`${styles.field}${focused ? ` ${styles.focused}` : ''}`}
      data-grid-field-index={index}
      style={{ top }}
    >
      <button
        type="button"
        className={styles.fieldButton}
        onClick={onSelect}
        onDoubleClick={onPreview}
        onContextMenu={onMenu}
      >
        {field !== null && (
          <span className={styles.key} title={keyText ?? undefined}>
            {keyText}
          </span>
        )}
        <Tooltip
          content={resource ? () => <ResourcePreview key={resource.url} resource={resource} /> : text}
          variant={resource ? 'image' : 'compact'}
        >
          <span className={`${styles.value} v-${display.type}`}>{text}</span>
        </Tooltip>
      </button>
      {isExpandable(value) && (
        <button type="button" className={styles.expand} aria-label={keyText ?? text} onClick={onPreview}>
          ›
        </button>
      )}
    </div>
  )
}
