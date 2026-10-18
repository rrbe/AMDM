import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { getSystemTimeZone } from '@renderer/lib/dateTimeZone'
import { createTimeZoneChoices, matchesTimeZoneSearch } from '@renderer/lib/timeZoneOptions'
import { SearchableSelect, type SearchableSelectOption } from './SearchableSelect'

interface TimeZoneSelectProps {
  value: string
  onChange: (value: string) => void
  variant?: 'field' | 'menu'
}

export function TimeZoneSelect({ value, onChange, variant = 'field' }: TimeZoneSelectProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const choices = useMemo(() => {
    const entries = createTimeZoneChoices(new Date(), i18n.resolvedLanguage ?? 'en', getSystemTimeZone())
    entries[0].searchText = `${t('settings.timeZoneSystem')} ${entries[0].searchText}`
    return new Map(entries.map((entry) => [entry.value, entry]))
  }, [t, i18n.resolvedLanguage])
  const options = useMemo(() => {
    return [...choices.values()].map((choice) => ({
      value: choice.value,
      filterText: choice.searchText,
      pinned: choice.value === 'system',
      label: choice.value === 'system' ? `${t('settings.timeZoneSystem')} · ${choice.label}` : choice.label
    }))
  }, [choices, t])
  const matches = useCallback((option: SearchableSelectOption<string>, query: string): boolean =>
    matchesTimeZoneSearch(choices.get(option.value)!, query), [choices])
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      side={variant === 'menu' ? 'right' : 'bottom'}
      options={options}
      matches={matches}
      triggerContent={variant === 'menu' ? <>
        <span className="shrink-0">{t('settings.timeZone')}</span>
        <span className="ml-auto truncate text-muted-foreground">{value === 'system' ? t('settings.timeZoneSystem') : value}</span>
        <ChevronRight size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </> : <>
        <span className="truncate">{selectedLabel}</span>
        <ChevronDown size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
      </>}
      placeholder={t('settings.timeZoneSearchPlaceholder')}
      emptyMessage={t('settings.timeZoneEmpty')}
      aria-label={t('settings.timeZone')}
      popupClassName="h-[min(360px,var(--available-height))] w-[min(520px,calc(100vw-24px))] min-w-0"
      className={variant === 'menu'
        ? 'h-8 justify-between gap-3 rounded-[4px] bg-transparent px-2 text-[13px]'
        : 'h-[38px] justify-between gap-2 px-3 text-[13px]'}
    />
  )
}
