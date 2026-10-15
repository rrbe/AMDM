import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTranslation } from 'react-i18next'
import { Check, FileText } from 'lucide-react'
import amdmIcon from '../../../../../build/icon-src/icon-small.svg?no-inline'
import compassIcon from '@renderer/assets/connection-clients/compass.png?no-inline'
import studio3tIcon from '@renderer/assets/connection-clients/studio3t.webp?no-inline'
import nosqlboosterIcon from '@renderer/assets/connection-clients/nosqlbooster.png?no-inline'
import robo3tIcon from '@renderer/assets/connection-clients/robo3t.png?no-inline'
import type { ConnectionConfig } from '@shared/types'
import type {
  ConnectionImportPreview,
  ConnectionImportResult,
  ConnectionTransferFormat
} from '@shared/connectionTransfer'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Radio, RadioGroup } from '@renderer/components/ui/RadioGroup'
import { applyConnectionOrder } from '@renderer/lib/connectionOrder'
import { useAppStore } from '@renderer/store/useAppStore'

interface ConnectionTransferModalProps {
  mode: 'export' | 'import'
  initialSelectedIds?: string[]
  onClose: () => void
}

type ImportChoice = { action: 'copy' | 'skip' | 'replace'; replaceId?: string }
const FORMATS: ConnectionTransferFormat[] = ['amdm', 'urls', 'compass', 'studio3t', 'nosqlbooster', 'robo3t']
const FORMAT_ICONS = {
  amdm: amdmIcon,
  compass: compassIcon,
  studio3t: studio3tIcon,
  nosqlbooster: nosqlboosterIcon,
  robo3t: robo3tIcon
}

/** The scroll container stays bounded for saved connections, import rows and replacement targets. */
function TransferList<T>({
  items,
  itemKey,
  renderItem,
  height = 240
}: {
  items: T[]
  itemKey: (item: T) => string | number
  renderItem: (item: T) => ReactNode
  height?: number
}): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: (index) => itemKey(items[index]),
    estimateSize: () => 72,
    overscan: 4
  })
  return (
    <div ref={scrollRef} className="overflow-y-auto rounded-lg border border-[var(--separator)] p-1" style={{ height }}>
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => (
          <div
            key={item.key}
            data-index={item.index}
            ref={virtualizer.measureElement}
            className="absolute left-0 top-0 w-full p-2"
            style={{ transform: `translateY(${item.start}px)` }}
          >
            {renderItem(items[item.index])}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ConnectionTransferModal({
  mode,
  initialSelectedIds,
  onClose
}: ConnectionTransferModalProps): React.JSX.Element {
  const { t } = useTranslation()
  const formatLabelId = useId()
  const connections = useAppStore((s) => s.connections)
  const connectionOrder = useAppStore((s) => s.settings.connectionOrder)
  const statuses = useAppStore((s) => s.statuses)
  const exportConnections = useAppStore((s) => s.exportConnections)
  const previewConnectionImport = useAppStore((s) => s.previewConnectionImport)
  const applyConnectionImport = useAppStore((s) => s.applyConnectionImport)
  const releaseConnectionImport = useAppStore((s) => s.releaseConnectionImport)
  const ordered = useMemo(() => applyConnectionOrder(connections, connectionOrder), [connections, connectionOrder])
  const [selectedIds, setSelectedIds] = useState(() => new Set(initialSelectedIds ?? connections.map((c) => c.id)))
  const [format, setFormat] = useState<ConnectionTransferFormat>('amdm')
  const [includeSecrets, setIncludeSecrets] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [plaintextAcknowledged, setPlaintextAcknowledged] = useState(false)
  const [preview, setPreview] = useState<ConnectionImportPreview | null>(null)
  const [choices, setChoices] = useState<Record<number, ImportChoice>>({})
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false)
  const [targetRow, setTargetRow] = useState<number | null>(null)
  const [targetSearch, setTargetSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ConnectionImportResult | null>(null)
  const busyRef = useRef(false)
  const alive = useRef(true)
  const generation = useRef(0)
  const tokenRef = useRef<string | null>(null)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      generation.current++
      const token = tokenRef.current
      tokenRef.current = null
      if (token) void releaseConnectionImport(token)
    }
  }, [releaseConnectionImport])

  const begin = (): boolean => {
    if (busyRef.current) return false
    busyRef.current = true
    setBusy(true)
    setResult(null)
    return true
  }
  const finish = (): void => {
    busyRef.current = false
    if (alive.current) setBusy(false)
  }
  const close = (): void => {
    if (!busyRef.current) onClose()
  }
  const errorText = (code: string): string =>
    t(`connectionTransfer.errors.${code}`, {
      defaultValue: t('connectionTransfer.errors.generic')
    })
  const warningText = (warning: string): string => {
    const [code, fields] = warning.split(':', 2)
    const message = t(`connectionTransfer.warnings.${code}`, {
      defaultValue: t('connectionTransfer.warnings.generic')
    })
    return fields ? `${message} (${fields})` : message
  }
  const savedById = useMemo(() => new Map(connections.map((connection) => [connection.id, connection])), [connections])
  const selectable = ordered.filter((connection) => selectedIds.has(connection.id))
  const urlBased = format !== 'amdm' && format !== 'compass'
  const plaintext = includeSecrets && (urlBased || (format === 'compass' && !passphrase))
  const exportReady =
    selectable.length > 0 &&
    (!plaintext || plaintextAcknowledged) &&
    (!includeSecrets || format !== 'amdm' || (passphrase.length > 0 && passphrase === confirmation))
  const exportWarnings = (connection: ConnectionConfig): string[] => {
    const warnings: string[] = []
    if (urlBased) {
      if (connection.ssh.enabled) warnings.push('sshOmitted')
      if (connection.name) warnings.push('nameOmitted')
      if (connection.color) warnings.push('colorOmitted')
      if (format === 'robo3t' && connection.options && Object.keys(connection.options).length) {
        warnings.push(`roboOptionsUnsupported:${Object.keys(connection.options).join(',')}`)
      }
    } else if (format === 'compass') {
      if (connection.ssh.jump) warnings.push('sshJumpOmitted')
      if (connection.ssh.pinnedHostKey || connection.ssh.jump?.pinnedHostKey) warnings.push('sshHostKeyOmitted')
    }
    if (
      connection.ssh.privateKeyPath ||
      connection.ssh.jump?.privateKeyPath ||
      connection.tls.caFile ||
      connection.tls.certificateKeyFile
    )
      warnings.push('externalFiles')
    return warnings
  }

  const onExport = async (destination: 'file' | 'clipboard'): Promise<void> => {
    if (!exportReady || !begin()) return
    const response = await exportConnections({
      ids: selectable.map((connection) => connection.id),
      format,
      includeSecrets,
      destination,
      ...(includeSecrets && !urlBased && passphrase ? { passphrase } : {})
    })
    if (alive.current && !response.cancelled && response.error !== 'cancelled') {
      setResult(response)
      if (!response.error) {
        setPassphrase('')
        setConfirmation('')
        setPlaintextAcknowledged(false)
      }
    }
    finish()
  }

  const onPreview = async (retry: boolean): Promise<void> => {
    if (!begin()) return
    const currentGeneration = ++generation.current
    let token = tokenRef.current
    if (!retry) {
      tokenRef.current = null
      setPreview(null)
      setChoices({})
      setTargetRow(null)
      if (token) await releaseConnectionImport(token)
      token = null
    }
    if (!alive.current || currentGeneration !== generation.current) {
      finish()
      return
    }
    const response = await previewConnectionImport(retry && token ? { token, passphrase } : {})
    if (!alive.current || currentGeneration !== generation.current) {
      if (response?.token) await releaseConnectionImport(response.token)
      finish()
      return
    }
    if (response) {
      if (token && response.token !== token) void releaseConnectionImport(token)
      tokenRef.current = response.token || null
      setPreview(response)
      setChoices(
        Object.fromEntries(
          response.rows.map((row) => [row.index, { action: row.config && !row.error ? 'copy' : 'skip' }])
        )
      )
      setWarningsAcknowledged(false)
    }
    setPassphrase('')
    finish()
  }

  const selectedRows = useMemo(
    () => preview?.rows.filter((row) => row.config && !row.error && choices[row.index]?.action !== 'skip') ?? [],
    [preview, choices]
  )
  const hasWarnings = selectedRows.some((row) => row.warnings.length > 0)
  const canReplace = (id: string): boolean => (statuses[id]?.state ?? 'disconnected') === 'disconnected'
  const replacementIds = selectedRows.flatMap((row) =>
    choices[row.index]?.action === 'replace' ? [choices[row.index].replaceId ?? ''] : []
  )
  const invalidReplacement = replacementIds.some((id) => !id || !savedById.has(id) || !canReplace(id))
  const duplicateReplacement = new Set(replacementIds.filter(Boolean)).size !== replacementIds.filter(Boolean).length
  const importReady =
    !!preview?.token &&
    !preview.needsPassword &&
    !preview.error &&
    selectedRows.length > 0 &&
    !invalidReplacement &&
    !duplicateReplacement &&
    (!hasWarnings || warningsAcknowledged)
  const matchingNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const connection of connections) counts.set(connection.name, (counts.get(connection.name) ?? 0) + 1)
    return counts
  }, [connections])
  const connectionLabel = (connection: ConnectionConfig): string =>
    [connection.name, connection.host, connection.auth.username, connection.auth.authSource].filter(Boolean).join(' · ')
  const replacementTargets = useMemo(() => {
    const search = targetSearch.trim().toLocaleLowerCase()
    return ordered.filter(
      (connection) =>
        !search ||
        `${connection.name} ${connection.host} ${connection.auth.username ?? ''} ${connection.auth.authSource ?? ''}`
          .toLocaleLowerCase()
          .includes(search)
    )
  }, [ordered, targetSearch])
  const changeChoice = (index: number, choice: ImportChoice): void => {
    setChoices((current) => ({ ...current, [index]: choice }))
    setWarningsAcknowledged(false)
    setTargetRow(null)
  }
  const onApply = async (): Promise<void> => {
    if (!importReady || !preview || !begin()) return
    const response = await applyConnectionImport({
      token: preview.token,
      entries: selectedRows.map((row) => ({
        index: row.index,
        ...(choices[row.index]?.action === 'replace' ? { replaceId: choices[row.index].replaceId } : {})
      })),
      acknowledgeWarnings: warningsAcknowledged
    })
    if (alive.current && !response.cancelled && response.error !== 'cancelled') {
      setResult(response)
      if (!response.error) {
        const token = tokenRef.current
        tokenRef.current = null
        if (token) await releaseConnectionImport(token)
        if (alive.current) {
          setPreview(null)
          setChoices({})
          setTargetRow(null)
        }
      }
    }
    finish()
  }

  return (
    <Modal
      title={t(`connectionTransfer.${mode}Title`)}
      description={t(`connectionTransfer.${mode}Description`)}
      size="lg"
      onClose={close}
      footer={
        <>
          <Button disabled={busy} onClick={close}>
            {t('common.close')}
          </Button>
          <span className="spacer" />
          {mode === 'export' ? (
            <>
              {urlBased && (
                <Button busy={busy} disabled={!exportReady} onClick={() => void onExport('clipboard')}>
                  {t('connectionTransfer.copyUrls')}
                </Button>
              )}
              <Button variant="primary" busy={busy} disabled={!exportReady} onClick={() => void onExport('file')}>
                {t('connectionTransfer.exportTitle')}
              </Button>
            </>
          ) : (
            <Button variant="primary" busy={busy} disabled={!importReady} onClick={() => void onApply()}>
              {t('connectionTransfer.importCount', {
                count: selectedRows.length
              })}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 text-[13px]" aria-busy={busy}>
        {mode === 'export' ? (
          <>
            <div className="flex flex-col gap-2">
              <span id={formatLabelId}>{t('connectionTransfer.format')}</span>
              <RadioGroup<ConnectionTransferFormat>
                aria-labelledby={formatLabelId}
                className="grid grid-cols-3 gap-2.5"
                value={format}
                disabled={busy}
                onValueChange={(value) => {
                  setFormat(value)
                  setPlaintextAcknowledged(false)
                  setResult(null)
                }}
              >
                {FORMATS.map((value) => (
                  <Radio
                    key={value}
                    value={value}
                    render={<button type="button" />}
                    nativeButton
                    className="relative flex min-h-[108px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-[var(--separator)] bg-[var(--surface-control)] px-3 py-3 text-center text-[12px] leading-snug text-muted-foreground outline-none transition-colors hover:bg-[var(--interaction-hover)] focus-visible:border-[var(--separator-strong)] focus-visible:shadow-[0_0_0_3px_var(--focus-soft)] data-[checked]:border-[var(--text-secondary)] data-[checked]:bg-[var(--interaction-pressed)] data-[checked]:text-foreground data-[disabled]:cursor-default data-[disabled]:opacity-55"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center" aria-hidden>
                      {value === 'urls' ? (
                        <FileText size={36} strokeWidth={1.5} />
                      ) : (
                        <img src={FORMAT_ICONS[value]} alt="" width={36} height={36} className="object-contain" />
                      )}
                    </span>
                    <span>{t(`connectionTransfer.formats.${value}`)}</span>
                    {format === value && <Check size={14} className="absolute right-2 top-2" aria-hidden />}
                  </Radio>
                ))}
              </RadioGroup>
            </div>
            <p className="m-0 text-[12px] text-muted-foreground">{t(`connectionTransfer.formatHelp.${format}`)}</p>
            <div className="flex items-center justify-between gap-2">
              <span>
                {t('connectionTransfer.selectedCount', {
                  count: selectable.length,
                  total: ordered.length
                })}
              </span>
              <Button
                size="sm"
                disabled={busy}
                onClick={() =>
                  setSelectedIds(selectable.length === ordered.length ? new Set() : new Set(ordered.map((c) => c.id)))
                }
              >
                {t(
                  selectable.length === ordered.length
                    ? 'connectionTransfer.selectNone'
                    : 'connectionTransfer.selectAll'
                )}
              </Button>
            </div>
            <TransferList
              items={ordered}
              itemKey={(connection) => connection.id}
              renderItem={(connection) => (
                <div className="flex flex-col gap-1.5">
                  <Checkbox
                    checked={selectedIds.has(connection.id)}
                    disabled={busy}
                    onCheckedChange={(checked) =>
                      setSelectedIds((current) => {
                        const next = new Set(current)
                        if (checked) next.add(connection.id)
                        else next.delete(connection.id)
                        return next
                      })
                    }
                    label={
                      <span className="break-all">
                        {connection.name} <span className="text-muted-foreground">· {connection.host}</span>
                      </span>
                    }
                  />
                  {exportWarnings(connection).map((warning) => (
                    <p key={warning} className="m-0 pl-[23px] text-[12px] text-muted-foreground">
                      {warningText(warning)}
                    </p>
                  ))}
                </div>
              )}
            />
            <Checkbox
              checked={includeSecrets}
              disabled={busy}
              onCheckedChange={(checked) => {
                setIncludeSecrets(checked)
                setPlaintextAcknowledged(false)
                setResult(null)
              }}
              label={t(urlBased ? 'connectionTransfer.includeDatabasePassword' : 'connectionTransfer.includeSecrets')}
            />
            {includeSecrets && !urlBased && (
              <>
                <label className="flex flex-col gap-2">
                  {t(format === 'amdm' ? 'connectionTransfer.passphrase' : 'connectionTransfer.optionalPassphrase')}
                  <Input
                    type="password"
                    autoComplete="new-password"
                    disabled={busy}
                    value={passphrase}
                    onChange={(event) => {
                      setPassphrase(event.target.value)
                      setPlaintextAcknowledged(false)
                    }}
                  />
                </label>
                <p className="m-0 text-[12px] text-muted-foreground">
                  {t(format === 'amdm' ? 'connectionTransfer.amdmEncryption' : 'connectionTransfer.compassEncryption')}
                </p>
                {format === 'amdm' && (
                  <label className="flex flex-col gap-2">
                    {t('connectionTransfer.confirmPassphrase')}
                    <Input
                      type="password"
                      autoComplete="new-password"
                      disabled={busy}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                    />
                    {confirmation && confirmation !== passphrase && (
                      <span className="text-destructive">{t('connectionTransfer.passphraseMismatch')}</span>
                    )}
                  </label>
                )}
              </>
            )}
            {plaintext && (
              <Checkbox
                checked={plaintextAcknowledged}
                disabled={busy}
                onCheckedChange={setPlaintextAcknowledged}
                label={t('connectionTransfer.plaintextAcknowledgement')}
              />
            )}
          </>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <Button busy={busy} onClick={() => void onPreview(false)}>
                {t('connectionTransfer.chooseFile')}
              </Button>
              {preview?.fileName && <span className="min-w-0 break-all text-muted-foreground">{preview.fileName}</span>}
            </div>
            {preview?.error && (
              <div role="alert" className="text-destructive">
                {errorText(preview.error)}
              </div>
            )}
            {preview?.needsPassword && (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-2">
                  {t('connectionTransfer.passphrase')}
                  <Input
                    type="password"
                    autoComplete="off"
                    disabled={busy}
                    value={passphrase}
                    onChange={(event) => setPassphrase(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && passphrase && !event.nativeEvent.isComposing) void onPreview(true)
                    }}
                  />
                </label>
                <Button busy={busy} disabled={!passphrase || !preview.token} onClick={() => void onPreview(true)}>
                  {t('connectionTransfer.unlock')}
                </Button>
              </div>
            )}
            {!!preview?.rows.length && (
              <>
                <p className="m-0 text-[12px] text-muted-foreground">{t('connectionTransfer.copyHelp')}</p>
                <TransferList
                  items={preview.rows}
                  itemKey={(row) => row.index}
                  height={300}
                  renderItem={(row) => {
                    const valid = !!row.config && !row.error
                    const choice = choices[row.index] ?? { action: 'skip' }
                    const target = savedById.get(choice.replaceId ?? '')
                    const rowName =
                      row.name ||
                      t('connectionTransfer.rowNumber', {
                        index: row.index + 1
                      })
                    return (
                      <div className="flex flex-col gap-2 rounded-md bg-[var(--surface-control)] p-3">
                        <Checkbox
                          checked={valid && choice.action !== 'skip'}
                          disabled={busy || !valid}
                          onCheckedChange={(checked) =>
                            changeChoice(row.index, {
                              action: checked ? 'copy' : 'skip'
                            })
                          }
                          label={
                            <span className="break-all">
                              {rowName} <span className="text-muted-foreground">{row.config?.host}</span>
                            </span>
                          }
                        />
                        {!!matchingNames.get(row.name) && (
                          <span className="text-[12px] text-foreground">
                            {t(`connectionTransfer.${choice.action === 'copy' ? 'matchingNamesCopy' : 'matchingNames'}`, {
                              count: matchingNames.get(row.name)
                            })}
                          </span>
                        )}
                        {!valid && <span className="text-destructive">{errorText(row.error ?? 'invalidRow')}</span>}
                        {row.warnings.map((warning, index) => (
                          <span key={`${warning}:${index}`} className="text-[12px] text-muted-foreground">
                            {warningText(warning)}
                          </span>
                        ))}
                        {valid && (
                          <div className="flex flex-wrap items-center gap-2">
                            <Select
                              value={choice.action}
                              disabled={busy}
                              className="w-[150px]"
                              aria-label={t('connectionTransfer.rowAction', {
                                name: rowName
                              })}
                              onChange={(action) => changeChoice(row.index, { action })}
                              options={(['copy', 'skip', 'replace'] as const).map((value) => ({
                                value,
                                label: t(`connectionTransfer.actions.${value}`)
                              }))}
                            />
                            {choice.action === 'replace' && (
                              <Button
                                disabled={busy}
                                onClick={() => {
                                  setTargetRow(row.index)
                                  setTargetSearch('')
                                }}
                              >
                                {target ? connectionLabel(target) : t('connectionTransfer.chooseTarget')}
                              </Button>
                            )}
                            {target && choice.action === 'replace' && !canReplace(target.id) && (
                              <span className="text-destructive">{t('connectionTransfer.disconnectFirst')}</span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  }}
                />
                {targetRow !== null && (
                  <div className="flex flex-col gap-3 rounded-lg border border-[var(--separator)] p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span>
                        {t('connectionTransfer.targetFor', {
                          name:
                            preview.rows.find((row) => row.index === targetRow)?.name ||
                            t('connectionTransfer.rowNumber', {
                              index: targetRow + 1
                            })
                        })}
                      </span>
                      <Button size="sm" disabled={busy} onClick={() => setTargetRow(null)}>
                        {t('common.close')}
                      </Button>
                    </div>
                    <Input
                      autoFocus
                      disabled={busy}
                      value={targetSearch}
                      aria-label={t('connectionTransfer.searchTargets')}
                      placeholder={t('connectionTransfer.searchTargets')}
                      onChange={(event) => setTargetSearch(event.target.value)}
                    />
                    <TransferList
                      items={replacementTargets}
                      itemKey={(connection) => connection.id}
                      height={160}
                      renderItem={(connection) => (
                        <Button
                          className="h-auto min-h-8 w-full justify-start whitespace-normal py-2 text-left"
                          disabled={busy || !canReplace(connection.id)}
                          onClick={() =>
                            changeChoice(targetRow, {
                              action: 'replace',
                              replaceId: connection.id
                            })
                          }
                        >
                          <span className="break-all">
                            {connectionLabel(connection)}
                            {!canReplace(connection.id) && ` · ${t('connectionTransfer.disconnectFirst')}`}
                          </span>
                        </Button>
                      )}
                    />
                    {!replacementTargets.length && (
                      <span className="text-muted-foreground">{t('connectionTransfer.noTargets')}</span>
                    )}
                  </div>
                )}
                {replacementIds.length > 0 && (
                  <p className="m-0 text-[12px] text-muted-foreground">{t('connectionTransfer.replaceHelp')}</p>
                )}
                {duplicateReplacement && (
                  <div role="alert" className="text-destructive">
                    {t('connectionTransfer.duplicateReplacement')}
                  </div>
                )}
                {hasWarnings && (
                  <Checkbox
                    checked={warningsAcknowledged}
                    disabled={busy}
                    onCheckedChange={setWarningsAcknowledged}
                    label={t('connectionTransfer.acknowledgeWarnings')}
                  />
                )}
              </>
            )}
          </>
        )}
        {result &&
          (result.error ? (
            <div role="alert" className="text-destructive">
              {errorText(result.error)}
            </div>
          ) : (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-[var(--separator-strong)] bg-[var(--interaction-selected)] p-3"
            >
              <Check size={18} className="mt-0.5 shrink-0" aria-hidden />
              <div className="flex flex-col gap-1">
                {t(`connectionTransfer.${mode}Success`, {
                  count: result.count ?? 0
                })}
                {mode === 'import' && (
                  <span className="text-[12px] text-muted-foreground">
                    {t('connectionTransfer.importSummary', {
                      created: (result.count ?? 0) - (result.replacedIds?.length ?? 0),
                      replaced: result.replacedIds?.length ?? 0
                    })}
                  </span>
                )}
              </div>
            </div>
          ))}
      </div>
    </Modal>
  )
}
