import { createContext, useContext } from 'react'

/** Scope display preferences to a result, including previews rendered through portals. */
export const ResultTimeZoneContext = createContext<string | undefined>(undefined)

export function useResultTimeZone(): string | undefined {
  return useContext(ResultTimeZoneContext)
}
