import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import 'dayjs/locale/zh-cn'
import 'dayjs/locale/zh-tw'

dayjs.extend(relativeTime)

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function dayjsLocale(language?: string): string {
  const normalized = language?.toLowerCase()
  if (normalized === 'zh-tw' || normalized === 'zh-hk') return 'zh-tw'
  if (normalized?.startsWith('zh')) return 'zh-cn'
  return 'en'
}

/** Compact query timestamp: clock time for the first day, relative time after that. */
export function formatQueryTime(executedAt: number, language?: string, now = Date.now()): string {
  const time = dayjs(executedAt)
  if (!time.isValid()) return ''
  const localized = time.locale(dayjsLocale(language))
  return now - executedAt > ONE_DAY_MS ? localized.from(dayjs(now)) : localized.format('HH:mm')
}
