import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'
import { Tooltip, type TooltipContent, type TooltipVariant } from '@renderer/components/ui/Tooltip'

interface DocumentTabProps {
  active: boolean
  label: ReactNode
  closeLabel: string
  onSelect: () => void
  onClose: () => void
  className?: string
  dataTabId?: string
  status?: ReactNode
  statusAction?: { label: string; onClick: () => void }
  tooltip?: TooltipContent
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
  className,
  dataTabId,
  status,
  statusAction,
  tooltip,
  tooltipVariant,
  shortcut,
  showShortcutHint
}: DocumentTabProps): React.JSX.Element {
  return (
    <div
      data-tab-id={dataTabId}
      className={cn('document-tab', active && 'active', className)}
      onClick={onSelect}
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
      ) : (
        <span className="document-tab-status" aria-hidden>
          {status}
        </span>
      )}
      <Tooltip content={tooltip ?? shortcut} footer={tooltip ? shortcut : undefined} variant={tooltipVariant}>
        <span className="document-tab-label">{label}</span>
      </Tooltip>
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
          {shortcut}
        </span>
      )}
    </div>
  )
}
