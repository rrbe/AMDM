import { useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual'
import { Eye } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { IS_WEB } from '@renderer/lib/platform'
import { useAppStore } from '@renderer/store/useAppStore'
import { formatScalar, isExpandable, summarize } from '@renderer/lib/ejson'
import { GRID_FIELD_LIMIT, GRID_GAP, gridColumnCount, gridFields } from '@renderer/lib/gridLayout'
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
  viewState
}: GridViewProps): React.JSX.Element {
  const { t } = useTranslation()
  const parentRef = useRef<HTMLDivElement>(null)
  const [columns, setColumns] = useState(1)
  const [focused, setFocused] = useState(viewState.focused)
  const [activeDocIndex, setActiveDocIndex] = useState<number | null>(null)
  const [editIndex, setEditIndex] = useState<number | null>(null)
  const [preview, setPreview] = useState<{
    value: unknown
    title: string
    documentView: boolean
    source?: JsonPreviewSource
  } | null>(null)
  const [advancedCopy, setAdvancedCopy] = useState<unknown[] | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null)
  const rowHeight = GRID_FIELD_LIMIT * (fontSize + 11) + 76
  const stride = rowHeight + GRID_GAP
  const virtualizer = useVirtualizer({
    count: Math.ceil(docs.length / columns),
    getScrollElement: () => parentRef.current,
    estimateSize: () => stride,
    overscan: 2,
    rangeExtractor: (range) => {
      const rows = defaultRangeExtractor(range)
      if (activeDocIndex !== null) {
        const activeRow = Math.floor(activeDocIndex / columns)
        if (!rows.includes(activeRow)) rows.push(activeRow)
      }
      return rows.sort((a, b) => a - b)
    },
    paddingStart: GRID_GAP,
    paddingEnd: GRID_GAP,
    initialOffset: () => Math.floor(viewState.firstDocIndex / columns) * stride + viewState.rowOffset
  })

  useLayoutEffect(() => {
    const element = parentRef.current!
    const resize = (): void => setColumns(gridColumnCount(element.clientWidth))
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useLayoutEffect(() => {
    virtualizer.measure()
    const element = parentRef.current!
    element.scrollTop = Math.floor(viewState.firstDocIndex / columns) * stride + viewState.rowOffset
  }, [columns, stride, viewState, virtualizer])

  useLayoutEffect(() => {
    setFocused(viewState.focused)
    setActiveDocIndex(null)
    setPreview(null)
    setEditIndex(null)
    setAdvancedCopy(null)
    setMenu(null)
  }, [viewState])

  const selectField = (docIndex: number, field: string | null): void => {
    const next = { docIndex, field }
    viewState.focused = next
    setFocused(next)
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
    setFocused(null)
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
      setFocused(null)
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
      tabIndex={-1}
      onMouseDown={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return
        claimCopyFocus((event.target as Element).closest<HTMLButtonElement>('button') ?? parentRef.current)
      }}
      onFocusCapture={(event) => {
        const card = (event.target as Element).closest<HTMLElement>('[data-doc-index]')
        setActiveDocIndex(card ? Number(card.dataset.docIndex) : null)
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActiveDocIndex(null)
      }}
      onScroll={(event) => {
        const top = Math.max(0, event.currentTarget.scrollTop - GRID_GAP)
        viewState.firstDocIndex = Math.floor(top / stride) * columns
        viewState.rowOffset = (top % stride) + GRID_GAP
      }}
    >
      {docs.length === 0 && <div className="center-msg muted">{t('tree.noDocuments')}</div>}
      <div className={styles.inner} style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => (
          <div
            key={row.index}
            className={styles.row}
            style={{
              transform: `translateY(${row.start}px)`,
              height: rowHeight,
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
                  onSelect={(event) => selectDocument(index, event)}
                  onFieldSelect={(field) => selectField(index, field)}
                  onPreview={(field) => openPreview(index, field)}
                  onMenu={(event, field) => openMenu(event, index, field)}
                />
              )
            })}
          </div>
        ))}
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
        <DocEditor {...docCtx} doc={editDoc} id={editDoc._id} onClose={() => setEditIndex(null)} />
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
  onSelect,
  onFieldSelect,
  onPreview,
  onMenu
}: GridCardProps): React.JSX.Element {
  const { t } = useTranslation()
  const sort = useAppStore((state) => state.settings.resultFieldSort)
  const idFirst = useAppStore((state) => state.settings.resultIdFirst)
  const fields = useMemo(() => gridFields(doc, visibleFields, sort, idFirst), [doc, visibleFields, sort, idFirst])
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
        <button
          type="button"
          className={styles.preview}
          aria-label={t('result.documentPreviewTitle')}
          onClick={() => onPreview()}
        >
          <Eye size={14} />
        </button>
      </div>
      <div className={styles.fields}>
        {(fields === null ? [null] : fields.slice(0, GRID_FIELD_LIMIT)).map((field) => (
          <GridField
            key={field ?? 'value'}
            field={field}
            value={field === null ? doc : (doc as Record<string, unknown>)[field]}
            focused={focused !== null && focused.field === field}
            onSelect={() => onFieldSelect(field)}
            onPreview={() => onPreview(field)}
            onMenu={(event) => {
              event.stopPropagation()
              onMenu(event, field)
            }}
          />
        ))}
        {fields?.length === 0 && (
          <span className={styles.empty}>{Object.keys(doc as object).length === 0 ? '{}' : '—'}</span>
        )}
      </div>
      <div className={styles.footer}>
        {fields !== null && fields.length > GRID_FIELD_LIMIT && (
          <button type="button" onClick={() => onPreview()}>
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
  onSelect,
  onPreview,
  onMenu
}: {
  field: string | null
  value: unknown
  focused: boolean
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
  const resource = resourcePreview(value, settings)
  return (
    <div className={`${styles.field}${focused ? ` ${styles.focused}` : ''}`}>
      <button
        type="button"
        className={styles.fieldButton}
        onClick={onSelect}
        onDoubleClick={onPreview}
        onContextMenu={onMenu}
      >
        {field !== null && (
          <span className={styles.key} title={field}>
            {field}
          </span>
        )}
        <Tooltip
          content={resource ? () => <ResourcePreview key={resource.url} resource={resource} /> : display.text}
          variant={resource ? 'image' : 'compact'}
        >
          <span className={`${styles.value} v-${display.type}`}>{display.text}</span>
        </Tooltip>
      </button>
      {isExpandable(value) && (
        <button type="button" className={styles.expand} aria-label={field ?? display.text} onClick={onPreview}>
          ›
        </button>
      )}
    </div>
  )
}
