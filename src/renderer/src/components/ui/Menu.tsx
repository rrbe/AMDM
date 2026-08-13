import { useMemo, type ReactNode } from 'react'
import { ContextMenu as BaseContextMenu } from '@base-ui/react/context-menu'
import { Menu as BaseMenu } from '@base-ui/react/menu'

/**
 * Thin wrapper over Base UI Menu — a cursor-anchored, data-driven menu. Backs the
 * app's right-click `ContextMenu`. Controlled (`open` + `onClose`) and positioned
 * via a virtual anchor at `{x, y}`, so no `Menu.Trigger` is needed. Base UI gives
 * keyboard nav, outside-press / Esc dismissal, and focus management for free.
 *
 * Reuses the existing `.ctx-menu` / `.ctx-item` / `.ctx-sep` styles; disabled and
 * highlighted states key off the `data-disabled` / `data-highlighted` attributes
 * Base UI sets (see styles/base-ui.css).
 */
interface MenuItemBase {
  label: string
  icon?: ReactNode
  /** Greyed-out + unclickable. */
  disabled?: boolean
}

export interface MenuActionDef extends MenuItemBase {
  onClick: () => void
  danger?: boolean
  /** Right-aligned shortcut hint, e.g. '⌘↵' — display only. */
  shortcut?: string
}

export interface MenuSubmenuDef extends MenuItemBase {
  children: MenuEntry[]
}

export type MenuItemDef = MenuActionDef | MenuSubmenuDef

/** A divider between groups of items. */
export type MenuEntry = MenuItemDef | 'separator'

interface MenuProps {
  open: boolean
  onClose: () => void
  x: number
  y: number
  items: MenuEntry[]
}

function MenuEntries({ items }: { items: MenuEntry[] }): React.JSX.Element {
  return (
    <>
      {items.map((item, index) => {
        if (item === 'separator') {
          return <div key={index} className="ctx-sep" role="separator" />
        }
        if ('children' in item) {
          return (
            <BaseMenu.SubmenuRoot key={index}>
              <BaseMenu.SubmenuTrigger className="ctx-item" disabled={item.disabled} openOnHover>
                {item.icon != null && <span className="ctx-icon">{item.icon}</span>}
                <span className="ctx-label">{item.label}</span>
                <span className="ctx-submenu-arrow" aria-hidden="true">
                  ›
                </span>
              </BaseMenu.SubmenuTrigger>
              <BaseMenu.Portal>
                <BaseMenu.Positioner
                  className="ui-menu-positioner"
                  side="right"
                  align="start"
                  sideOffset={5}
                  alignOffset={-4}
                >
                  <BaseMenu.Popup className="ctx-menu ui-menu-popup">
                    <MenuEntries items={item.children} />
                  </BaseMenu.Popup>
                </BaseMenu.Positioner>
              </BaseMenu.Portal>
            </BaseMenu.SubmenuRoot>
          )
        }
        return (
          <BaseMenu.Item
            key={index}
            className={item.danger ? 'ctx-item danger' : 'ctx-item'}
            disabled={item.disabled}
            onClick={() => item.onClick()}
          >
            {item.icon != null && <span className="ctx-icon">{item.icon}</span>}
            <span className="ctx-label">{item.label}</span>
            {item.shortcut != null && <span className="ctx-shortcut">{item.shortcut}</span>}
          </BaseMenu.Item>
        )
      })}
    </>
  )
}

export function Menu({ open, onClose, x, y, items }: MenuProps): React.JSX.Element {
  // Virtual anchor: a zero-size rect at the cursor. Memoised so Base UI's
  // positioner isn't re-anchored on every render.
  const anchor = useMemo(
    () => ({ getBoundingClientRect: (): DOMRect => new DOMRect(x, y, 0, 0) }),
    [x, y]
  )

  return (
    <BaseContextMenu.Root
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
            <MenuEntries items={items} />
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseContextMenu.Root>
  )
}
