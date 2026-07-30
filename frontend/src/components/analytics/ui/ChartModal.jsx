import React, { useEffect } from 'react';
import ReactDOM from 'react-dom';
import { useTheme } from '../../ThemeContext';
import { ChartInfoTooltip } from './ChartInfoTooltip';

export const ChartModal = ({ title, description, formula, isDark, width = '96vw', height = '92vh', maxWidth = '1600px', maxHeight = '1000px', onClose, children }) => {
  const { isDark: themeDark } = useTheme();
  const dark = isDark !== undefined ? isDark : themeDark;

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (typeof document !== 'undefined') {
    return ReactDOM.createPortal(
      <div
        className="fixed inset-0 z-[99999] flex items-center justify-center p-2 sm:p-4 animate-in fade-in duration-200"
        style={{
          background: dark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)',
          backdropFilter: 'blur(16px)'
        }}
        onClick={onClose}
      >
        <div
          className={`relative flex flex-col overflow-hidden rounded-3xl border transition-all duration-300 shadow-2xl ${dark ? 'bg-[#0b0e14] border-white/10 text-slate-100 shadow-black/90' : 'bg-white border-slate-200 text-slate-900 shadow-2xl'}`}
          style={{ width, height, maxWidth, maxHeight }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Modal Header */}
          <div
            className={`flex items-center justify-between px-6 py-4 border-b shrink-0 gap-4 ${
              dark ? 'border-white/10 bg-[#0f172a]' : 'border-slate-100 bg-slate-50'
            }`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 pl-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_#f59e0b] shrink-0" />
              <h3
                className={`text-xs sm:text-sm font-extrabold uppercase tracking-widest font-mono truncate ${
                  dark ? 'text-amber-400' : 'text-amber-600'
                }`}
              >
                {title || 'Chart Telemetry Inspection'}
              </h3>
              {description && formula && (
                <ChartInfoTooltip description={description} formula={formula} />
              )}
            </div>

            {/* Red Close Button */}
            <button
              onClick={onClose}
              className="shrink-0 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all duration-300 shadow-md cursor-pointer flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider"
              title="Close (ESC)"
            >
              <span>Close</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Dynamically Scaled Inner Content Area */}
          <div className="flex-1 min-h-0 h-full w-full flex flex-col justify-between overflow-hidden p-3 sm:p-5">
            {children}
          </div>
        </div>
      </div>,
      document.body
    );
  }
  return null;
};
