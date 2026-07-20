import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names, resolving Tailwind utility conflicts (last-wins).
 * shadcn convention — used by generated components in `components/base/*`
 * and our `components/ui/*` facades.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
