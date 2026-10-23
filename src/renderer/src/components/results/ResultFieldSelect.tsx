import { useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Input } from '@renderer/components/ui/Input'

export function ResultFieldSelect({ fields }: { fields: string[] }): React.JSX.Element {
  const { t } = useTranslation()
  const selected = useAppStore((s) => getActiveTab(s).visibleFields)
  const setSelected = useAppStore((s) => s.setVisibleFields)
  const [search, setSearch] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const current = useMemo(() => new Set(fields), [fields])
  const checked = useMemo(() => new Set(selected ?? fields), [selected, fields])
  const allSelected = selected === null || (checked.size > 0 && fields.every((field) => checked.has(field)))
  const options = useMemo(() => {
    const all = [...new Set([...fields, ...(selected ?? [])])]
    const query = search.trim().toLocaleLowerCase()
    return all.filter((field) => field.toLocaleLowerCase().includes(query))
  }, [fields, selected, search])
  const virtualizer = useVirtualizer({
    count: options.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 32,
    getItemKey: (index) => options[index],
    overscan: 5
  })

  return (
    <div className="mb-2 flex flex-col gap-2 border-b border-[var(--separator)] pb-2">
      <Input
        className="h-7 text-xs"
        aria-label={t('result.searchFields')}
        placeholder={t('result.searchFields')}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value)
          scrollRef.current?.scrollTo({ top: 0 })
        }}
      />
      <Checkbox
        checked={allSelected}
        indeterminate={!allSelected && checked.size > 0}
        label={t('result.visibleFields')}
        onCheckedChange={(on) => setSelected(on ? null : [])}
      />
      <div ref={scrollRef} className="h-[192px] overflow-auto">
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((row) => {
            const field = options[row.index]
            return (
              <div key={field} className="absolute left-0 top-0 flex w-full items-center" style={{ height: row.size, transform: `translateY(${row.start}px)` }}>
                <Checkbox
                  checked={checked.has(field)}
                  className="w-full! min-w-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate"
                  label={<span title={field}>{field}{!current.has(field) && <span className="ml-1 text-muted-foreground">({t('result.fieldNotOnPage')})</span>}</span>}
                  onCheckedChange={(on) => {
                    const next = new Set(checked)
                    if (on) next.add(field)
                    else next.delete(field)
                    setSelected([...next])
                  }}
                />
              </div>
            )
          })}
        </div>
        {options.length === 0 && <span className="text-muted-foreground">{t('result.noMatchingFields')}</span>}
      </div>
    </div>
  )
}
