import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function ImagePreview({ url }: { url: string }): React.JSX.Element {
  const { t } = useTranslation()
  const imageRef = useRef<HTMLImageElement>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    const image = imageRef.current!
    setStatus('loading')
    image.src = url
    const timer = window.setTimeout(() => {
      if (image.complete && image.naturalWidth > 0) return
      setStatus('error')
      image.removeAttribute('src')
    }, 10_000)
    return () => {
      window.clearTimeout(timer)
      image.removeAttribute('src')
    }
  }, [url])

  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-sm text-foreground${status === 'ready' ? '' : ' h-[120px] w-[200px] bg-[var(--surface-elevated)]'}`} aria-busy={status === 'loading'}>
      {status === 'loading' && <Loader2 size={20} className="absolute animate-spin" aria-label={t('common.loading')} />}
      {status === 'error' && <span className="px-3 text-center font-sans text-xs">{t('result.imagePreviewFailed')}</span>}
      <img
        ref={imageRef}
        alt={t('result.imagePreview')}
        referrerPolicy="no-referrer"
        decoding="async"
        className={`block h-auto w-auto max-h-[min(320px,45vh)] max-w-[min(360px,calc(100vw-16px))] object-contain${status === 'ready' ? '' : ' invisible absolute'}`}
        onLoad={() => setStatus('ready')}
        onError={() => setStatus('error')}
      />
    </div>
  )
}
