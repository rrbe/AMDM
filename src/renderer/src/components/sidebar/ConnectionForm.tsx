import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ClipboardPaste, Link, MessageSquareText } from 'lucide-react'
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
import { parseMongoUri, PRESET_COLORS } from '@renderer/lib/connectionUri'

type Tab = 'general' | 'auth' | 'ssh' | 'tls'

function genId(): string {
  return `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface ConnectionFormProps {
  editing?: ConnectionConfig
  onClose: () => void
}

/** Per-step ✓/✗ list for one hop's connectivity check (shared by SSH + jump). */
function DiagnoseResult({ stages }: { stages: DiagnoseStage[] }): JSX.Element {
  const { t } = useTranslation()
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 4 }}>
      {stages.map((s) => {
        const color = s.status === 'ok' ? '#4ade80' : s.status === 'fail' ? '#f87171' : '#9ca3af'
        const icon = s.status === 'ok' ? '✓' : s.status === 'fail' ? '✗' : '○'
        return (
          <div key={s.key} style={{ fontSize: 12 }}>
            <span style={{ color, fontWeight: 700, marginRight: 6 }}>{icon}</span>
            <span>{t(`connection.ssh.stage.${s.key}`)}</span>
            {s.target && <span style={{ marginLeft: 6, opacity: 0.6 }}>{s.target}</span>}
            {s.ms != null && <span style={{ marginLeft: 6, opacity: 0.6 }}>{s.ms}ms</span>}
            {s.detail && <div style={{ marginLeft: 18, color: '#f87171' }}>{s.detail}</div>}
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
      <div className="form-row" style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Button variant="ghost" type="button" busy={busy} onClick={onRun}>
          {t('connection.ssh.diagnose')}
        </Button>
        {stages != null && !busy && (
          <>
            <span style={{ color: allOk ? '#4ade80' : '#f87171', fontWeight: 700 }}>
              {allOk ? '✓' : '✗'}
            </span>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-label={t(open ? 'connection.ssh.diagHide' : 'connection.ssh.diagShow')}
              data-tip={t(open ? 'connection.ssh.diagHide' : 'connection.ssh.diagShow')}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                padding: 0,
                color: open ? 'inherit' : 'var(--fg-3, #9ca3af)'
              }}
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
  const [host, setHost] = useState(editing?.host ?? 'localhost')
  const [port, setPort] = useState(String(editing?.port ?? 27017))
  const [replicaSet, setReplicaSet] = useState(editing?.replicaSet ?? '')
  const [defaultDatabase, setDefaultDatabase] = useState(editing?.defaultDatabase ?? '')
  const [options, setOptions] = useState<Record<string, string>>(editing?.options ?? {})

  // ---- Auth ----
  const [authType, setAuthType] = useState<'none' | 'scram'>(editing?.auth.type ?? 'none')
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
      setHost(p.host)
      setPort(p.port != null ? String(p.port) : '27017')
      setReplicaSet(p.replicaSet)
      setDefaultDatabase(p.defaultDatabase)
      if (p.hasAuth) {
        setAuthType('scram')
        setUsername(p.username)
        if (p.password != null) {
          setPassword(p.password)
          setPasswordTouched(true)
        }
        setAuthSource(p.authSource)
      } else {
        setAuthType('none')
      }
      setTlsEnabled(p.tlsEnabled)
      setAllowInvalid(p.tlsAllowInvalid)
      setOptions(p.extraOptions)
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
  const hasPasswordAuth = authType === 'scram' && !!username.trim()

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
          port: useSrv ? undefined : Number(port) || 27017,
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
        if (passwordTouched) input.password = password
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
      port,
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
      footer={
        <>
          <Button variant="ghost" busy={testing} onClick={() => void runTest()}>
            {tFn('connection.action.test')}
          </Button>
          {test && (
            <span
              className={test.ok ? 'test-result ok' : 'test-result err'}
              style={{ marginTop: 0, padding: '4px 8px' }}
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
            <span className="test-result err" style={{ marginTop: 0, padding: '4px 8px' }}>
              {sshError}
            </span>
          )}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            {tFn('connection.action.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={saving}
            disabled={!host.trim() || !!sshError}
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
      <div className="url-actions">
        <button
          type="button"
          className="url-action-btn"
          onClick={() => {
            setFromError(null)
            setUrlPanel('from')
          }}
        >
          <ClipboardPaste size={15} />
          <span>{tFn('connection.uri.fromUrl')}</span>
        </button>
        <button type="button" className="url-action-btn" onClick={openToUrl}>
          <Link size={15} />
          <span>{tFn('connection.uri.toUrl')}</span>
        </button>
        {parseNote && <span className="url-actions-note">{parseNote}</span>}
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
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
            <div>
              <label>{tFn('connection.general.color')}</label>
              <div className="color-swatches">
                <button
                  type="button"
                  className={`color-swatch none ${color === '' ? 'selected' : ''}`}
                  data-tip={tFn('connection.general.noColor')}
                  aria-label={tFn('connection.general.noColor')}
                  onClick={() => setColor('')}
                />
                {PRESET_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`color-swatch ${color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    data-tip={c}
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

          <div className="form-grid">
            <Field
              label={useSrv ? tFn('connection.general.srvHost') : tFn('connection.general.host')}
              style={{ gridColumn: useSrv ? '1 / span 2' : 'auto' }}
            >
              <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
            </Field>
            {!useSrv && (
              <Field label={tFn('connection.general.port')}>
                <Input value={port} onChange={(e) => setPort(e.target.value)} placeholder="27017" />
              </Field>
            )}
          </div>

          <div className="form-grid">
            <Field label={tFn('connection.general.replicaSet')}>
              <Input
                value={replicaSet}
                onChange={(e) => setReplicaSet(e.target.value)}
                placeholder={tFn('connection.optional')}
              />
            </Field>
            <Field label={tFn('connection.general.defaultDatabase')}>
              <Input
                value={defaultDatabase}
                onChange={(e) => setDefaultDatabase(e.target.value)}
                placeholder={tFn('connection.optional')}
              />
            </Field>
          </div>

          {sshEnabled && replicaSet.trim() && (
            <div className="hint">{tFn('connection.general.replicaSetSshIgnored')}</div>
          )}

          {Object.keys(options).length > 0 && (
            <div className="hint">
              {tFn('connection.general.extraOptions', { opts: Object.entries(options).map(([k, v]) => `${k}=${v}`).join(' · ') })}
            </div>
          )}
        </>
      )}

      {tab === 'auth' && (
        <>
          <Field label={tFn('connection.auth.authentication')}>
            <Select<'none' | 'scram'>
              value={authType}
              onChange={setAuthType}
              options={[
                { label: tFn('connection.auth.none'), value: 'none' },
                { label: tFn('connection.auth.scram'), value: 'scram' }
              ]}
            />
          </Field>

          {authType === 'scram' && (
            <>
              <div className="form-grid">
                <Field label={tFn('connection.auth.username')}>
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
              <div className="form-grid">
                <Field label={tFn('connection.auth.authSource')}>
                  <Input
                    value={authSource}
                    onChange={(e) => setAuthSource(e.target.value)}
                    placeholder="admin"
                  />
                </Field>
                <Field label={tFn('connection.auth.mechanism')}>
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
              </div>
            </>
          )}
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
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Input
                        style={{ flex: 1, minWidth: 0 }}
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
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <Input
                        style={{ flex: 1, minWidth: 0 }}
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
        className="url-popup"
        backdropClassName="url-popup-backdrop"
      >
        <div className="url-popup-head">
          <ClipboardPaste size={16} />
          <div className="url-popup-titles">
            <span className="url-popup-title">{tFn('connection.uri.fromUrlTitle')}</span>
            <span className="url-popup-sub">{tFn('connection.uri.fromUrlHint')}</span>
          </div>
        </div>
        <textarea
          className="url-popup-input mono"
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
        {fromError && <div className="url-popup-err">{fromError}</div>}
        <div className="url-popup-foot">
          <span className="spacer" />
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
        className="url-popup"
        backdropClassName="url-popup-backdrop"
      >
        <div className="url-popup-head">
          <Link size={16} />
          <div className="url-popup-titles">
            <span className="url-popup-title">{tFn('connection.uri.toUrlTitle')}</span>
            <span className="url-popup-sub">{tFn('connection.uri.toUrlHint')}</span>
          </div>
        </div>
        {/* Editable: regenerated on open / password-toggle, but the user can tweak
            it before copying. Copy uses whatever is in the box. */}
        <textarea
          className="url-popup-input mono"
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
            className="url-popup-check"
            checked={toIncludePassword}
            onCheckedChange={setIncludePassword}
            label={tFn('connection.uri.includePassword')}
          />
        )}
        <div className="url-popup-foot">
          {toCopied && <span className="url-popup-ok">{tFn('connection.uri.copied')}</span>}
          <span className="spacer" />
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
