import { useSyncExternalStore } from 'react'
import type { SearchVisit } from './types'

const KEY = 'amdm.quickSearch.visits'
const LIMIT = 50
let visits: SearchVisit[] = []
const listeners = new Set<() => void>()
let saveTimer: ReturnType<typeof setTimeout> | undefined

export function parseSearchVisits(value: string | null): SearchVisit[] {
  if (!value) return []
  const parsed: unknown = JSON.parse(value)
  if (!Array.isArray(parsed)) return []
  const ids = new Set<string>()
  return parsed
    .filter((item): item is SearchVisit => {
      if (
        !item ||
        typeof item.id !== 'string' ||
        typeof item.at !== 'number' ||
        !Number.isFinite(item.at) ||
        ids.has(item.id)
      )
        return false
      ids.add(item.id)
      return true
    })
    .sort((a, b) => b.at - a.at)
    .slice(0, LIMIT)
}

export function loadSearchVisits(): void {
  try {
    visits = parseSearchVisits(localStorage.getItem(KEY))
  } catch (error) {
    console.warn('Unable to restore quick search visits', error)
    visits = []
  }
}

export function recordSearchVisit(id: string, at = Date.now()): void {
  visits = [{ id, at }, ...visits.filter((visit) => visit.id !== id)].slice(0, LIMIT)
  for (const listener of listeners) listener()
  clearTimeout(saveTimer)
  saveTimer = setTimeout(flushSearchVisits, 100)
}

export function flushSearchVisits(): void {
  clearTimeout(saveTimer)
  saveTimer = undefined
  try {
    localStorage.setItem(KEY, JSON.stringify(visits))
  } catch (error) {
    console.warn('Unable to save quick search visits', error)
  }
}

export function useSearchVisits(): SearchVisit[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => visits
  )
}
