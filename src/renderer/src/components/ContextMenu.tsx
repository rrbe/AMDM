import { useEffect, type ReactNode } from 'react'

export interface ContextMenuItem {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
}

/**
 * A lightweight right-click menu, positioned at the cursor. A full-viewport
 * backdrop captures any outside click / right-click (and Escape) to dismiss.
 * Stateless: the opener owns the {x, y, items} and clears it via onClose.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuItem[]
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Keep the menu inside the viewport when opened near an edge.
  const MENU_W = 220
  const left = Math.min(x, window.innerWidth - MENU_W - 8)
  const top = Math.min(y, window.innerHeight - items.length * 34 - 8)

  return (
    <div
      className="ctx-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault()
        onClose()
      }}
    >
      <div
        className="ctx-menu"
        style={{ left, top, minWidth: MENU_W }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) => (
          <button
            key={i}
            className={it.danger ? 'ctx-item danger' : 'ctx-item'}
            onClick={() => {
              it.onClick()
              onClose()
            }}
          >
            {it.icon && <span className="ctx-icon">{it.icon}</span>}
            <span>{it.label}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
