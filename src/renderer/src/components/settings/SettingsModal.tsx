import { useTranslation } from 'react-i18next'
import type { CollectionSort, Language, ThemeMode } from '@shared/types'
import { useAppStore } from '@renderer/store/useAppStore'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Field } from '@renderer/components/ui/Field'
import { Select } from '@renderer/components/ui/Select'
import { NumberField } from '@renderer/components/ui/NumberField'
import { Checkbox } from '@renderer/components/ui/Checkbox'

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

        <Field label={t('settings.language')}>
          <Select<Language>
            value={settings.language}
            onChange={(language) => void updateSettings({ language })}
            options={[
              { label: t('settings.languageSystem'), value: 'system' },
              { label: 'English', value: 'en' },
              { label: '简体中文', value: 'zh-CN' },
              { label: '繁體中文', value: 'zh-TW' }
            ]}
          />
        </Field>

        <Field label={t('settings.theme')}>
          <Select<ThemeMode>
            value={settings.theme}
            onChange={(theme) => void updateSettings({ theme })}
            options={[
              { label: t('settings.themeSystem'), value: 'system' },
              { label: t('settings.themeLight'), value: 'light' },
              { label: t('settings.themeDark'), value: 'dark' }
            ]}
          />
        </Field>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionCatalog')}</div>
        <Field label={t('settings.collectionSort')}>
          <Select<CollectionSort>
            value={settings.collectionSort}
            onChange={(collectionSort) => void updateSettings({ collectionSort })}
            options={[
              { label: t('settings.sortNatural'), value: 'natural' },
              { label: t('settings.sortAlpha'), value: 'alpha' }
            ]}
          />
        </Field>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionQuery')}</div>
        <Field label={t('settings.queryLimit')} hint={t('settings.queryLimitHint')}>
          <NumberField
            min={1}
            max={1000}
            value={settings.queryLimit}
            onChange={(n) => {
              if (n != null) void updateSettings({ queryLimit: n })
            }}
            aria-label={t('settings.queryLimit')}
          />
        </Field>
      </div>

      <div className="settings-section">
        <div className="settings-section-title">{t('settings.sectionEditor')}</div>
        <div className="form-grid">
          <Field label={t('settings.editorFontSize')}>
            <NumberField
              min={9}
              max={28}
              value={settings.editorFontSize}
              onChange={(n) => {
                if (n != null) void updateSettings({ editorFontSize: n })
              }}
              aria-label={t('settings.editorFontSize')}
            />
          </Field>
          <Field label={t('settings.editorTabSize')}>
            <Select<number>
              value={settings.editorTabSize}
              onChange={(editorTabSize) => void updateSettings({ editorTabSize })}
              options={[
                { label: '2', value: 2 },
                { label: '4', value: 4 }
              ]}
            />
          </Field>
        </div>
        <div className="form-row">
          <Checkbox
            checked={settings.editorWordWrap}
            onCheckedChange={(editorWordWrap) => void updateSettings({ editorWordWrap })}
            label={t('settings.editorWordWrap')}
          />
        </div>
      </div>
    </Modal>
  )
}
