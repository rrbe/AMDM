import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { PreviewResource, ResourcePreviewSettings } from '@renderer/lib/resourcePreview'

export const ResourcePreviewContext = createContext<ResourcePreviewSettings | undefined>(undefined)

export function useResourcePreviewSettings(): ResourcePreviewSettings | undefined {
  return useContext(ResourcePreviewContext)
}

export function ResourcePreview({ resource }: { resource: PreviewResource }): React.JSX.Element {
  const { t } = useTranslation()
  const mediaRef = useRef<HTMLImageElement | HTMLMediaElement | null>(null)
  const timerRef = useRef<number | undefined>(undefined)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const { url, type } = resource

  useEffect(() => {
    const media = mediaRef.current!
    setStatus('loading')
    media.src = url
    timerRef.current = window.setTimeout(() => {
      setStatus('error')
      media.removeAttribute('src')
      if (media instanceof HTMLMediaElement) media.load()
    }, 10_000)
    return () => {
      window.clearTimeout(timerRef.current)
      media.removeAttribute('src')
      if (media instanceof HTMLMediaElement) media.load()
    }
  }, [url, type])

  const ready = (): void => {
    window.clearTimeout(timerRef.current)
    setStatus('ready')
  }
  const failed = (): void => {
    window.clearTimeout(timerRef.current)
    setStatus('error')
  }
  const className = `block ${type === 'audio' ? 'h-[54px] w-[300px]' : 'h-auto w-auto'} max-h-[min(320px,45vh)] max-w-[min(360px,calc(100vw-16px))] object-contain${status === 'ready' ? '' : ' invisible absolute'}`

  return (
    <div className={`relative flex items-center justify-center overflow-hidden rounded-sm text-foreground${status === 'ready' ? '' : ' h-[120px] w-[200px] bg-[var(--surface-elevated)]'}`} aria-busy={status === 'loading'}>
      {status === 'loading' && <Loader2 size={20} className="absolute animate-spin" aria-label={t('common.loading')} />}
      {status === 'error' && <span className="px-3 text-center font-sans text-xs">{t('result.resourcePreviewFailed')}</span>}
      {type === 'image' ? (
        <img
          ref={(node) => { mediaRef.current = node }}
          alt={t('result.resourcePreview')}
          referrerPolicy="no-referrer"
          decoding="async"
          className={className}
          onLoad={ready}
          onError={failed}
        />
      ) : type === 'video' ? (
        <video
          ref={(node) => { mediaRef.current = node }}
          aria-label={t('result.resourcePreview')}
          autoPlay muted loop playsInline controls preload="metadata"
          className={className}
          onLoadedData={ready}
          onError={failed}
        />
      ) : (
        <audio
          ref={(node) => { mediaRef.current = node }}
          aria-label={t('result.resourcePreview')}
          controls preload="metadata"
          className={className}
          onLoadedMetadata={ready}
          onError={failed}
        />
      )}
    </div>
  )
}
