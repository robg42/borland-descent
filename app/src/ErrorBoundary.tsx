import { Component, type ReactNode, type ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Top-level error boundary around both the player and studio views. Shows a
 * minimal recover/reload UI rather than a blank screen when an uncaught React
 * error propagates from the engine or a component.
 */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[borland] uncaught render error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.2rem',
            padding: '2rem',
            background: '#04070a',
            color: '#9aa3a3',
            fontFamily: 'ui-monospace, monospace',
            fontSize: '0.8rem',
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, color: '#e9e6df' }}>Something went wrong.</p>
          <p style={{ margin: 0, opacity: 0.7, maxWidth: '28rem', lineHeight: 1.6 }}>
            {this.state.error.message}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '0.4rem',
              padding: '0.45rem 1.2rem',
              fontFamily: 'inherit',
              fontSize: '0.72rem',
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: '#79c7be',
              background: 'rgba(121, 199, 190, 0.08)',
              border: '1px solid rgba(233, 230, 223, 0.08)',
              borderRadius: '3px',
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
