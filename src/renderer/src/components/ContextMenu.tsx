import { Menu, type MenuEntry, type MenuItemDef } from '@renderer/components/ui/Menu'

/**
 * The app's right-click menu. Public API unchanged (openers own the
 * `{x, y, items}` state and conditionally mount this, so mount = open);
 * internally now backed by Base UI via `ui/Menu`, which adds keyboard nav,
 * outside-press / Esc dismissal, and focus management.
 *
 * The item types are re-exported aliases of `ui/Menu`'s — structurally identical
 * to the old ones, so the ~7 consumers need no changes.
 */
export type ContextMenuItem = MenuItemDef
export type ContextMenuEntry = MenuEntry

export function ContextMenu({
  x,
  y,
  items,
  onClose
}: {
  x: number
  y: number
  items: ContextMenuEntry[]
  onClose: () => void
}): JSX.Element {
  return <Menu open onClose={onClose} x={x} y={y} items={items} />
}
