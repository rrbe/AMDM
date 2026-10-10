import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { AuthorizationResult } from '@shared/types'
import { Button } from '@renderer/components/common/Button'
import { Collapsible } from '@renderer/components/ui/Collapsible'
import { cn } from '@renderer/lib/utils'

const PAGE_SIZE = 8

function PermissionTable({
  headers,
  count,
  renderRow
}: {
  headers: string[]
  count: number
  renderRow: (index: number) => ReactNode[]
}): React.JSX.Element {
  const { t } = useTranslation()
  const [page, setPage] = useState(0)
  const lastPage = Math.max(0, Math.ceil(count / PAGE_SIZE) - 1)
  const currentPage = Math.min(page, lastPage)
  const start = currentPage * PAGE_SIZE
  return (
    <>
      <div className="max-h-[200px] overflow-auto">
        <table className="w-full table-fixed border-collapse text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-[var(--surface-elevated)] text-[11px] text-muted-foreground">
            <tr>
              {headers.map((header, index) => (
                <th
                  key={header}
                  className={cn('px-2 pb-2 font-medium', headers.length === 3 && index < 2 && 'w-[22%]')}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: Math.min(PAGE_SIZE, count - start) }, (_, offset) => (
              <tr key={start + offset} className="border-t border-[var(--separator)]">
                {renderRow(start + offset).map((cell, index) => (
                  <td key={index} className="break-words px-2 py-2 align-top font-mono leading-5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {lastPage > 0 && (
        <div className="mt-2 flex items-center justify-end gap-2 text-[11px] text-muted-foreground">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('connection.permissions.previous')}
          </Button>
          <span>
            {currentPage + 1} / {lastPage + 1}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={currentPage === lastPage}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('connection.permissions.next')}
          </Button>
        </div>
      )}
    </>
  )
}

export function ConnectionPermissions({
  result,
  busy
}: {
  result: AuthorizationResult | null
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const authorization = result?.authorization
  return (
    <section className="mt-5" aria-label={t('connection.permissions.title')} aria-busy={busy}>
      <h2 className="mb-2 text-[12px] font-medium">{t('connection.permissions.title')}</h2>
      {busy ? (
        <div className="text-[12px] text-muted-foreground">{t('connection.permissions.loading')}</div>
      ) : result?.authorizationError ? (
        <div className="break-words text-[12px] text-destructive" role="status">
          {t('connection.permissions.failed', {
            error: result.authorizationError
          })}
        </div>
      ) : !authorization ? (
        <div className="text-[12px] text-muted-foreground">{t('connection.permissions.testHint')}</div>
      ) : (
        <>
          {authorization.users.length === 0 && (
            <div className="mb-2 text-[12px] text-muted-foreground">{t('connection.permissions.noUser')}</div>
          )}
          {authorization.roles.length > 0 ? (
            <PermissionTable
              headers={[t('connection.permissions.database'), t('connection.permissions.role')]}
              count={authorization.roles.length}
              renderRow={(index) => [authorization.roles[index].db, authorization.roles[index].role]}
            />
          ) : (
            authorization.users.length > 0 && (
              <div className="text-[12px] text-muted-foreground">{t('connection.permissions.noRoles')}</div>
            )
          )}
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setExpanded(!expanded)}
            className="mt-3 inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <ChevronDown size={14} className={cn('transition-transform', expanded && 'rotate-180')} />
            {t('connection.permissions.details')} ({authorization.privileges.length})
          </button>
          <Collapsible open={expanded} className="mt-2">
            {authorization.privileges.length > 0 ? (
              <PermissionTable
                headers={[
                  t('connection.permissions.database'),
                  t('connection.permissions.collection'),
                  t('connection.permissions.actions')
                ]}
                count={authorization.privileges.length}
                renderRow={(index) => {
                  const { resource, actions } = authorization.privileges[index]
                  const database = resource.anyResource
                    ? t('connection.permissions.allResources')
                    : resource.cluster
                      ? t('connection.permissions.cluster')
                      : resource.db === ''
                        ? t('connection.permissions.allDatabases')
                        : resource.db
                  const collection =
                    resource.anyResource || resource.cluster
                      ? '—'
                      : resource.collection === ''
                        ? t('connection.permissions.nonSystemCollections')
                        : resource.collection
                  return [database, collection, actions.join(', ')]
                }}
              />
            ) : (
              <div className="text-[12px] text-muted-foreground">{t('connection.permissions.noPrivileges')}</div>
            )}
          </Collapsible>
        </>
      )}
    </section>
  )
}
