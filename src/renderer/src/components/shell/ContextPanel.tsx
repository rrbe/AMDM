import type { ReactNode } from 'react'
import { Clock, Database, KeyRound, Plug, Table2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { getActiveResult, getActiveTab, useAppStore } from '@renderer/store/useAppStore'
import { tabCollection } from '@renderer/lib/tabs'

export function ContextPanel(): JSX.Element {
  const { t } = useTranslation()
  const tab = useAppStore(getActiveTab)
  const activeResult = useAppStore(getActiveResult)
  const connections = useAppStore((s) => s.connections)
  const catalogs = useAppStore((s) => s.catalogs)

  const connection = connections.find((item) => item.id === tab.connectionId)
  const database = tab.activeDatabase || activeResult?.query?.database || ''
  const result = activeResult?.result
  const collection = tabCollection(tab) ?? result?.collection ?? ''
  const catalog = tab.connectionId ? catalogs[tab.connectionId] : undefined
  const collectionInfo = catalog?.collections[database]?.find((item) => item.name === collection)
  const indexes = catalog?.indexes[`${database}/${collection}`]
  const deployment = connection
    ? connection.useSrv
      ? connection.host
      : `${connection.host}:${connection.port ?? 27017}`
    : '—'
  const resultSummary = !result
    ? t('context.noResult')
    : result.kind === 'documents'
      ? t('result.docCount', { count: result.count ?? 0 })
      : result.kind === 'value'
        ? t('result.kindValue')
        : result.kind === 'ack'
          ? t('result.kindAck')
          : result.kind === 'explain'
            ? t('result.explainTag')
            : result.errorName || t('result.errorName')

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--bg-1)]">
      <div className="flex h-11 shrink-0 items-center border-b border-border px-3">
        <span className="text-[13px] font-semibold text-foreground">{t('context.title')}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <section className="rounded-[var(--radius-lg)] border border-border bg-[var(--bg-elevated)] p-3">
          <h2 className="m-0 mb-2.5 text-[12px] font-medium text-muted-foreground">
            {t('context.target')}
          </h2>
          <dl className="m-0 grid gap-1">
            <PropertyRow icon={<Plug />} label={t('context.connection')} value={connection?.name || '—'} />
            <PropertyRow icon={<Database />} label={t('context.deployment')} value={deployment} mono />
            <PropertyRow icon={<Database />} label={t('context.database')} value={database || '—'} mono />
            <PropertyRow icon={<Table2 />} label={t('context.collection')} value={collection || '—'} mono />
          </dl>
        </section>

        {collection && (
          <section className="mt-3 rounded-[var(--radius-lg)] border border-border bg-[var(--bg-elevated)] p-3">
            <h2 className="m-0 mb-2.5 text-[12px] font-medium text-muted-foreground">
              {t('context.collection')}
            </h2>
            <dl className="m-0 grid gap-1">
              <PropertyRow
                icon={<Table2 />}
                label={t('context.type')}
                value={
                  collectionInfo
                    ? t(`context.collectionType.${collectionInfo.type}`)
                    : t('context.notLoaded')
                }
              />
              <PropertyRow
                icon={<Table2 />}
                label={t('context.documents')}
                value={
                  collectionInfo?.estimatedCount === undefined
                    ? '—'
                    : collectionInfo.estimatedCount.toLocaleString()
                }
                mono
              />
              <PropertyRow
                icon={<KeyRound />}
                label={t('context.indexes')}
                value={indexes ? indexes.length.toLocaleString() : t('context.notLoaded')}
                mono={!!indexes}
              />
            </dl>
          </section>
        )}

        <section className="mt-3 rounded-[var(--radius-lg)] border border-border bg-[var(--bg-elevated)] p-3">
          <h2 className="m-0 mb-2.5 text-[12px] font-medium text-muted-foreground">
            {t('context.lastResult')}
          </h2>
          <dl className="m-0 grid gap-1">
            <PropertyRow icon={<Table2 />} label={t('context.result')} value={resultSummary} />
            <PropertyRow
              icon={<Clock />}
              label={t('context.elapsed')}
              value={
                typeof result?.elapsedMs === 'number'
                  ? t('result.elapsed', { ms: result.elapsedMs })
                  : '—'
              }
              mono
            />
          </dl>
        </section>
      </div>
    </div>
  )
}

function PropertyRow({
  icon,
  label,
  value,
  mono = false
}: {
  icon: ReactNode
  label: string
  value: string
  mono?: boolean
}): JSX.Element {
  return (
    <div className="grid min-h-7 grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-x-2">
      <span className="text-muted-foreground [&_svg]:size-4" aria-hidden>
        {icon}
      </span>
      <dt className="truncate text-[12px] text-muted-foreground">{label}</dt>
      <dd
        className={`m-0 truncate text-[12px] font-medium text-foreground ${mono ? 'font-mono font-normal' : ''}`}
        title={value}
      >
        {value}
      </dd>
    </div>
  )
}
