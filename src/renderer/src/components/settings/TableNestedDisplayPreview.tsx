import { useTranslation } from 'react-i18next'
import type { TableNestedDisplay } from '@shared/types'
import { cellValue, deriveTableColumnGroups } from '@renderer/lib/tableShape'

const EXAMPLE = {
  profile: { name: 'Alex', age: 28 },
  address: { city: 'Paris', street: 'Rue A', zip: '75001', country: 'FR' }
}

export function TableNestedDisplayPreview({ display }: { display: TableNestedDisplay }): React.JSX.Element {
  const { t } = useTranslation()
  const groups = deriveTableColumnGroups([EXAMPLE], display, 'natural')
  const hasGroups = groups.some((group) => group.columns[0].path.length > 1)
  const cellClass = 'border border-[var(--separator)] px-2 py-1.5 text-left font-normal whitespace-nowrap'

  return (
    <figure className="m-0 mt-2 min-w-0" aria-label={t('settings.tableNestedExample')}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-mono text-[11px] text-[var(--text-secondary)]">
          <thead>
            <tr>
              {groups.map((group) => (
                <th
                  key={group.key}
                  className={cellClass}
                  colSpan={group.columns.length}
                  rowSpan={hasGroups && group.columns[0].path.length === 1 ? 2 : 1}
                >
                  {group.key}
                </th>
              ))}
            </tr>
            {hasGroups && (
              <tr>
                {groups
                  .filter((group) => group.columns[0].path.length > 1)
                  .flatMap((group) =>
                    group.columns.map((column) => (
                      <th key={column.id} className={cellClass}>
                        {column.label}
                      </th>
                    ))
                  )}
              </tr>
            )}
          </thead>
          <tbody>
            <tr>
              {groups.flatMap((group) =>
                group.columns.map((column) => {
                  const value = cellValue(EXAMPLE, column.path).value
                  return (
                    <td key={column.id} className={cellClass}>
                      {typeof value === 'object'
                        ? group.key === 'profile'
                          ? '{ name: "Alex", … }'
                          : '{ city: "Paris", … }'
                        : String(value)}
                    </td>
                  )
                })
              )}
            </tr>
          </tbody>
        </table>
      </div>
      <figcaption className="mt-2 text-xs text-[var(--text-secondary)]">
        {t(`settings.tableNestedHint_${display}`)}
      </figcaption>
    </figure>
  )
}
