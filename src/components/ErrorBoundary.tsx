import { Component, type ReactNode } from "react";
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="error-page">
          <h1>Workspace needs a reload</h1>
          <p>
            The page could not be displayed. No transaction has been assumed
            successful. Reloading does not revoke existing permissions or cancel
            pending transactions.
          </p>
          <button
            className="button button-primary"
            onClick={() => location.reload()}
          >
            Reload workspace
          </button>
          <a
            href="https://shannon-explorer.somnia.network"
            target="_blank"
            rel="noreferrer"
          >
            Check the testnet explorer
          </a>
        </main>
      );
    return this.props.children;
  }
}
