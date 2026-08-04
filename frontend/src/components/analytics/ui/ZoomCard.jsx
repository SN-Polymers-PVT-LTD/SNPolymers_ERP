import React from 'react';

export const ZoomCard = ({ children, onZoom, className = '' }) => (
  <div className={`relative group ${className}`}>
    {children}
    <button
      onClick={onZoom}
      className="absolute top-3 right-3 z-30 opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-widest transition-all duration-200 hover:bg-amber-500/20 hover:border-amber-500/40 cursor-zoom-in"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
      </svg>
      Zoom
    </button>
  </div>
);
