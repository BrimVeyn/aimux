import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

// A render crash in any component must never black-screen the whole app.
// This catches it and shows the error (and a reload hint) instead.
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Surface it in the devtools console for debugging.
    console.error("GUI render error:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (error !== null) {
      return (
        <div
          style={{
            backgroundColor: "#11151b",
            color: "#f38ba8",
            fontFamily: "ui-monospace, Menlo, monospace",
            fontSize: 13,
            height: "100vh",
            padding: 24,
            whiteSpace: "pre-wrap",
          }}
        >
          <div style={{ fontWeight: "bold", marginBottom: 8 }}>aimux GUI — render error</div>
          <div>{error.message}</div>
          <div style={{ color: "#8a97a9", marginTop: 12 }}>
            This is usually a host/frontend version mismatch. Restart the host:
            {"\n"}  lsof -ti tcp:7878 | xargs kill -9 ; bun run gui:dev
            {"\n"}then reload this page.
          </div>
          <button
            type="button"
            onClick={() => this.setState({ error: null })}
            style={{
              backgroundColor: "#1f2630",
              border: "1px solid #2a3340",
              borderRadius: 6,
              color: "#edf4ff",
              marginTop: 16,
              padding: "4px 12px",
            }}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
