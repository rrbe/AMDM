import { useMemo, useState } from 'react'
import type {
  ConnectionConfig,
  ConnectionInput,
  ScramMechanism,
  SshAuthMethod,
  TestResult
} from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { Modal } from '@renderer/components/common/Modal'
import { BusyButton } from '@renderer/components/common/BusyButton'
import { buildMongoUri, parseMongoUri, PRESET_COLORS } from '@renderer/lib/connectionUri'

type Tab = 'general' | 'auth' | 'ssh' | 'tls'

function genId(): string {
  return `conn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface ConnectionFormProps {
  editing?: ConnectionConfig
  onClose: () => void
}

/**
 * Create / edit a connection. Secret fields (password, sshPassword,
 * sshPassphrase) come back BLANK on edit (the sanitized config only carries
 * `has*` booleans). We track whether the user touched each secret; if they did
 * NOT, we send `undefined` so the main process keeps the stored secret.
 *
 * The top bar supports pasting a full connection string ("From URI" parses it
 * into the fields) and exporting the current fields ("To URI").
 */
export function ConnectionForm({ editing, onClose }: ConnectionFormProps): JSX.Element {
  const saveConnection = useAppStore((s) => s.saveConnection)
  const testConnection = useAppStore((s) => s.testConnection)

  const [tab, setTab] = useState<Tab>('general')
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)

  // ---- URI bar ----
  const [uriText, setUriText] = useState('')
  const [uriError, setUriError] = useState<string | null>(null)
  const [uriNote, setUriNote] = useState<string | null>(null)

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

  // ---- TLS ----
  const [tlsEnabled, setTlsEnabled] = useState(editing?.tls.enabled ?? false)
  const [allowInvalidCertificates, setAllowInvalid] = useState(
    editing?.tls.allowInvalidCertificates ?? false
  )
  const [caFile, setCaFile] = useState(editing?.tls.caFile ?? '')
  const [certificateKeyFile, setCertKeyFile] = useState(editing?.tls.certificateKeyFile ?? '')

  // ---- URI parse / build ----
  const applyUri = (): void => {
    try {
      const p = parseMongoUri(uriText)
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
      setUriError(null)
      setUriNote('Parsed into the form below.')
      setTab('general')
    } catch (e) {
      setUriNote(null)
      setUriError(e instanceof Error ? e.message : 'Parse failed')
    }
  }

  const toUri = async (): Promise<void> => {
    const uri = buildMongoUri({
      useSrv,
      host: host.trim(),
      port: useSrv ? null : Number(port) || 27017,
      replicaSet: replicaSet.trim() || undefined,
      defaultDatabase: defaultDatabase.trim() || undefined,
      authType,
      username: username.trim() || undefined,
      password: passwordTouched ? password : undefined,
      authSource: authSource.trim() || undefined,
      tlsEnabled,
      tlsAllowInvalid: allowInvalidCertificates,
      options
    })
    setUriText(uri)
    setUriError(null)
    let copied = false
    try {
      await navigator.clipboard.writeText(uri)
      copied = true
    } catch {
      /* clipboard may be unavailable */
    }
    const pwOmitted = authType === 'scram' && !passwordTouched && editing?.hasPassword
    setUriNote(
      `${copied ? 'Built URI · copied to clipboard.' : 'Built URI.'}${
        pwOmitted ? ' (password omitted — re-type to include)' : ''
      }`
    )
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
              sshAuthMethod === 'privateKey' ? privateKeyPath.trim() || undefined : undefined
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

  const secretPlaceholder = (has?: boolean): string =>
    has ? '•••••••• (unchanged — leave blank to keep)' : ''

  return (
    <Modal
      title={editing ? 'Edit Connection' : 'New Connection'}
      onClose={onClose}
      footer={
        <>
          <BusyButton className="ghost" busy={testing} onClick={() => void runTest()}>
            Test connection
          </BusyButton>
          {test && (
            <span
              className={test.ok ? 'test-result ok' : 'test-result err'}
              style={{ marginTop: 0, padding: '4px 8px' }}
            >
              {test.ok
                ? `OK${test.serverVersion ? ` · v${test.serverVersion}` : ''}${test.topology ? ` · ${test.topology}` : ''}`
                : `Failed: ${test.error ?? 'unknown'}`}
            </span>
          )}
          <span className="spacer" />
          <button className="ghost" onClick={onClose}>
            Cancel
          </button>
          <BusyButton className="primary" busy={saving} disabled={!host.trim()} onClick={() => void submit()}>
            Save
          </BusyButton>
        </>
      }
    >
      {/* Connection string: paste to parse, or export the current fields. */}
      <div className="uri-bar">
        <input
          value={uriText}
          onChange={(e) => setUriText(e.target.value)}
          placeholder="mongodb://user:pass@host:27017/db?replicaSet=rs0 — paste, then “From URI”"
        />
        <button className="ghost" type="button" disabled={!uriText.trim()} onClick={applyUri}>
          From URI
        </button>
        <button className="ghost" type="button" onClick={() => void toUri()}>
          To URI
        </button>
      </div>
      {uriError && (
        <div className="hint" style={{ color: 'var(--danger, #ef4444)' }}>
          {uriError}
        </div>
      )}
      {uriNote && !uriError && <div className="hint">{uriNote}</div>}

      <div className="tabs">
        {(['general', 'auth', 'ssh', 'tls'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'general' ? 'General' : t === 'auth' ? 'Auth' : t === 'ssh' ? 'SSH' : 'TLS'}
          </button>
        ))}
      </div>

      {tab === 'general' && (
        <>
          <div className="form-grid">
            <div>
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My MongoDB" />
            </div>
            <div>
              <label>Color</label>
              <div className="color-swatches">
                <button
                  type="button"
                  className={`color-swatch none ${color === '' ? 'selected' : ''}`}
                  title="No color"
                  onClick={() => setColor('')}
                />
                {PRESET_COLORS.map((c) => (
                  <button
                    type="button"
                    key={c}
                    className={`color-swatch ${color === c ? 'selected' : ''}`}
                    style={{ background: c }}
                    title={c}
                    onClick={() => setColor(c)}
                  />
                ))}
              </div>
            </div>
          </div>

          <div className="form-row">
            <div className="form-inline">
              <input
                type="checkbox"
                id="useSrv"
                checked={useSrv}
                onChange={(e) => setUseSrv(e.target.checked)}
              />
              <label htmlFor="useSrv">Use SRV (mongodb+srv:// — Atlas)</label>
            </div>
          </div>

          <div className="form-grid">
            <div style={{ gridColumn: useSrv ? '1 / span 2' : 'auto' }}>
              <label>{useSrv ? 'SRV Host' : 'Host'}</label>
              <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="localhost" />
            </div>
            {!useSrv && (
              <div>
                <label>Port</label>
                <input value={port} onChange={(e) => setPort(e.target.value)} placeholder="27017" />
              </div>
            )}
          </div>

          <div className="form-grid">
            <div>
              <label>Replica Set</label>
              <input
                value={replicaSet}
                onChange={(e) => setReplicaSet(e.target.value)}
                placeholder="(optional)"
              />
            </div>
            <div>
              <label>Default Database</label>
              <input
                value={defaultDatabase}
                onChange={(e) => setDefaultDatabase(e.target.value)}
                placeholder="(optional)"
              />
            </div>
          </div>

          {Object.keys(options).length > 0 && (
            <div className="hint">
              Extra options: {Object.entries(options).map(([k, v]) => `${k}=${v}`).join(' · ')}
            </div>
          )}
        </>
      )}

      {tab === 'auth' && (
        <>
          <div className="form-row">
            <label>Authentication</label>
            <select value={authType} onChange={(e) => setAuthType(e.target.value as 'none' | 'scram')}>
              <option value="none">None</option>
              <option value="scram">Username / Password (SCRAM)</option>
            </select>
          </div>

          {authType === 'scram' && (
            <>
              <div className="form-grid">
                <div>
                  <label>Username</label>
                  <input value={username} onChange={(e) => setUsername(e.target.value)} />
                </div>
                <div>
                  <label>Password</label>
                  <input
                    type="password"
                    value={password}
                    placeholder={secretPlaceholder(editing?.hasPassword)}
                    onChange={(e) => {
                      setPassword(e.target.value)
                      setPasswordTouched(true)
                    }}
                  />
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <label>Auth Source</label>
                  <input
                    value={authSource}
                    onChange={(e) => setAuthSource(e.target.value)}
                    placeholder="admin"
                  />
                </div>
                <div>
                  <label>Mechanism</label>
                  <select
                    value={mechanism}
                    onChange={(e) => setMechanism(e.target.value as ScramMechanism)}
                  >
                    <option value="DEFAULT">DEFAULT</option>
                    <option value="SCRAM-SHA-256">SCRAM-SHA-256</option>
                    <option value="SCRAM-SHA-1">SCRAM-SHA-1</option>
                  </select>
                </div>
              </div>
            </>
          )}
        </>
      )}

      {tab === 'ssh' && (
        <>
          <div className="form-row">
            <div className="form-inline">
              <input
                type="checkbox"
                id="sshEnabled"
                checked={sshEnabled}
                onChange={(e) => setSshEnabled(e.target.checked)}
              />
              <label htmlFor="sshEnabled">Connect through an SSH tunnel</label>
            </div>
          </div>

          {sshEnabled && (
            <>
              <div className="form-grid">
                <div>
                  <label>SSH Host</label>
                  <input value={sshHost} onChange={(e) => setSshHost(e.target.value)} />
                </div>
                <div>
                  <label>SSH Port</label>
                  <input value={sshPort} onChange={(e) => setSshPort(e.target.value)} placeholder="22" />
                </div>
              </div>
              <div className="form-grid">
                <div>
                  <label>SSH Username</label>
                  <input value={sshUser} onChange={(e) => setSshUser(e.target.value)} />
                </div>
                <div>
                  <label>Auth Method</label>
                  <select
                    value={sshAuthMethod}
                    onChange={(e) => setSshAuthMethod(e.target.value as SshAuthMethod)}
                  >
                    <option value="password">Password</option>
                    <option value="privateKey">Private Key</option>
                  </select>
                </div>
              </div>

              {sshAuthMethod === 'password' ? (
                <div className="form-row">
                  <label>SSH Password</label>
                  <input
                    type="password"
                    value={sshPassword}
                    placeholder={secretPlaceholder(editing?.hasSshPassword)}
                    onChange={(e) => {
                      setSshPassword(e.target.value)
                      setSshPasswordTouched(true)
                    }}
                  />
                </div>
              ) : (
                <>
                  <div className="form-row">
                    <label>Private Key Path</label>
                    <input
                      value={privateKeyPath}
                      onChange={(e) => setPrivateKeyPath(e.target.value)}
                      placeholder="~/.ssh/id_ed25519"
                    />
                  </div>
                  <div className="form-row">
                    <label>Key Passphrase</label>
                    <input
                      type="password"
                      value={sshPassphrase}
                      placeholder={secretPlaceholder(editing?.hasSshPassphrase)}
                      onChange={(e) => {
                        setSshPassphrase(e.target.value)
                        setSshPassphraseTouched(true)
                      }}
                    />
                    <div className="hint">Leave blank if the key has no passphrase.</div>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}

      {tab === 'tls' && (
        <>
          <div className="form-row">
            <div className="form-inline">
              <input
                type="checkbox"
                id="tlsEnabled"
                checked={tlsEnabled}
                onChange={(e) => setTlsEnabled(e.target.checked)}
              />
              <label htmlFor="tlsEnabled">Enable TLS/SSL</label>
            </div>
          </div>

          {tlsEnabled && (
            <>
              <div className="form-row">
                <div className="form-inline">
                  <input
                    type="checkbox"
                    id="allowInvalid"
                    checked={allowInvalidCertificates}
                    onChange={(e) => setAllowInvalid(e.target.checked)}
                  />
                  <label htmlFor="allowInvalid">
                    Allow invalid certificates (self-signed / mismatched)
                  </label>
                </div>
                <div className="hint">Insecure — only for trusted dev environments.</div>
              </div>
              <div className="form-row">
                <label>CA File (.pem)</label>
                <input value={caFile} onChange={(e) => setCaFile(e.target.value)} placeholder="(optional)" />
              </div>
              <div className="form-row">
                <label>Client Cert + Key File (.pem)</label>
                <input
                  value={certificateKeyFile}
                  onChange={(e) => setCertKeyFile(e.target.value)}
                  placeholder="(optional)"
                />
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  )
}
