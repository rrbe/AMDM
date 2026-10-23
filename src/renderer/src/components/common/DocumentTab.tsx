import type { MouseEvent, ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Tooltip, type TooltipContent, type TooltipVariant } from '@renderer/components/ui/Tooltip'

interface DocumentTabProps {
  active: boolean
  label: ReactNode
  closeLabel: string
  onSelect: () => void
  onClose: () => void
  onContextMenu?: (event: MouseEvent<HTMLDivElement>) => void
  contextMenuOpen?: boolean
  className?: string
  dataTabId?: string
  status?: ReactNode
  statusAction?: { label: string; onClick: () => void }
  tooltip?: TooltipContent
  tooltipFooter?: TooltipContent
  tooltipVariant?: TooltipVariant
  shortcut?: string
  showShortcutHint?: boolean
}

/** Shared Chrome-style document tab used by Query and Result strips. */
export function DocumentTab({
  active,
  label,
  closeLabel,
  onSelect,
  onClose,
  onContextMenu,
  contextMenuOpen,
  className,
  dataTabId,
  status,
  statusAction,
  tooltip,
  tooltipFooter,
  tooltipVariant,
  shortcut,
  showShortcutHint
}: DocumentTabProps): React.JSX.Element {
  return (
    <Tooltip
      content={tooltip ?? shortcut}
      delay={150}
      footer={
        tooltipFooter
          ? () => (
              <>
                {typeof tooltipFooter === 'function' ? tooltipFooter() : tooltipFooter}
                {shortcut && <span>{shortcut}</span>}
              </>
            )
          : tooltip
            ? shortcut
            : undefined
      }
      variant={tooltipVariant}
    >
      <div
        data-tab-id={dataTabId}
        className={cn('document-tab', active && 'active', contextMenuOpen && 'context-menu-open', className)}
        onClick={onSelect}
        onContextMenu={onContextMenu}
        onAuxClick={(event) => {
          if (event.button === 1) {
            event.preventDefault()
            onClose()
          }
        }}
      >
        {statusAction ? (
          <Tooltip content={statusAction.label}>
            <button
              className="document-tab-status document-tab-status-action"
              aria-label={statusAction.label}
              onClick={(event) => {
                event.stopPropagation()
                statusAction.onClick()
              }}
            >
              {status}
            </button>
          </Tooltip>
        ) : status ? (
          <span className="document-tab-status" aria-hidden>
            {status}
          </span>
        ) : null}
        <span className="document-tab-label">{label}</span>
        {!showShortcutHint || !shortcut ? (
          <button
            className="document-tab-close"
            aria-label={closeLabel}
            onClick={(event) => {
              event.stopPropagation()
              onClose()
            }}
          >
            <X size={12} />
          </button>
        ) : (
          <span className="document-tab-shortcut" data-shortcut={shortcut} aria-hidden="true">
            <span>{shortcut}</span>
          </span>
        )}
      </div>
    </Tooltip>
  )
}
