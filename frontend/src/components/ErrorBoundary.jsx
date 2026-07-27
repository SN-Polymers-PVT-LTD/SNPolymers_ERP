import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
    const msg = error?.message || String(error);
    if (msg.includes('Failed to fetch') || msg.includes('module script') || msg.includes('text/html') || msg.includes('Importing a module script failed')) {
      const lastReload = sessionStorage.getItem('last_chunk_reload');
      const now = Date.now();
      if (!lastReload || now - Number(lastReload) > 10000) {
        sessionStorage.setItem('last_chunk_reload', String(now));
        window.location.reload();
      }
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[400px] w-full flex flex-col items-center justify-center p-8 text-center bg-slate-950/40 rounded-3xl border border-white/10 backdrop-blur-md">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center text-xl font-bold mb-4">
            ⚠️
          </div>
          <h2 className="text-base font-bold uppercase tracking-wider text-slate-100 mb-2">
            Temporary Loading Issue
          </h2>
          <p className="text-xs text-slate-400 max-w-md mb-3 leading-relaxed">
            The page encountered a temporary synchronization glitch during navigation.
          </p>
          {this.state.error && (
            <div className="mb-6 p-3 rounded-xl bg-rose-950/50 border border-rose-500/30 text-rose-300 font-mono text-[11px] max-w-xl text-left overflow-auto max-h-32">
              <span className="font-bold uppercase text-rose-400 block mb-1">Diagnostic Detail:</span>
              {this.state.error.message || String(this.state.error)}
            </div>
          )}
          <button
            onClick={this.handleReset}
            className="px-6 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-black uppercase tracking-wider shadow-lg shadow-amber-500/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          >
            Reload Module
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
