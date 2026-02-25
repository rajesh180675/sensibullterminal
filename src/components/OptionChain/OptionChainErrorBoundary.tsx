// components/OptionChain/OptionChainErrorBoundary.tsx

import React, { Component, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class OptionChainErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[OptionChain] Render error:', error, info.componentStack);
  }

  handleReset = (): void => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-full bg-[#13161f] text-gray-400 gap-4 p-8" role="alert">
          <AlertCircle size={40} className="text-red-500" />
          <h3 className="text-sm font-semibold text-red-400">Option Chain Error</h3>
          <p className="text-xs text-gray-600 text-center max-w-md">
            {this.state.error?.message ?? 'An unexpected error occurred.'}
          </p>
          <button onClick={this.handleReset}
            className="px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-xs rounded-lg font-medium
              transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
