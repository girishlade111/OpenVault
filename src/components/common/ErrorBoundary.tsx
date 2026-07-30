"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional label for the panel (shown in the error UI). */
  label?: string;
  /** Called when the user clicks "Reset". Defaults to reloading the page. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Generic React error boundary. Catches render errors in child components
 * and shows a friendly fallback UI with a "Reset" button. Prevents one
 * crashing panel from taking down the entire app.
 *
 * Must be a class component (React limitation for componentDidCatch).
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console for debugging (in production this could go to a reporting service)
    console.error(
      `[ErrorBoundary${this.props.label ? `: ${this.props.label}` : ""}]`,
      error,
      info.componentStack
    );
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full flex flex-col items-center justify-center p-8 text-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-destructive/10 flex items-center justify-center">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium text-foreground">
              Something went wrong
            </h3>
            {this.props.label && (
              <p className="text-xs text-muted-foreground">
                The {this.props.label} encountered an error.
              </p>
            )}
            <p className="text-xs text-muted-foreground max-w-sm">
              {this.state.error?.message ?? "An unexpected error occurred."}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={this.handleReset}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            Reset
          </Button>
        </div>
      );
    }

    return this.props.children;
  }
}
