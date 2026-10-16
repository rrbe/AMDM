import { useMemo } from 'react'
import { IANA_TIME_ZONES } from '@shared/timeZones'
import { SearchableSelect, type SearchableSelectOption } from './SearchableSelect'

interface TimeZoneSelectProps {
  value: string
  onChange: (value: string) => void
  label: string
  systemOptionLabel?: string
  defaultOptionLabel?: string
  header: string
  placeholder: string
  emptyMessage: string
}

function matchesTimeZone(filterText: string, query: string): boolean {
  return filterText.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
}

export function TimeZoneSelect({
  value,
  onChange,
  label,
  systemOptionLabel,
  defaultOptionLabel,
  header,
  placeholder,
  emptyMessage
}: TimeZoneSelectProps): React.JSX.Element {
  const options = useMemo(() => {
    const extra: SearchableSelectOption<string>[] = []
    if (systemOptionLabel) extra.push({ value: 'system', label: systemOptionLabel, filterText: systemOptionLabel })
    if (defaultOptionLabel) extra.push({ value: 'default', label: defaultOptionLabel, filterText: defaultOptionLabel })
    return [
      ...extra,
      ...IANA_TIME_ZONES.map((timeZone) => ({ value: timeZone, label: timeZone, filterText: timeZone }))
    ]
  }, [systemOptionLabel, defaultOptionLabel])
  const selected = options.find((option) => option.value === value)

  return (
    <SearchableSelect
      value={value}
      onChange={onChange}
      options={options}
      matches={matchesTimeZone}
      triggerContent={<span className="truncate">{selected?.label ?? value}</span>}
      header={header}
      placeholder={placeholder}
      emptyMessage={emptyMessage}
      aria-label={label}
      className="h-[38px] justify-between px-3 text-[13px]"
    />
  )
}
