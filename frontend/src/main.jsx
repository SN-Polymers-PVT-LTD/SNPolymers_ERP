import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

// Handle stale chunk loading errors gracefully on new Vercel deployments
const handleChunkError = (msg) => {
  if (msg && (msg.includes('Failed to fetch') || msg.includes('module script') || msg.includes('text/html') || msg.includes('Importing a module script failed'))) {
    const lastReload = sessionStorage.getItem('last_chunk_reload');
    const now = Date.now();
    if (!lastReload || now - Number(lastReload) > 10000) {
      sessionStorage.setItem('last_chunk_reload', String(now));
      window.location.reload();
    }
  }
};

window.addEventListener('error', (e) => handleChunkError(e?.message));
window.addEventListener('unhandledrejection', (e) => handleChunkError(e?.reason?.message || String(e?.reason)));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
