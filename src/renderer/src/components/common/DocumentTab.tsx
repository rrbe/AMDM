import type { ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '@renderer/lib/utils'

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
  tooltip?: string
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
  tooltip
}: DocumentTabProps): JSX.Element {
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
        <button
          className="document-tab-status document-tab-status-action"
          aria-label={statusAction.label}
          data-tip={statusAction.label}
          onClick={(event) => {
            event.stopPropagation()
            statusAction.onClick()
          }}
        >
          {status}
        </button>
      ) : (
        <span className="document-tab-status" aria-hidden>
          {status}
        </span>
      )}
      <span className="document-tab-label" data-tip={tooltip}>
        {label}
      </span>
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
    </div>
  )
}
