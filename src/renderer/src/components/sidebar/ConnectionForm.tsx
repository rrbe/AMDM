import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardPaste, Link, MessageSquareText, Plus, Trash2 } from 'lucide-react'
import type {
  ConnectionConfig,
  ConnectionInput,
  DiagnoseStage,
  ScramMechanism,
  SshAuthMethod,
  TestResult
} from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Dialog } from '@renderer/components/ui/Dialog'
import { Tabs } from '@renderer/components/ui/Tabs'
import { Field } from '@renderer/components/ui/Field'
import { Input } from '@renderer/components/ui/Input'
import { Select } from '@renderer/components/ui/Select'
import { Checkbox } from '@renderer/components/ui/Checkbox'
import { cn } from '@renderer/lib/utils'
import {
  buildConnectionOptions,
  connectionMembersAreValid,
  formatConnectionMembers,
  inferAuthType,
  parseConnectionMembers,
  parseMongoUri,
  PRESET_COLORS,
  splitConnectionOptions,
  type ConnectionMember,
  type ConnectionOption
} from '@renderer/lib/connectionUri'

type Tab = 'general' | 'auth' | 'ssh' | 'tls'
type MemberRow = ConnectionMember & { id: string }
type OptionRow = ConnectionOption & { id: string }

function genId(): string {
  return `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function memberRows(members: ConnectionMember[]): MemberRow[] {
  return members.map((member) => ({ ...member, id: genId() }))
}

function optionRows(options: ConnectionOption[]): OptionRow[] {
  return options.map((option) => ({ ...option, id: genId() }))
}

interface ConnectionFormProps {
  editing?: ConnectionConfig
  onClose: () => void
}

/** Per-step ✓/✗ list for one hop's connectivity check (shared by SSH + jump). */
function DiagnoseResult({ stages }: { stages: DiagnoseStage[] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="mt-1 flex flex-col gap-1">
      {stages.map((s) => {
        const color = s.status === 'ok' ? 'var(--ok)' : s.status === 'fail' ? 'var(--err)' : 'var(--fg-3)'
        const icon = s.status === 'ok' ? '✓' : s.status === 'fail' ? '✗' : '○'
        return (
          <div key={s.key} className="text-[12px]">
            <span className="mr-1.5 font-bold" style={{ color }}>
              {icon}
            </span>
            <span>{t(`connection.ssh.stage.${s.key}`)}</span>
            {s.target && <span className="ml-1.5 opacity-60">{s.target}</span>}
            {s.ms != null && <span className="ml-1.5 opacity-60">{s.ms}ms</span>}
            {s.detail && <div className="ml-[18px] text-destructive">{s.detail}</div>}
          </div>
        )
      })}
    </div>
  )
}

/**
 * "Check connectivity" trigger + an overall ✓/✗ and a chevron that toggles the
 * per-step log — so a passing check stays quiet (just ✓) instead of dumping the
 * whole list. A fresh result auto-opens on failure and collapses when all-ok.
 */
function DiagnoseControl({
  busy,
  stages,
  onRun
}: {
  busy: boolean
  stages: DiagnoseStage[] | null
  onRun: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (stages) setOpen(stages.some((s) => s.status === 'fail'))
  }, [stages])
  const allOk = stages != null && stages.every((s) => s.status === 'ok')
  return (
    <>
      <div className="mt-2 flex items-center gap-2">
        <Button variant="ghost" type="button" busy={busy} onClick={onRun}>
          {t('connection.ssh.diagnose')}
        </Button>
        {stages != null && !busy && (
          <>
            <span className="font-bold" style={{ color: allOk ? 'var(--ok)' : 'var(--err)' }}>
              {allOk ? '✓' : '✗'}
            </span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={t(open ? 'connection.ssh.diagHide' : 'connection.ssh.diagShow')}
              data-tip={t(open ? 'connection.ssh.diagHide' : 'connection.ssh.diagShow')}
              className={cn(
                'inline-flex cursor-pointer items-center border-0 bg-transparent p-0',
                open ? 'text-foreground' : 'text-[var(--fg-3)]'
              )}
            >
              <MessageSquareText size={16} />
            </button>
          </>
        )}
      </div>
      {open && stages != null && <DiagnoseResult stages={stages} />}
    </>
  )
}

/**
 * Create / edit a connection. Secret fields (password, sshPassword,
 * sshPassphrase) come back BLANK on edit (the sanitized config only carries
 * `has*` booleans). We track whether the user touched each secret; if they did
 * NOT, we send `undefined` so the main process keeps the stored secret.
 *
 * "From URL" / "To URL" are two independent one-way helpers, each in its own
 * little popup: "From URL" parses a pasted string INTO the fields; "To URL"
 * exports the current fields OUT as a connection string. They never share a
 * live field, so neither drives the other.
 */
export function ConnectionForm({ editing, onClose }: ConnectionFormProps): JSX.Element {
  const { t: tFn } = useTranslation()
  const saveConnection = useAppStore((s) => s.saveConnection)
  const testConnection = useAppStore((s) => s.testConnection)
  const buildConnectionUri = useAppStore((s) => s.buildConnectionUri)
  const pickFile = useAppStore((s) => s.pickFile)
  const diagnoseConnection = useAppStore((s) => s.diagnoseConnection)
  const updateSettings = useAppStore((s) => s.updateSettings)
  // Remembered "To URL" password choice (persisted in settings.json).
  const rememberedIncludePassword = useAppStore((s) => s.settings.exportIncludeRealPassword)

  const [tab, setTab] = useState<Tab>('general')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)

  // ---- URL popups (From URL / To URL) ----
  const [urlPanel, setUrlPanel] = useState<'from' | 'to' | null>(null)
  const [parseNote, setParseNote] = useState<string | null>(null)
  // From URL: paste a connection string, parse it into the fields below.
  const [fromText, setFromText] = useState('')
  const [fromError, setFromError] = useState<string | null>(null)
  // To URL: export the current fields as a connection string. The password
  // choice starts from the remembered preference (default off).
  const [toUriText, setToUriText] = useState('')
  const [toIncludePassword, setToIncludePassword] = useState(rememberedIncludePassword)
  const [toCopied, setToCopied] = useState(false)
  const [toBuilding, setToBuilding] = useState(false)

  // ---- General ----
  const [name, setName] = useState(editing?.name ?? '')
  const [color, setColor] = useState(editing?.color ?? '')
  const [useSrv, setUseSrv] = useState(editing?.useSrv ?? false)
  const [srvHost, setSrvHost] = useState(editing?.useSrv ? editing.host : '')
  const [members, setMembers] = useState<MemberRow[]>(() =>
    memberRows(
      editing && !editing.useSrv
        ? parseConnectionMembers(editing.host, editing.port)
        : editing
          ? [{ host: '', port: '27017' }]
          : parseConnectionMembers('localhost:27017')
    )
  )
  const [replicaSet, setReplicaSet] = useState(editing?.replicaSet ?? '')
  const [defaultDatabase, setDefaultDatabase] = useState(editing?.defaultDatabase ?? '')
  const [readPreference, setReadPreference] = useState(() => splitConnectionOptions(editing?.options).readPreference)
  const [customOptions, setCustomOptions] = useState<OptionRow[]>(() =>
    optionRows(splitConnectionOptions(editing?.options).custom)
  )

  // ---- Auth ----
  const [username, setUsername] = useState(editing?.auth.username ?? '')
  const [authSource, setAuthSource] = useState(editing?.auth.authSource ?? '')
  const [mechanism, setMechanism] = useState<ScramMechanism>(editing?.auth.mechanism ?? 'DEFAULT')
  const [password, setPassword] = useState('')
  const [passwordTouched, setPasswordTouched] = useState(false)

  // ---- SSH ----
  const [sshEnabled, setSshEnabled] = useState(editing?.ssh.enabled ?? false)
  const [sshHost, setSshHost] = useState(editing?.ssh.host ?? '')
  const [sshPort, setSshPort] = useState(String(editing?.ssh.port ?? 22))
  const [sshUser, setSshUser] = useState(editing?.ssh.username ?? '')
  const [sshAuthMethod, setSshAuthMethod] = useState<SshAuthMethod>(
    editing?.ssh.authMethod ?? 'password'
  )
  const [privateKeyPath, setPrivateKeyPath] = useState(editing?.ssh.privateKeyPath ?? '')
  const [sshPassword, setSshPassword] = useState('')
  const [sshPasswordTouched, setSshPasswordTouched] = useState(false)
  const [sshPassphrase, setSshPassphrase] = useState('')
  const [sshPassphraseTouched, setSshPassphraseTouched] = useState(false)

  // ---- SSH jump host (bastion / ProxyJump) — private key file only ----
  const [jumpEnabled, setJumpEnabled] = useState(!!editing?.ssh.jump)
  const [jumpHost, setJumpHost] = useState(editing?.ssh.jump?.host ?? '')
  const [jumpPort, setJumpPort] = useState(String(editing?.ssh.jump?.port ?? 22))
  const [jumpUser, setJumpUser] = useState(editing?.ssh.jump?.username ?? '')
  const [jumpKeyPath, setJumpKeyPath] = useState(editing?.ssh.jump?.privateKeyPath ?? '')
  const [jumpSshPassphrase, setJumpSshPassphrase] = useState('')
  const [jumpSshPassphraseTouched, setJumpSshPassphraseTouched] = useState(false)
  const [sshDiagBusy, setSshDiagBusy] = useState(false)
  const [sshDiag, setSshDiag] = useState<DiagnoseStage[] | null>(null)
  const [jumpDiagBusy, setJumpDiagBusy] = useState(false)
  const [jumpDiag, setJumpDiag] = useState<DiagnoseStage[] | null>(null)

  // Browse for a private key file via the native picker, default to ~/.ssh.
  const browseKey = async (setter: (v: string) => void): Promise<void> => {
    const p = await pickFile({ title: tFn('connection.ssh.pickKey'), defaultPath: '~/.ssh' })
    if (p) setter(p)
  }

  // Validate SSH fields up front so save fails fast (with a reason) rather than
  // letting empty/invalid values surface as an opaque error at connect time.
  const sshError = useMemo<string | undefined>(() => {
    if (!sshEnabled) return undefined
    const portOk = (s: string): boolean => {
      const p = Number(s)
      return Number.isInteger(p) && p >= 1 && p <= 65535
    }
    if (!sshHost.trim()) return tFn('connection.ssh.errHost')
    if (!sshUser.trim()) return tFn('connection.ssh.errUser')
    if (!portOk(sshPort)) return tFn('connection.ssh.errPort')
    if (sshAuthMethod === 'privateKey' && !privateKeyPath.trim()) return tFn('connection.ssh.errKey')
    if (jumpEnabled) {
      if (!jumpHost.trim()) return tFn('connection.ssh.errJumpHost')
      if (!jumpUser.trim()) return tFn('connection.ssh.errJumpUser')
      if (!portOk(jumpPort)) return tFn('connection.ssh.errJumpPort')
      if (!jumpKeyPath.trim()) return tFn('connection.ssh.errJumpKey')
    }
    return undefined
  }, [
    sshEnabled,
    sshHost,
    sshUser,
    sshPort,
    sshAuthMethod,
    privateKeyPath,
    jumpEnabled,
    jumpHost,
    jumpUser,
    jumpPort,
    jumpKeyPath,
    tFn
  ])

  // ---- TLS ----
  const [tlsEnabled, setTlsEnabled] = useState(editing?.tls.enabled ?? false)
  const [allowInvalidCertificates, setAllowInvalid] = useState(
    editing?.tls.allowInvalidCertificates ?? false
  )
  const [caFile, setCaFile] = useState(editing?.tls.caFile ?? '')
  const [certificateKeyFile, setCertKeyFile] = useState(editing?.tls.certificateKeyFile ?? '')

  // ---- From URL: paste → parse into the fields (one-way, then close) ----
  const applyFromUrl = (): void => {
    try {
      const p = parseMongoUri(fromText)
      setUseSrv(p.useSrv)
      if (p.useSrv) setSrvHost(p.hosts[0] ?? '')
      else setMembers(memberRows(parseConnectionMembers(p.hosts.join(','))))
      setReplicaSet(p.replicaSet)
      setDefaultDatabase(p.defaultDatabase)
      if (p.hasAuth) {
        setUsername(p.username)
        if (p.password != null) {
          setPassword(p.password)
          setPasswordTouched(true)
        }
        setAuthSource(p.authSource)
      } else {
        setUsername('')
        setPassword('')
        setPasswordTouched(true)
        setAuthSource('')
        setMechanism('DEFAULT')
      }
      setTlsEnabled(p.tlsEnabled)
      setAllowInvalid(p.tlsAllowInvalid)
      const parsedOptions = splitConnectionOptions(p.extraOptions)
      setReadPreference(parsedOptions.readPreference)
      setCustomOptions(optionRows(parsedOptions.custom))
      setFromError(null)
      setFromText('')
      setUrlPanel(null)
      setParseNote(tFn('connection.uri.parsedNote'))
      setTab('general')
    } catch (e) {
      setFromError(e instanceof Error ? e.message : tFn('connection.uri.parseFailed'))
    }
  }

  // ---- To URL: serialize the CURRENT form fields to a string (one-way) ----
  // Works while creating or editing. The "include real password" choice only
  // matters when the connection uses username/password auth.
  const authType = inferAuthType({ username, password, authSource })
  const authError =
    authType === 'scram' && !username.trim() ? tFn('connection.auth.usernameRequired') : undefined
  const hasPasswordAuth = authType === 'scram' && !!username.trim()
  const host = useMemo(
    () => (useSrv ? srvHost.trim() : formatConnectionMembers(members)),
    [useSrv, srvHost, members]
  )
  const membersValid = useMemo(() => connectionMembersAreValid(members), [members])
  const options = useMemo(() => buildConnectionOptions(readPreference, customOptions), [readPreference, customOptions])

  const refreshToUri = async (includePassword: boolean): Promise<void> => {
    setToBuilding(true)
    const uri = await buildConnectionUri(buildInput(), { includePassword })
    setToUriText(uri ?? '')
    setToBuilding(false)
  }

  const openToUrl = (): void => {
    setToCopied(false)
    setUrlPanel('to')
    void refreshToUri(toIncludePassword)
  }

  // Toggle + remember the choice (persisted in settings.json).
  const setIncludePassword = (v: boolean): void => {
    setToIncludePassword(v)
    setToCopied(false)
    void updateSettings({ exportIncludeRealPassword: v })
    void refreshToUri(v)
  }

  const copyToUri = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toUriText)
      setToCopied(true)
    } catch {
      /* clipboard may be unavailable */
    }
  }

  // Esc / backdrop closes the open popup first, then the form itself.
  const handleModalClose = (): void => {
    if (urlPanel) setUrlPanel(null)
    else onClose()
  }

  const buildInput = useMemo(
    () =>
      (): ConnectionInput => {
        const input: ConnectionInput = {
          id: editing?.id ?? genId(),
          name: name.trim() || 'Untitled',
          color: color || undefined,
          useSrv,
          host: host.trim(),
          // Ports live beside each seed in `host`; `port` remains only as a
          // backwards-compatible field for older saved connections.
          port: undefined,
          replicaSet: replicaSet.trim() || undefined,
          defaultDatabase: defaultDatabase.trim() || undefined,
          options: Object.keys(options).length ? options : undefined,
          auth: {
            type: authType,
            username: authType === 'scram' ? username.trim() || undefined : undefined,
            authSource: authType === 'scram' ? authSource.trim() || undefined : undefined,
            mechanism: authType === 'scram' ? mechanism : undefined
          },
          ssh: {
            enabled: sshEnabled,
            host: sshHost.trim() || undefined,
            port: Number(sshPort) || 22,
            username: sshUser.trim() || undefined,
            authMethod: sshAuthMethod,
            privateKeyPath:
              sshAuthMethod === 'privateKey' ? privateKeyPath.trim() || undefined : undefined,
            // Preserve the TOFU-pinned host key across edits (verified silently at connect).
            pinnedHostKey: editing?.ssh.pinnedHostKey,
            jump: jumpEnabled
              ? {
                  host: jumpHost.trim() || undefined,
                  port: Number(jumpPort) || 22,
                  username: jumpUser.trim() || undefined,
                  authMethod: 'privateKey',
                  privateKeyPath: jumpKeyPath.trim() || undefined,
                  pinnedHostKey: editing?.ssh.jump?.pinnedHostKey
                }
              : undefined
          },
          tls: {
            enabled: tlsEnabled,
            allowInvalidCertificates,
            caFile: caFile.trim() || undefined,
            certificateKeyFile: certificateKeyFile.trim() || undefined
          }
        }
        // Secrets: only include if the user typed (else keep stored value).
        if (authType === 'none') input.password = ''
        else if (passwordTouched) input.password = password
        if (sshPasswordTouched) input.sshPassword = sshPassword
        if (sshPassphraseTouched) input.sshPassphrase = sshPassphrase
        if (jumpSshPassphraseTouched) input.jumpSshPassphrase = jumpSshPassphrase
        return input
      },
    [
      editing,
      name,
      color,
      useSrv,
      host,
      replicaSet,
      defaultDatabase,
      options,
      authType,
      username,
      authSource,
      mechanism,
      password,
      passwordTouched,
      sshEnabled,
      sshHost,
      sshPort,
      sshUser,
      sshAuthMethod,
      privateKeyPath,
      sshPassword,
      sshPasswordTouched,
      sshPassphrase,
      sshPassphraseTouched,
      jumpEnabled,
      jumpHost,
      jumpPort,
      jumpUser,
      jumpKeyPath,
      jumpSshPassphrase,
      jumpSshPassphraseTouched,
      tlsEnabled,
      allowInvalidCertificates,
      caFile,
      certificateKeyFile
    ]
  )

  const submit = async (): Promise<void> => {
    setSaving(true)
    const saved = await saveConnection(buildInput())
    setSaving(false)
    if (saved) onClose()
  }

  const runTest = async (): Promise<void> => {
    setTesting(true)
    setTest(null)
    const r = await testConnection(buildInput())
    setTest(r)
    setTesting(false)
  }

  const runSshDiag = async (): Promise<void> => {
    setSshDiagBusy(true)
    setSshDiag(null)
    setSshDiag(await diagnoseConnection(buildInput(), 'ssh'))
    setSshDiagBusy(false)
  }

  const runJumpDiag = async (): Promise<void> => {
    setJumpDiagBusy(true)
    setJumpDiag(null)
    setJumpDiag(await diagnoseConnection(buildInput(), 'jump'))
    setJumpDiagBusy(false)
  }

  const secretPlaceholder = (has?: boolean): string =>
    has ? tFn('connection.secret.placeholder') : ''

  return (
    <Modal
      title={editing ? tFn('connection.title.edit') : tFn('connection.title.new')}
      onClose={handleModalClose}
      size="lg"
      lockTop
      footer={
        <>
          <Button
            variant="ghost"
            busy={testing}
            disabled={!host.trim() || (!useSrv && !membersValid) || !!sshError || !!authError}
            onClick={() => void runTest()}
          >
            {tFn('connection.action.test')}
          </Button>
          {test && (
            <span
              className={cn(
                'rounded-md px-2 py-1 font-mono text-[12px]',
                test.ok
                  ? 'border border-[var(--ok)]/40 bg-[var(--ok)]/10 text-[var(--ok)]'
                  : 'border border-destructive/50 bg-destructive/10 text-destructive'
              )}
            >
              {test.ok
                ? [
                    tFn('connection.testResult.okPrefix'),
                    ...(test.serverVersion ? [`v${test.serverVersion}`] : []),
                    ...(test.topology ? [test.topology] : [])
                  ].join(' · ')
                : tFn('connection.testResult.failed', { error: test.error ?? 'unknown' })}
            </span>
          )}
          {sshError && (
            <span className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 font-mono text-[12px] text-destructive">
              {sshError}
            </span>
          )}
          {authError && (
            <span className="rounded-md border border-destructive/50 bg-destructive/10 px-2 py-1 font-mono text-[12px] text-destructive">
              {authError}
            </span>
          )}
          <span className="flex-1" />
          <Button variant="ghost" onClick={onClose}>
            {tFn('connection.action.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={saving}
            disabled={!host.trim() || (!useSrv && !membersValid) || !!sshError || !!authError}
            onClick={() => void submit()}
          >
            {tFn('connection.action.save')}
          </Button>
        </>
      }
    >
      {/* From URL / To URL: two independent one-way helpers, each in its own
          popup. From URL parses a pasted string INTO the fields; To URL exports
          the current fields OUT as a connection string. */}
      <div className="mb-5 flex items-center gap-2">
        <button
          type="button"
          className="inline-flex w-32 items-center justify-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-secondary px-5 py-1.5 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-[var(--accent)]"
          onClick={() => {
            setFromError(null)
            setUrlPanel('from')
          }}
        >
          <Plus size={15} />
          <span>{tFn('connection.uri.fromUrl')}</span>
        </button>
        <button
          type="button"
          className="inline-flex w-32 items-center justify-center gap-1.5 rounded-md border border-[var(--border-strong)] bg-secondary px-5 py-1.5 text-[13px] font-medium text-foreground/90 transition-colors hover:bg-accent hover:text-foreground [&_svg]:text-muted-foreground hover:[&_svg]:text-[var(--accent)]"
          onClick={openToUrl}
        >
          <Link size={15} />
          <span>{tFn('connection.uri.toUrl')}</span>
        </button>
        {parseNote && <span className="ml-1 text-[12px] text-[var(--ok)]">{parseNote}</span>}
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        className="mb-5"
        items={[
          { value: 'general', label: tFn('connection.tab.general') },
          { value: 'auth', label: tFn('connection.tab.auth') },
          { value: 'ssh', label: 'SSH' },
          { value: 'tls', label: 'TLS' }
        ]}
      />

      {tab === 'general' && (
        <>
          <div className="form-grid">
            <Field label={tFn('connection.general.name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My MongoDB" />
            </Field>
            <div className="flex flex-col gap-1.5">
              <label className="mb-0 text-[11px] font-medium text-muted-foreground">
                {tFn('connection.general.color')}
              </label>
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <button
                  type="button"
                  className={cn(
                    'relative size-6 shrink-0 rounded-full border-2 border-border bg-secondary p-0 transition-colors hover:border-[var(--border-strong)]',
                    color === '' && 'border-[var(--fg-0)]'
                  )}
                  data-tip={tFn('connection.general.noColor')}
                  aria-label={tFn('connection.general.noColor')}
                  onClick={() => setColor('')}
                >
                  <span
                    className="absolute inset-x-1 top-1/2 h-0.5 -translate-y-1/2 -rotate-45 bg-[var(--err)]"
                    aria-hidden
                  />
                </button>
                {PRESET_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={cn(
                      'size-6 shrink-0 rounded-full border-2 border-transparent p-0 transition hover:border-[var(--border-strong)]',
                      color === c && 'border-[var(--fg-0)] shadow-[0_0_0_2px_var(--bg-1)]'
                    )}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="form-row">
            <Checkbox
              checked={useSrv}
              onCheckedChange={setUseSrv}
              label={tFn('connection.general.useSrv')}
            />
          </div>

          {useSrv ? (
            <Field
              label={tFn('connection.general.srvHost')}
              hint={tFn('connection.general.srvHostHint')}
            >
              <Input
                value={srvHost}
                onChange={(e) => setSrvHost(e.target.value)}
                placeholder="cluster.mongodb.net"
              />
            </Field>
          ) : (
            <div className="mb-3">
              <div className="mb-1.5 flex items-center justify-between gap-3">
                <div className="text-[11px] font-medium text-muted-foreground">
                  {tFn('connection.general.hosts')}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setMembers((current) => [
                      ...current,
                      { id: genId(), host: '', port: '27017' }
                    ])
                  }
                >
                  <Plus size={14} />
                  {tFn('connection.general.addMember')}
                </Button>
              </div>

              <div className="overflow-hidden rounded-md border border-border">
                <div className="max-h-[151px] overflow-y-auto">
                  <div className="sticky top-0 z-10 grid h-7 grid-cols-[minmax(0,1fr)_112px_44px] items-center bg-[var(--bg-2)] text-[11px] font-medium text-muted-foreground">
                    <span className="px-3">{tFn('connection.general.memberHost')}</span>
                    <span className="h-full border-l border-border px-3 py-1.5">
                      {tFn('connection.general.memberPort')}
                    </span>
                    <span className="h-full border-l border-border" />
                  </div>
                  {members.length === 0 ? (
                    <div className="border-t border-border px-3 py-3 text-[12px] text-[var(--fg-3)]">
                      {tFn('connection.general.noMembers')}
                    </div>
                  ) : (
                    members.map((member, index) => (
                      <div
                        key={member.id}
                        className="grid grid-cols-[minmax(0,1fr)_112px_44px] items-stretch border-t border-border"
                      >
                        <Input
                          className="h-10 rounded-none border-0 bg-transparent px-3 focus-visible:border-0 focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                          value={member.host}
                          aria-label={`${tFn('connection.general.memberHost')} ${index + 1}`}
                          placeholder="db1.example.com"
                          onChange={(event) =>
                            setMembers((current) =>
                              current.map((row) => (row.id === member.id ? { ...row, host: event.target.value } : row))
                            )
                          }
                        />
                        <div className="border-l border-border">
                          <Input
                            className="h-10 rounded-none border-0 bg-transparent px-3 focus-visible:border-0 focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                            value={member.port}
                            inputMode="numeric"
                            aria-label={`${tFn('connection.general.memberPort')} ${index + 1}`}
                            placeholder="27017"
                            onChange={(event) =>
                              setMembers((current) =>
                                current.map((row) =>
                                  row.id === member.id ? { ...row, port: event.target.value } : row
                                )
                              )
                            }
                          />
                        </div>
                        <div className="flex items-center justify-center border-l border-border">
                          <button
                            type="button"
                            className="inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            aria-label={`${tFn('connection.general.removeMember')} ${index + 1}`}
                            data-tip={tFn('connection.general.removeMember')}
                            onClick={() => setMembers((current) => current.filter((row) => row.id !== member.id))}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
              {members.length > 0 && !membersValid && (
                <div className="mt-1.5 text-[11px] text-destructive">
                  {tFn('connection.general.membersInvalid')}
                </div>
              )}
            </div>
          )}

          <div className="form-grid">
            <Field label={tFn('connection.general.replicaSet')}>
              <Input
                value={replicaSet}
                onChange={(e) => setReplicaSet(e.target.value)}
                placeholder={tFn('connection.optional')}
              />
            </Field>
            <Field label={tFn('connection.general.readPreference')}>
              <Select
                value={readPreference}
                onChange={setReadPreference}
                options={[
                  {
                    label: tFn('connection.general.readPreferenceDefault'),
                    value: ''
                  },
                  { label: 'primary', value: 'primary' },
                  { label: 'primaryPreferred', value: 'primaryPreferred' },
                  { label: 'secondary', value: 'secondary' },
                  { label: 'secondaryPreferred', value: 'secondaryPreferred' },
                  { label: 'nearest', value: 'nearest' }
                ]}
              />
            </Field>
            <Field label={tFn('connection.general.defaultDatabase')}>
              <Input
                value={defaultDatabase}
                onChange={(e) => setDefaultDatabase(e.target.value)}
                placeholder={tFn('connection.optional')}
              />
            </Field>
            <Field label={tFn('connection.auth.authSource')}>
              <Input value={authSource} onChange={(e) => setAuthSource(e.target.value)} placeholder="admin" />
            </Field>
          </div>

          {sshEnabled && replicaSet.trim() && (
            <div className="hint">{tFn('connection.general.replicaSetSshIgnored')}</div>
          )}

          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <div className="text-[11px] font-medium text-muted-foreground">
                {tFn('connection.general.customOptions')}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCustomOptions((current) => [...current, { id: genId(), key: '', value: '' }])}
              >
                <Plus size={14} />
                {tFn('connection.general.addOption')}
              </Button>
            </div>
            <div className="overflow-hidden rounded-md border border-border">
              <div className="max-h-[151px] overflow-y-auto">
                <div className="sticky top-0 z-10 grid h-7 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-center bg-[var(--bg-2)] text-[11px] font-medium text-muted-foreground">
                  <span className="px-3">{tFn('connection.general.optionKey')}</span>
                  <span className="h-full border-l border-border px-3 py-1.5">
                    {tFn('connection.general.optionValue')}
                  </span>
                  <span className="h-full border-l border-border" />
                </div>
                {customOptions.length === 0 ? (
                  <div className="border-t border-border px-3 py-3 text-[12px] text-[var(--fg-3)]">
                    {tFn('connection.general.noOptions')}
                  </div>
                ) : (
                  customOptions.map((option, index) => (
                    <div
                      key={option.id}
                      className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_44px] items-stretch border-t border-border"
                    >
                      <Input
                        className="h-10 rounded-none border-0 bg-transparent px-3 font-mono focus-visible:border-0 focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                        value={option.key}
                        aria-label={`${tFn('connection.general.optionKey')} ${index + 1}`}
                        placeholder="retryWrites"
                        onChange={(event) =>
                          setCustomOptions((current) =>
                            current.map((row) => (row.id === option.id ? { ...row, key: event.target.value } : row))
                          )
                        }
                      />
                      <div className="border-l border-border">
                        <Input
                          className="h-10 rounded-none border-0 bg-transparent px-3 font-mono focus-visible:border-0 focus-visible:shadow-[inset_0_0_0_2px_var(--accent)]"
                          value={option.value}
                          aria-label={`${tFn('connection.general.optionValue')} ${index + 1}`}
                          placeholder="true"
                          onChange={(event) =>
                            setCustomOptions((current) =>
                              current.map((row) => (row.id === option.id ? { ...row, value: event.target.value } : row))
                            )
                          }
                        />
                      </div>
                      <div className="flex items-center justify-center border-l border-border">
                        <button
                          type="button"
                          className="inline-flex size-7 items-center justify-center rounded-md border-0 bg-transparent p-0 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          aria-label={`${tFn('connection.general.removeOption')} ${index + 1}`}
                          data-tip={tFn('connection.general.removeOption')}
                          onClick={() => setCustomOptions((current) => current.filter((row) => row.id !== option.id))}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === 'auth' && (
        <>
          <div className="mb-3 text-[11px] text-[var(--fg-3)]">
            {tFn('connection.auth.emptyMeansNone')}
          </div>
          <div className="form-grid">
            <Field label={tFn('connection.auth.username')} error={authError}>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} />
            </Field>
            <Field label={tFn('connection.auth.password')}>
              <Input
                type="password"
                value={password}
                placeholder={secretPlaceholder(editing?.hasPassword)}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setPasswordTouched(true)
                }}
              />
            </Field>
          </div>
          <Field className="w-[calc(50%-8px)]" label={tFn('connection.auth.mechanism')}>
            <Select<ScramMechanism>
              value={mechanism}
              onChange={setMechanism}
              options={[
                { label: 'DEFAULT', value: 'DEFAULT' },
                { label: 'SCRAM-SHA-256', value: 'SCRAM-SHA-256' },
                { label: 'SCRAM-SHA-1', value: 'SCRAM-SHA-1' }
              ]}
            />
          </Field>
        </>
      )}

      {tab === 'ssh' && (
        <>
          <div className="form-row">
            <Checkbox
              checked={sshEnabled}
              onCheckedChange={setSshEnabled}
              label={tFn('connection.ssh.enableLabel')}
            />
          </div>

          {sshEnabled && (
            <>
              <div className="form-grid">
                <Field label={tFn('connection.ssh.host')}>
                  <Input value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
                </Field>
                <Field label={tFn('connection.ssh.port')}>
                  <Input value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
                </Field>
              </div>
              <div className="form-grid">
                <Field label={tFn('connection.ssh.username')}>
                  <Input value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                </Field>
                <Field label={tFn('connection.ssh.authMethod')}>
                  <Select<SshAuthMethod>
                    value={sshAuthMethod}
                    onChange={setSshAuthMethod}
                    options={[
                      { label: tFn('connection.ssh.methodPassword'), value: 'password' },
                      { label: tFn('connection.ssh.methodPrivateKey'), value: 'privateKey' }
                    ]}
                  />
                </Field>
              </div>

              {sshAuthMethod === 'password' && (
                <Field label={tFn('connection.ssh.password')}>
                  <Input
                    type="password"
                    value={sshPassword}
                    placeholder={secretPlaceholder(editing?.hasSshPassword)}
                    onChange={(e) => {
                      setSshPassword(e.target.value)
                      setSshPasswordTouched(true)
                    }}
                  />
                </Field>
              )}

              {sshAuthMethod === 'privateKey' && (
                <>
                  <Field label={tFn('connection.ssh.privateKeyPath')}>
                    <div className="flex items-center gap-2">
                      <Input
                        className="min-w-0 flex-1"
                        value={privateKeyPath}
                        onChange={(e) => setPrivateKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                      />
                      <Button variant="ghost" type="button" onClick={() => void browseKey(setPrivateKeyPath)}>
                        {tFn('connection.ssh.browse')}
                      </Button>
                    </div>
                  </Field>
                  <Field label={tFn('connection.ssh.passphrase')}>
                    <Input
                      type="password"
                      value={sshPassphrase}
                      placeholder={
                        secretPlaceholder(editing?.hasSshPassphrase) ||
                        tFn('connection.ssh.passphraseHint')
                      }
                      onChange={(e) => {
                        setSshPassphrase(e.target.value)
                        setSshPassphraseTouched(true)
                      }}
                    />
                  </Field>
                </>
              )}

              {/* Connectivity check for the SSH/target host (through the jump if one is set). */}
              <DiagnoseControl busy={sshDiagBusy} stages={sshDiag} onRun={() => void runSshDiag()} />

              {/* Jump host (bastion / ProxyJump): reach the target through it. */}
              <div className="form-row" style={{ marginTop: 8 }}>
                <Checkbox
                  checked={jumpEnabled}
                  onCheckedChange={setJumpEnabled}
                  label={tFn('connection.ssh.jumpEnableLabel')}
                />
              </div>

              {jumpEnabled && (
                <>
                  <div className="form-grid">
                    <Field label={tFn('connection.ssh.jumpHost')}>
                      <Input value={jumpHost} onChange={(e) => setJumpHost(e.target.value)} />
                    </Field>
                    <Field label={tFn('connection.ssh.jumpPort')}>
                      <Input
                        value={jumpPort}
                        onChange={(e) => setJumpPort(e.target.value)}
                        placeholder="22"
                      />
                    </Field>
                  </div>
                  <Field label={tFn('connection.ssh.jumpUsername')}>
                    <Input value={jumpUser} onChange={(e) => setJumpUser(e.target.value)} />
                  </Field>

                  <Field label={tFn('connection.ssh.privateKeyPath')}>
                    <div className="flex items-center gap-2">
                      <Input
                        className="min-w-0 flex-1"
                        value={jumpKeyPath}
                        onChange={(e) => setJumpKeyPath(e.target.value)}
                        placeholder="~/.ssh/id_ed25519"
                      />
                      <Button variant="ghost" type="button" onClick={() => void browseKey(setJumpKeyPath)}>
                        {tFn('connection.ssh.browse')}
                      </Button>
                    </div>
                  </Field>
                  <Field label={tFn('connection.ssh.jumpPassphrase')}>
                    <Input
                      type="password"
                      value={jumpSshPassphrase}
                      placeholder={
                        secretPlaceholder(editing?.hasJumpSshPassphrase) ||
                        tFn('connection.ssh.passphraseHint')
                      }
                      onChange={(e) => {
                        setJumpSshPassphrase(e.target.value)
                        setJumpSshPassphraseTouched(true)
                      }}
                    />
                  </Field>

                  {/* Connectivity check for the jump host alone. */}
                  <DiagnoseControl busy={jumpDiagBusy} stages={jumpDiag} onRun={() => void runJumpDiag()} />
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'tls' && (
        <>
          <div className="form-row">
            <Checkbox
              checked={tlsEnabled}
              onCheckedChange={setTlsEnabled}
              label={tFn('connection.tls.enableLabel')}
            />
          </div>

          {tlsEnabled && (
            <>
              <div className="form-row">
                <Checkbox
                  checked={allowInvalidCertificates}
                  onCheckedChange={setAllowInvalid}
                  label={tFn('connection.tls.allowInvalid')}
                />
                <div className="hint">{tFn('connection.tls.allowInvalidHint')}</div>
              </div>
              <Field label={tFn('connection.tls.caFile')}>
                <Input
                  value={caFile}
                  onChange={(e) => setCaFile(e.target.value)}
                  placeholder={tFn('connection.optional')}
                />
              </Field>
              <Field label={tFn('connection.tls.certKeyFile')}>
                <Input
                  value={certificateKeyFile}
                  onChange={(e) => setCertKeyFile(e.target.value)}
                  placeholder={tFn('connection.optional')}
                />
              </Field>
            </>
          )}
        </>
      )}

      {/* From URL popup: paste a connection string → fill the fields. A nested
          Base UI dialog over the form (backdrop class lifts it above the form). */}
      <Dialog
        open={urlPanel === 'from'}
        onOpenChange={(o) => {
          if (!o) setUrlPanel(null)
        }}
        className="z-[1101]! flex w-[470px] max-w-[92vw] flex-col gap-3.5 rounded-lg border border-[var(--border-strong)] bg-card p-[18px] shadow-[var(--shadow-lg)]"
        backdropClassName="fixed inset-0 z-[1100] bg-black/35"
      >
        <div className="flex items-start gap-3">
          <ClipboardPaste size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold">{tFn('connection.uri.fromUrlTitle')}</span>
            <span className="text-[11px] text-muted-foreground">{tFn('connection.uri.fromUrlHint')}</span>
          </div>
        </div>
        <textarea
          className="w-full resize-y rounded-md border border-border bg-secondary px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground outline-none [word-break:break-all] focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
          autoFocus
          rows={3}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          value={fromText}
          onChange={(e) => setFromText(e.target.value)}
          placeholder={tFn('connection.uri.placeholder')}
        />
        {fromError && (
          <div className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-[11px] text-destructive">{fromError}</div>
        )}
        <div className="flex items-center gap-2">
          <span className="flex-1" />
          <Button variant="ghost" type="button" onClick={() => setUrlPanel(null)}>
            {tFn('connection.action.cancel')}
          </Button>
          <Button variant="primary" type="button" disabled={!fromText.trim()} onClick={applyFromUrl}>
            {tFn('connection.uri.parseAction')}
          </Button>
        </div>
      </Dialog>

      {/* To URL popup: export the current fields as a connection string. */}
      <Dialog
        open={urlPanel === 'to'}
        onOpenChange={(o) => {
          if (!o) setUrlPanel(null)
        }}
        className="z-[1101]! flex w-[470px] max-w-[92vw] flex-col gap-3.5 rounded-lg border border-[var(--border-strong)] bg-card p-[18px] shadow-[var(--shadow-lg)]"
        backdropClassName="fixed inset-0 z-[1100] bg-black/35"
      >
        <div className="flex items-start gap-3">
          <Link size={16} className="mt-0.5 shrink-0 text-[var(--accent)]" />
          <div className="flex flex-col gap-0.5">
            <span className="text-[13px] font-semibold">{tFn('connection.uri.toUrlTitle')}</span>
            <span className="text-[11px] text-muted-foreground">{tFn('connection.uri.toUrlHint')}</span>
          </div>
        </div>
        {/* Editable: regenerated on open / password-toggle, but the user can tweak
            it before copying. Copy uses whatever is in the box. */}
        <textarea
          className="w-full resize-y rounded-md border border-border bg-secondary px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground outline-none [word-break:break-all] focus-visible:border-[var(--accent)] focus-visible:shadow-[0_0_0_3px_var(--accent-soft)]"
          rows={3}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          value={toUriText}
          placeholder={toBuilding ? '…' : undefined}
          onChange={(e) => {
            setToUriText(e.target.value)
            setToCopied(false)
          }}
        />
        {hasPasswordAuth && (
          <Checkbox
            className="w-full gap-2.5 rounded-md border border-border bg-secondary px-3 py-2.5 hover:border-[var(--border-strong)]"
            checked={toIncludePassword}
            onCheckedChange={setIncludePassword}
            label={tFn('connection.uri.includePassword')}
          />
        )}
        <div className="flex items-center gap-2">
          {toCopied && <span className="text-[11px] text-[var(--ok)]">{tFn('connection.uri.copied')}</span>}
          <span className="flex-1" />
          <Button variant="ghost" type="button" onClick={() => setUrlPanel(null)}>
            {tFn('connection.action.cancel')}
          </Button>
          <Button
            variant="primary"
            type="button"
            disabled={!toUriText || toBuilding}
            onClick={() => void copyToUri()}
          >
            {tFn('connection.uri.copyAction')}
          </Button>
        </div>
      </Dialog>
    </Modal>
  )
}
