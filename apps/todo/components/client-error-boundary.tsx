"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ClientErrorBoundaryProps {
  children: ReactNode;
  title: string;
  description: string;
}

interface ClientErrorBoundaryState {
  hasError: boolean;
}

export default class ClientErrorBoundary extends Component<ClientErrorBoundaryProps, ClientErrorBoundaryState> {
  state: ClientErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ClientErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Client boundary error:", error, info);
  }

  private reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="m-4 rounded-xl border border-border bg-card p-5 text-center">
        <h2 className="text-base font-semibold text-foreground">{this.props.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{this.props.description}</p>
        <button
          type="button"
          onClick={this.reset}
          className="mt-4 inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Try again
        </button>
      </div>
    );
  }
}
