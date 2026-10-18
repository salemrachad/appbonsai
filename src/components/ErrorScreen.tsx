import React from 'react';

// The last line of defence: an error while rendering shows what broke instead of a blank page (e.g. a page
// still open from before a deploy, reading a server that has changed). Nothing is sent anywhere; reload tries again.
export class ErrorScreen extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[appbonsai] render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const reload = (clearHash: boolean) => {
      if (clearHash) history.replaceState(null, '', window.location.pathname + window.location.search);
      window.location.reload();
    };
    const button = 'sans text-xs font-semibold px-3 py-1.5 rounded-full border cursor-pointer';
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-[var(--paper)] text-[var(--ink)] px-4">
        <div className="max-w-xl w-full rounded-2xl border-2 border-[var(--line-strong)] bg-white/60 p-5 space-y-3">
          <div className="text-2xl">🌱</div>
          <h1 className="serif text-2xl font-semibold">Something broke while drawing the tree</h1>
          <p className="sans text-sm opacity-75">
            The real bonsai and its data are fine: this is only the screen. If the app was just updated, reloading the
            page usually fixes it.
          </p>
          <pre className="sans text-xs whitespace-pre-wrap break-words rounded-lg bg-[var(--tone-alert)]/10 text-[var(--tone-alert)] p-3">
            {error.name}: {error.message}
          </pre>
          {error.stack && (
            <details className="sans text-xs opacity-70">
              <summary className="cursor-pointer">Details</summary>
              <pre className="whitespace-pre-wrap break-words mt-2 max-h-60 overflow-auto">{error.stack}</pre>
            </details>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            <button id="error-reload-btn" onClick={() => reload(false)} className={`${button} bg-[var(--tone-good)] text-white border-transparent`}>
              Reload
            </button>
            {window.location.hash && (
              <button id="error-reload-clean-btn" onClick={() => reload(true)} className={`${button} border-[var(--line-strong)]`}>
                Reload without previews
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
