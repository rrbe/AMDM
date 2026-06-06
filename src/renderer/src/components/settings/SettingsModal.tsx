import { useTranslation } from 'react-i18next'
import type { CollectionSort, Language, ThemeMode } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'

/**
 * Centralized preferences. Every control writes straight through the store's
 * `updateSettings` (optimistic + persisted to settings.json). This is the home
 * for the UI language; the other knobs were previously only reachable via drag
 * handles / keyboard shortcuts, surfaced here for discoverability.
 *
 * Language native names ('English' / '简体中文' / '繁體中文') are intentionally
 * NOT translated — a language picker shows each option in its own script.
 */
export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { t } = useTranslation()
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)

  return (
    <Modal
      title={t('settings.title')}
      small
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="primary" onClick={onClose}>
            {t('settings.done')}
          </Button>
        </>
      }
    >
      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionAppearance')}</div>

        <div className="form-row">
          <label>{t('settings.language')}</label>
          <select
            value={settings.language}
            onChange={(e) => void updateSettings({ language: e.target.value as Language })}
          >
            <option value="system">{t('settings.languageSystem')}</option>
            <option value="en">English</option>
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
          </select>
        </div>

        <div className="form-row">
          <label>{t('settings.theme')}</label>
          <select
            value={settings.theme}
            onChange={(e) => void updateSettings({ theme: e.target.value as ThemeMode })}
          >
            <option value="system">{t('settings.themeSystem')}</option>
            <option value="light">{t('settings.themeLight')}</option>
            <option value="dark">{t('settings.themeDark')}</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionCatalog')}</div>
        <div className="form-row">
          <label>{t('settings.collectionSort')}</label>
          <select
            value={settings.collectionSort}
            onChange={(e) =>
              void updateSettings({ collectionSort: e.target.value as CollectionSort })
            }
          >
            <option value="natural">{t('settings.sortNatural')}</option>
            <option value="alpha">{t('settings.sortAlpha')}</option>
          </select>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionQuery')}</div>
        <div className="form-row">
          <label>{t('settings.queryLimit')}</label>
          <input
            type="number"
            min={1}
            max={1000}
            value={settings.queryLimit}
            onChange={(e) => {
              const n = Math.min(1000, Math.max(1, parseInt(e.target.value, 10) || settings.queryLimit))
              void updateSettings({ queryLimit: n })
            }}
          />
          <div className="hint">{t('settings.queryLimitHint')}</div>
        </div>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionEditor')}</div>
        <div className="form-grid">
          <div>
            <label>{t('settings.editorFontSize')}</label>
            <input
              type="number"
              min={9}
              max={28}
              value={settings.editorFontSize}
              onChange={(e) => {
                const n = Math.min(28, Math.max(9, parseInt(e.target.value, 10) || settings.editorFontSize))
                void updateSettings({ editorFontSize: n })
              }}
            />
          </div>
          <div>
            <label>{t('settings.editorTabSize')}</label>
            <select
              value={settings.editorTabSize}
              onChange={(e) => void updateSettings({ editorTabSize: Number(e.target.value) })}
            >
              <option value={2}>2</option>
              <option value={4}>4</option>
            </select>
          </div>
        </div>
        <div className="form-row">
          <div className="form-inline">
            <input
              type="checkbox"
              id="settings-word-wrap"
              checked={settings.editorWordWrap}
              onChange={(e) => void updateSettings({ editorWordWrap: e.target.checked })}
            />
            <label htmlFor="settings-word-wrap">{t('settings.editorWordWrap')}</label>
          </div>
        </div>
      </div>
    </Modal>
  )
}
