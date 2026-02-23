import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}>
          <h2 style={{ color: '#ef4444', marginBottom: 8 }}>Runtime error</h2>
          <pre style={{ whiteSpace: 'pre-wrap', color: '#fca5a5' }}>{String(this.state.error.message || this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
