import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from '@renderer/components/common/Button'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
  info: string
}

/**
 * Catches render-time errors so a single broken component shows a readable
 * message instead of unmounting the whole app to a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: '' }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Also goes to the renderer console (forwarded to the terminal in dev).
    console.error('[ErrorBoundary]', error, info.componentStack)
    this.setState({ info: info.componentStack ?? '' })
  }

  render(): ReactNode {
    const { error, info } = this.state
    if (!error) return this.props.children
    return (
      <div className="fatal-error">
        <h2>Something crashed while rendering</h2>
        <pre className="fatal-msg">{error.message}</pre>
        {error.stack && <pre className="fatal-stack">{error.stack}</pre>}
        {info && <pre className="fatal-stack">{info}</pre>}
        <Button variant="primary" onClick={() => this.setState({ error: null, info: '' })}>
          Try again
        </Button>
      </div>
    )
  }
}
