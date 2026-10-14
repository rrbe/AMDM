import type { ReactNode } from 'react'

/** Reveal a primary-key shortcut over its label or icon without moving the control. */
export function ShortcutHint({ shortcut, children }: { shortcut?: string; children: ReactNode }): React.JSX.Element {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center whitespace-nowrap">
      <span className={shortcut ? 'inline-flex items-center [[data-shortcut-hints=primary]_&]:invisible' : 'inline-flex items-center'}>
        {children}
      </span>
      {shortcut && (
        <span
          aria-hidden="true"
          data-control-shortcut={shortcut}
          className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[18px] min-w-[18px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[5px] bg-[var(--surface-control)] px-0.5 font-sans text-[10px] font-semibold leading-none text-[var(--text-secondary)] [[data-shortcut-hints=primary]_&]:inline-flex"
        >
          {shortcut}
        </span>
      )}
    </span>
  )
}
