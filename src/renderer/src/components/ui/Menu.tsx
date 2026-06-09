import { useMemo, type ReactNode } from 'react'
import { Menu as BaseMenu } from '@base-ui/react/menu'

/**
 * Thin wrapper over Base UI Menu — a cursor-anchored, data-driven menu. Backs the
 * app's right-click `ContextMenu`. Controlled (`open` + `onClose`) and positioned
 * via a virtual anchor at `{x, y}`, so no `Menu.Trigger` is needed. Base UI gives
 * keyboard nav, outside-press / Esc dismissal, and focus management for free.
 *
 * Reuses the existing `.ctx-menu` / `.ctx-item` / `.ctx-sep` styles; disabled and
 * highlighted states key off the `data-disabled` / `data-highlighted` attributes
 * Base UI sets (see styles.css).
 */
export interface MenuItemDef {
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  /** Greyed-out + unclickable. */
  disabled?: boolean
  /** Right-aligned shortcut hint, e.g. '⌘↵' — display only. */
  shortcut?: string
}

/** A divider between groups of items. */
export type MenuEntry = MenuItemDef | 'separator'

interface MenuProps {
  open: boolean
  onClose: () => void
  x: number
  y: number
  items: MenuEntry[]
}

export function Menu({ open, onClose, x, y, items }: MenuProps): JSX.Element {
  // Virtual anchor: a zero-size rect at the cursor. Memoised so Base UI's
  // positioner isn't re-anchored on every render.
  const anchor = useMemo(
    () => ({ getBoundingClientRect: (): DOMRect => new DOMRect(x, y, 0, 0) }),
    [x, y]
  )

  return (
    <BaseMenu.Root
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose()
      }}
    >
      <BaseMenu.Portal>
        <BaseMenu.Positioner
          className="ui-menu-positioner"
          anchor={anchor}
          side="bottom"
          align="start"
          sideOffset={2}
        >
          <BaseMenu.Popup className="ctx-menu ui-menu-popup">
            {items.map((it, i) =>
              it === 'separator' ? (
                <div key={i} className="ctx-sep" role="separator" />
              ) : (
                <BaseMenu.Item
                  key={i}
                  className={it.danger ? 'ctx-item danger' : 'ctx-item'}
                  disabled={it.disabled}
                  onClick={() => it.onClick()}
                >
                  {it.icon != null && <span className="ctx-icon">{it.icon}</span>}
                  <span className="ctx-label">{it.label}</span>
                  {it.shortcut != null && <span className="ctx-shortcut">{it.shortcut}</span>}
                </BaseMenu.Item>
              )
            )}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  )
}
