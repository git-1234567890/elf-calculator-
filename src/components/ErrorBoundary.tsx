import React from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, errorMessage: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error.message || "Unexpected application error.",
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-900 dark:border-red-800/80 dark:bg-red-950/50 dark:text-red-200">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" />
            Leaderboard View Error
          </div>
          <p className="mt-2 font-mono text-xs break-all">
            {this.state.errorMessage}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMessage: "" })}
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-red-300 bg-white px-3.5 py-2 text-xs font-medium text-red-900 hover:bg-red-100 dark:border-red-700 dark:bg-slate-900 dark:text-red-200 dark:hover:bg-red-900/40"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
