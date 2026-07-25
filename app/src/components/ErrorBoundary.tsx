import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/** Catches render errors anywhere below and shows a recoverable screen instead of
 *  a blank white page. Logs a structured, privacy-safe record (no coordinates,
 *  tokens, or photo URLs) — a Sentry/OpenTelemetry sink can hook in here later. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[aon:error-boundary]', {
      message: error.message,
      component: info.componentStack?.split('\n')[1]?.trim(),
    });
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="center-screen">
          <div style={{ maxWidth: 420, textAlign: 'center', padding: '0 20px' }}>
            <h2>Something went wrong</h2>
            <p style={{ color: 'var(--muted)' }}>
              The app hit an unexpected error. Reloading usually fixes it.
            </p>
            <button className="primary" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
