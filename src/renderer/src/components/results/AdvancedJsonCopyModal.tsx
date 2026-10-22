import { jsonFormatExamples as examples } from '@renderer/lib/jsonFormatExamples'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@renderer/components/common/Modal'
import { Button } from '@renderer/components/common/Button'
import { Radio, RadioGroup } from '@renderer/components/ui/RadioGroup'
import {
  copyText,
  toEncodedJsonArray,
  toEncodedJsonLines
} from '@renderer/lib/resultCopy'

const formats = ['plain', 'relaxed', 'canonical'] as const

type Format = (typeof formats)[number]

export function AdvancedJsonCopyModal({
  documents,
  onClose
}: {
  documents: unknown[]
  onClose: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [layout, setLayout] = useState<'json' | 'jsonl'>('json')
  const [copying, setCopying] = useState<Format | null>(null)
  const copy = async (format: Format): Promise<void> => {
    setCopying(format)
    try {
      const text =
        layout === 'json'
          ? toEncodedJsonArray(documents, format)
          : toEncodedJsonLines(documents, format)
      if (await copyText(text)) onClose()
    } finally {
      setCopying(null)
    }
  }

  return (
    <Modal title={t('result.advancedCopy.title')} onClose={onClose} size="lg">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="text-[12px] text-muted-foreground">
          {t('result.advancedCopy.layout')}
        </span>
        <RadioGroup<'json' | 'jsonl'>
          value={layout}
          onValueChange={setLayout}
          disabled={copying !== null}
          aria-label={t('result.advancedCopy.layout')}
          className="flex gap-4"
        >
          {(['json', 'jsonl'] as const).map((value) => (
            <Radio
              key={value}
              value={value}
              render={<button type="button" />}
              nativeButton
              className="flex cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent px-2 py-1 text-[12px] text-foreground outline-none focus-visible:shadow-[0_0_0_3px_var(--focus-soft)]"
            >
              <span
                aria-hidden
                className="flex size-3.5 items-center justify-center rounded-full border border-[var(--separator-strong)]"
              >
                {layout === value && (
                  <span className="size-2 rounded-full bg-current" />
                )}
              </span>
              {value === 'json' ? 'JSON' : 'JSONL'}
            </Radio>
          ))}
        </RadioGroup>
      </div>
      <div className="flex flex-col gap-4">
        {formats.map((format) => (
          <section
            key={format}
            className="rounded-lg border border-[var(--separator)] p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3 className="m-0 text-[14px] font-semibold">
                {t(`result.advancedCopy.${format}.name`)}
              </h3>
              <Button
                size="sm"
                busy={copying === format}
                disabled={copying !== null}
                onClick={() => void copy(format)}
              >
                {t('result.dataMenu.copy')}
              </Button>
            </div>
            <p className="mb-1 mt-2 text-[12px]">
              {t(`result.advancedCopy.${format}.usage`)}
            </p>
            <p className="mb-2 mt-0 text-[12px] text-muted-foreground">
              {t(`result.advancedCopy.${format}.types`)}
            </p>
            <div className="mb-1 text-[11px] text-muted-foreground">
              {t('result.advancedCopy.example')}
            </div>
            <pre className="m-0 box-border h-[200px] overflow-auto rounded-md bg-[var(--surface-inset)] p-3 font-mono text-[11px] leading-relaxed">
              {layout === 'json'
                ? toEncodedJsonArray(examples.slice(0, 1), format)
                : toEncodedJsonLines(examples, format)}
            </pre>
          </section>
        ))}
      </div>
    </Modal>
  )
}
