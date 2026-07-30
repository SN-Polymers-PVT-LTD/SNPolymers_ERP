import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useTheme } from '../../ThemeContext';

export const ChartInfoTooltip = ({ description, formula }) => {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef(null);
  const { isDark } = useTheme();

  const updatePosition = () => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popW = 280;
    const popH = 140;

    let left = rect.right - popW;
    if (left < 16) left = 16;
    if (left + popW > window.innerWidth - 16) {
      left = Math.max(16, window.innerWidth - popW - 16);
    }

    let top = rect.bottom + 8;
    if (top + popH > window.innerHeight - 16) {
      top = Math.max(16, rect.top - popH - 8);
    }

    setPos({ x: left, y: top });
  };

  const handleOpen = () => {
    updatePosition();
    setShow(true);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onMouseEnter={handleOpen}
        onMouseLeave={() => setShow(false)}
        onClick={(e) => {
          e.stopPropagation();
          updatePosition();
          setShow(!show);
        }}
        className="w-5 h-5 rounded-full bg-amber-500/15 hover:bg-amber-500/35 border border-amber-500/50 flex items-center justify-center text-[11px] font-black text-amber-400 hover:text-amber-300 transition-all cursor-pointer shadow-md shadow-amber-500/10 hover:scale-110 shrink-0"
        title="Click or hover for chart details & formula"
      >
        i
      </button>

      {show && ReactDOM.createPortal(
        <div
          className="fixed z-[999999] p-3.5 rounded-2xl shadow-2xl min-w-[260px] max-w-[300px] text-xs backdrop-blur-xl pointer-events-none transition-all duration-150 border"
          style={{
            top: pos.y,
            left: pos.x,
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)',
            borderColor: isDark ? 'rgba(245, 158, 11, 0.5)' : 'rgba(245, 158, 11, 0.4)',
            boxShadow: '0 20px 40px -5px rgba(0,0,0,0.7), 0 8px 16px -6px rgba(245,158,11,0.2)'
          }}
        >
          <div className={`flex items-center gap-1.5 mb-2 border-b pb-1.5 text-amber-500 dark:text-amber-400 font-extrabold uppercase text-[10px] tracking-wider ${isDark ? 'border-white/10' : 'border-slate-200'}`}>
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 dark:bg-amber-400 animate-pulse" />
            Metric Info &amp; Formula
          </div>
          <p className="text-[11px] text-slate-700 dark:text-slate-200 leading-snug font-medium mb-2.5">
            {description}
          </p>
          <div className={`p-2.5 rounded-xl border font-mono text-[10px] font-semibold leading-relaxed ${isDark ? 'bg-slate-950/90 border-white/10 text-emerald-400' : 'bg-slate-100 border-slate-200 text-emerald-700'}`}>
            <span className="text-[9px] uppercase font-bold text-slate-500 dark:text-slate-400 block mb-0.5 font-sans">Formula:</span>
            {formula}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};
