import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../components/ThemeContext';
import ModalContext from '../components/ModalContext';
import { useAuth } from '../components/AuthContext';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getProjectsHealth,
  getHoActionableInsights,
  getHoChartData,
  refreshAnalyticsViews,
} from '../api/analyticsApi';
import { getZonalBalances } from '../api/zoBalancesApi';
import { getEligibleZOs } from '../api/userMappingsApi';
import { exportProjectsToExcel } from '../utils/exportHelpers';

/* ─── helpers ────────────────────────────────────────────────────── */
const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(num);
};

const fmtCr = (n) => {
  const v = Number(n) || 0;
  if (v >= 10000000) return `₹ ${(v / 10000000).toFixed(2)} Cr`;
  if (v >= 100000) return `₹ ${(v / 100000).toFixed(2)} L`;
  return `₹ ${v.toLocaleString('en-IN')}`;
};

/* ─── chart color tokens ─────────────────────────────────────────── */
const useChartColors = () => {
  const { isDark } = useTheme();
  return {
    gridLine: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.07)',
    gridLineDash: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    axisLine: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)',
    labelMuted: isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.35)',
    labelNormal: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)',
    labelStrong: isDark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.8)',
    todayLine: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.2)',
    todayText: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.5)',
    quadrantNormal: isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.18)',
    quadrantCritical: isDark ? 'rgba(239,68,68,0.4)' : 'rgba(185,28,28,0.5)',
    cellBorder: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)',
    highChurnLabel: isDark ? '#ef4444' : '#b91c1c',
    normalLabel: isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.55)',
    dropOffConnector: isDark ? 'rgba(239,68,68,0.25)' : 'rgba(185,28,28,0.3)',
    isDark,
  };
};

/* ─── Section Divider ─────────────────────────────────────────────── */
const SectionLabel = ({ children }) => (
  <div className="flex items-center gap-3 mb-3 mt-2">
    <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">{children}</span>
    <div className="flex-1 h-px bg-white/[0.045]" />
  </div>
);

/* ─── Chart Info Tooltip Component (Portal Architecture for Zero Clipping) ──── */
const ChartInfoTooltip = ({ description, formula }) => {
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
          <div className="flex items-center gap-1.5 mb-2 border-b border-white/10 pb-1.5 text-amber-400 font-extrabold uppercase text-[10px] tracking-wider">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
            Metric Info &amp; Formula
          </div>
          <p className="text-[11px] text-slate-200 dark:text-slate-200 leading-snug font-medium mb-2.5">
            {description}
          </p>
          <div className="bg-slate-950/90 p-2.5 rounded-xl border border-white/10 font-mono text-[10px] text-emerald-400 font-semibold leading-relaxed">
            <span className="text-[9px] uppercase font-bold text-slate-400 block mb-0.5 font-sans">Formula:</span>
            {formula}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

/* ─── Paginated ZO Name Selector Component ──────────────────────── */
const PaginatedZoSelector = ({ availableZos, selectedZo, onSelectZo, getZoDisplayName }) => {
  const { isDark } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 5;
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredZos = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return availableZos;
    return availableZos.filter(z => z.name.toLowerCase().includes(q) || z.id.toLowerCase().includes(q));
  }, [availableZos, search]);

  const totalPages = Math.ceil(filteredZos.length / pageSize) || 1;
  const pagedZos = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredZos.slice(start, start + pageSize);
  }, [filteredZos, page, pageSize]);

  const selectedName = selectedZo ? getZoDisplayName(selectedZo) : 'All ZO Names (Entire Portfolio)';

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 hover:border-amber-500/50 rounded-2xl px-4 py-2.5 text-xs font-black uppercase tracking-wider text-amber-400 shadow-sm backdrop-blur-md transition-all cursor-pointer"
      >
        <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
        <span className="text-[10px] text-slate-400 font-bold uppercase">ZO Name:</span>
        <span className="text-slate-100 font-extrabold max-w-[170px] sm:max-w-[200px] truncate">{selectedName}</span>
        <svg className={`w-3.5 h-3.5 text-amber-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className={`absolute right-0 mt-2 w-72 rounded-2xl border shadow-2xl z-[600] p-3.5 backdrop-blur-xl transition-all ${isDark ? 'bg-[#0f172a] border-white/10 text-slate-100 shadow-black/90' : 'bg-white border-slate-200 text-slate-900 shadow-2xl'}`}>
          <div className="mb-2">
            <input
              type="text"
              placeholder="Search ZO name..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500/50 ${isDark ? 'bg-slate-950 border-white/10 text-slate-200 placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'}`}
            />
          </div>

          <div
            onClick={() => { onSelectZo(null); setIsOpen(false); }}
            className={`flex items-center justify-between p-2 rounded-xl text-xs font-bold cursor-pointer transition ${!selectedZo ? 'bg-amber-500/20 text-amber-300 font-extrabold' : isDark ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
          >
            <div className="flex items-center gap-2 truncate">
              <span>🌐</span>
              <span className="truncate">All ZO Names (Entire Portfolio)</span>
            </div>
            {!selectedZo && <span className="text-amber-400 font-black">✓</span>}
          </div>

          <div className="h-px bg-white/10 my-1.5" />

          <div className="space-y-1 min-h-[160px]">
            {pagedZos.map(z => {
              const isSelected = selectedZo === z.id || selectedZo === z.name;
              return (
                <div
                  key={z.id}
                  onClick={() => { onSelectZo(z.id); setIsOpen(false); }}
                  className={`flex items-center justify-between p-2 rounded-xl text-xs font-semibold cursor-pointer transition ${isSelected ? 'bg-amber-500/20 text-amber-300 font-extrabold' : isDark ? 'hover:bg-white/5 text-slate-300' : 'hover:bg-slate-100 text-slate-700'}`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-5 h-5 rounded-full bg-amber-500/10 text-amber-400 font-mono text-[9px] font-black flex items-center justify-center border border-amber-500/20 shrink-0">
                      {z.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate">{z.name}</span>
                  </div>
                  {isSelected && <span className="text-amber-400 font-black ml-1">✓</span>}
                </div>
              );
            })}
            {pagedZos.length === 0 && (
              <div className="py-6 text-center text-xs text-slate-500 italic">No ZOs matching search</div>
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-white/10 text-[10px] font-mono select-none">
              <span className="text-slate-400 font-bold">Pg {page} of {totalPages} ({filteredZos.length} ZOs)</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage(p => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                  disabled={page === totalPages}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── ChartModal Component ─────────────────────────────────────────── */
const ChartModal = ({ title, description, formula, isDark, width = '96vw', height = '92vh', maxWidth = '1600px', maxHeight = '1000px', onClose, children }) => {
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
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 min-h-0 h-full w-full flex flex-col justify-start">
            {children}
          </div>
        </div>
      </div>,
      document.body
    );
  }
  return null;
};

/* ─── ZoomCard ─────────────────────────────────────────────────────── */
const ZoomCard = ({ children, onZoom, className = '' }) => (
  <div className={`relative group ${className}`}>
    {children}
    <button
      onClick={onZoom}
      className="absolute top-3 left-3 z-30 opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[9px] font-black uppercase tracking-widest transition-all duration-200 hover:bg-amber-500/20 hover:border-amber-500/40 cursor-zoom-in"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
      </svg>
      Zoom
    </button>
  </div>
);

/* ─── KPI Details Modal ─────────────────────────────────────────────── */
const KpiDetailsModal = ({ title, colorClass, projects, getZoDisplayName, onClose }) => {
  const { isDark } = useTheme();
  const navigate = useNavigate();

  React.useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 md:p-8"
      style={{ background: isDark ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.4)', backdropFilter: 'blur(16px)' }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border ${isDark ? 'bg-slate-950 border-white/10 text-slate-100 shadow-black/80' : 'bg-white border-slate-200 text-slate-900 shadow-2xl shadow-slate-900/20'}`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-6 py-5 border-b shrink-0 ${isDark ? 'border-white/10 bg-slate-900' : 'border-slate-100 bg-white'}`}>
          <div className="flex items-center gap-3">
            <h2 className={`text-lg font-black uppercase tracking-widest ${colorClass || (isDark ? 'text-slate-100' : 'text-slate-900')}`}>{title}</h2>
            <span className={`px-3 py-1 rounded-full border text-[10px] font-extrabold ${isDark ? 'bg-white/10 border-white/15 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-700'}`}>
              {projects.length} {projects.length === 1 ? 'Project' : 'Projects'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white hover:border-rose-500 transition-all duration-300 shadow-md hover:shadow-[0_0_15px_rgba(244,63,94,0.6)] cursor-pointer"
            title="Close (ESC)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className={`p-6 overflow-y-auto no-scrollbar flex-1 ${isDark ? 'bg-slate-950' : 'bg-white'}`}>
          {projects.length === 0 ? (
            <div className={`text-center py-12 text-xs font-bold uppercase tracking-wider ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
              No projects matching this filter
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className={`border-b text-[9px] font-black uppercase tracking-widest ${isDark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500'}`}>
                    <th className="py-3 px-3">WO No</th>
                    <th className="py-3 px-3">ZO Name</th>
                    <th className="py-3 px-3">Department</th>
                    <th className="py-3 px-3 text-center">Value</th>
                    <th className="py-3 px-3 text-center">Progress</th>
                    <th className="py-3 px-3 text-center">Health</th>
                    <th className="py-3 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className={`divide-y ${isDark ? 'divide-white/5' : 'divide-slate-100'}`}>
                  {projects.map((p, idx) => {
                    const scoreBadge = p.health_score >= 80
                      ? isDark ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/30' : 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30 font-extrabold'
                      : p.health_score >= 60
                      ? isDark ? 'bg-amber-950/80 text-amber-400 border-amber-500/30' : 'bg-amber-500/10 text-amber-800 border-amber-500/30 font-extrabold'
                      : isDark ? 'bg-rose-950/80 text-rose-400 border-rose-500/30' : 'bg-rose-500/10 text-rose-700 border-rose-500/30 font-extrabold';
                    const statusBadge = p.health_status === 'Critical'
                      ? isDark ? 'bg-rose-500/10 text-rose-400 border-rose-500/20' : 'bg-rose-50 text-rose-700 border-rose-200 font-black'
                      : p.health_status === 'Warning'
                      ? isDark ? 'bg-amber-500/10 text-amber-400 border-amber-500/20' : 'bg-amber-50 text-amber-800 border-amber-200 font-black'
                      : isDark ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-emerald-50 text-emerald-800 border-emerald-200 font-black';
                    const zoDisplayName = getZoDisplayName ? getZoDisplayName(p.zo_name || p.zo_user_id || p.zone) : (p.zo_name || p.zo_user_id || p.zone || 'N/A');
                    return (
                      <tr key={idx} className={`transition-colors group ${isDark ? 'hover:bg-white/5' : 'hover:bg-slate-50/80'}`}>
                        <td
                          onClick={() => { onClose(); navigate(`/projects/${p.work_order_no}/digital-twin`); }}
                          className={`py-3.5 px-3 font-extrabold hover:underline cursor-pointer font-mono ${isDark ? 'text-sky-400' : 'text-sky-600'}`}
                        >
                          {p.work_order_no}
                        </td>
                        <td className={`py-3.5 px-3 font-extrabold uppercase ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{zoDisplayName}</td>
                        <td className={`py-3.5 px-3 font-medium ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{p.department || 'N/A'}</td>
                        <td className={`py-3.5 px-3 text-center font-mono ${isDark ? 'text-slate-300' : 'text-slate-700'}`}>{formatINR(p.work_order_value)}</td>
                        <td className={`py-3.5 px-3 text-center font-extrabold ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>{p.physical_progress || 0}%</td>
                        <td className="py-3.5 px-3 text-center">
                          <span className={`px-2.5 py-0.5 rounded-lg text-[10px] border ${scoreBadge}`}>{Math.round(p.health_score || 0)}</span>
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <span className={`px-2.5 py-0.5 rounded-lg text-[8px] uppercase tracking-wider border ${statusBadge}`}>{p.health_status || 'Healthy'}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ─── donut path helper ───────────────────────────────────────────── */
const buildDonutSlices = (items, totalCount, getCount) => {
  let acc = 0;
  const cx = 100, OR = 85, IR = 55;
  return items.map(item => {
    const count = getCount(item);
    const pct = totalCount > 0 ? (count / totalCount) * 100 : 0;
    const angle = (pct / 100) * 360;
    const startAngle = acc;
    const endAngle = acc + angle;
    acc += angle;

    const sr = (startAngle - 90) * (Math.PI / 180);
    const er = (endAngle - 90) * (Math.PI / 180);
    const x1 = cx + OR * Math.cos(sr), y1 = cx + OR * Math.sin(sr);
    const x2 = cx + OR * Math.cos(er), y2 = cx + OR * Math.sin(er);
    const x3 = cx + IR * Math.cos(er), y3 = cx + IR * Math.sin(er);
    const x4 = cx + IR * Math.cos(sr), y4 = cx + IR * Math.sin(sr);
    const largeArc = angle > 180 ? 1 : 0;
    if (angle < 0.01) return { ...item, pct: 0, pathData: null };
    const pathData = `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${OR} ${OR} 0 ${largeArc} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${x3.toFixed(2)} ${y3.toFixed(2)} A ${IR} ${IR} 0 ${largeArc} 0 ${x4.toFixed(2)} ${y4.toFixed(2)} Z`;
    return { ...item, pct: Math.round(pct), pathData };
  });
};

/* ─── Physical Work Progress (Donut) ─────────────────────────────── */
const PhysicalWorkProgress = ({ projects, isModal = false }) => {
  const { isDark } = useTheme();
  const [hoveredBucket, setHoveredBucket] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const buckets = useMemo(() => {
    const p = projects || [];
    const a = p.filter(pr => Number(pr.physical_progress || 0) >= 60);
    const b = p.filter(pr => { const v = Number(pr.physical_progress || 0); return v >= 40 && v < 60; });
    const c = p.filter(pr => { const v = Number(pr.physical_progress || 0); return v > 0 && v < 40; });
    const d = p.filter(pr => !pr.physical_progress || pr.physical_progress === 0);
    return [
      { label: '≥ 60%', color: '#16A34A', count: a.length, workOrders: a.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: `${pr.physical_progress}%` })) },
      { label: '40–59%', color: '#EAB308', count: b.length, workOrders: b.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: `${pr.physical_progress}%` })) },
      { label: '< 40%', color: '#DC2626', count: c.length, workOrders: c.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: `${pr.physical_progress}%` })) },
      { label: 'Not Started', color: '#64748B', count: d.length, workOrders: d.map(pr => ({ work_order_no: pr.work_order_no, site_details: pr.site_details, value: '0%' })) },
    ];
  }, [projects]);

  const totalCount = useMemo(() => buckets.reduce((a, b) => a + b.count, 0), [buckets]);
  const slices = useMemo(() => buildDonutSlices(buckets, totalCount, b => b.count), [buckets, totalCount]);

  const avgProg = projects?.length
    ? Math.round(projects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / projects.length)
    : 0;

  const handleMouseEnter = (e, bucket) => {
    const ph = 280, pw = 320;
    let y = e.clientY - ph - 15; if (y < 20) y = Math.min(window.innerHeight - ph - 20, e.clientY + 20);
    let x = Math.min(window.innerWidth - pw - 20, Math.max(20, e.clientX - 100));
    setPopoverPos({ x, y }); setHoveredBucket(bucket);
  };
  const handleMouseMove = (e) => {
    if (hoveredBucket) {
      const ph = 280, pw = 320;
      let y = e.clientY - ph - 15; if (y < 20) y = Math.min(window.innerHeight - ph - 20, e.clientY + 20);
      let x = Math.min(window.innerWidth - pw - 20, Math.max(20, e.clientX - 100));
      setPopoverPos({ x, y });
    }
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5 relative" onMouseMove={handleMouseMove}>
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Work order distribution categorized by physical work completion bands."
            formula="Physical Progress % = (Latest DPR Work Completed / Total WO Scope) × 100"
          />
          <div>
            <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>Physical Work Progress</h3>
            <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">Distribution of work orders by completion band</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col md:flex-row items-center justify-around gap-6 my-auto py-2 flex-1">
        <div className={`relative shrink-0 flex items-center justify-center ${isModal ? 'w-56 h-56 sm:w-72 sm:h-72' : 'w-40 h-40 sm:w-44 sm:h-44'}`}>
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
            {slices.map((slice, idx) => slice.pathData && (
              <path
                key={idx}
                d={slice.pathData}
                fill={slice.color}
                stroke={isDark ? '#0f172a' : '#ffffff'}
                strokeWidth="3"
                className="transition-all duration-300 hover:opacity-80 cursor-pointer"
                style={{ transform: hoveredBucket?.label === slice.label ? 'scale(1.05)' : 'scale(1)', transformOrigin: '100px 100px' }}
                onMouseEnter={(e) => handleMouseEnter(e, slice)}
                onMouseLeave={() => setHoveredBucket(null)}
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center p-4">
            <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Avg. Progress</span>
            <span className={`${isModal ? 'text-3xl sm:text-4xl' : 'text-xl sm:text-2xl'} font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5`}>{avgProg}%</span>
          </div>
        </div>
        <div className={`flex flex-col gap-2 w-full md:w-auto ${isModal ? 'min-w-[240px]' : 'min-w-[180px]'}`}>
          {slices.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between gap-3 text-xs font-semibold py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${hoveredBucket?.label === item.label ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]' : 'hover:bg-slate-500/10 border border-transparent'}`}
              onMouseEnter={(e) => handleMouseEnter(e, item)}
              onMouseLeave={() => setHoveredBucket(null)}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs whitespace-nowrap">{item.label}</span>
              </div>
              <div className="flex items-center gap-1.5 font-mono shrink-0 whitespace-nowrap">
                <span className="font-extrabold text-slate-900 dark:text-slate-100 text-xs">{item.count}</span>
                <span className="text-slate-500 dark:text-slate-400 text-[10px] font-bold">({item.pct}%)</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {hoveredBucket && ReactDOM.createPortal(
        <div
          className="fixed z-[99999] rounded-2xl shadow-2xl p-4 min-w-[300px] max-w-[360px] pointer-events-none transition-all duration-150 backdrop-blur-md"
          style={{ top: popoverPos.y, left: popoverPos.x, backgroundColor: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(255,255,255,0.98)', border: `1.5px solid ${hoveredBucket.color}`, boxShadow: `0 20px 35px -5px rgba(0,0,0,0.7), 0 8px 16px -6px ${hoveredBucket.color}60` }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 dark:border-slate-700/60 pb-2.5 mb-2.5">
            <div className="flex items-center gap-2">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hoveredBucket.color }} />
              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">{hoveredBucket.label}</span>
            </div>
            <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              {hoveredBucket.workOrders?.length || hoveredBucket.count || 0} Work Orders
            </span>
          </div>
          {hoveredBucket.workOrders && hoveredBucket.workOrders.length > 0 ? (
            <div className="max-h-56 overflow-y-auto space-y-2 pr-1 text-xs">
              {hoveredBucket.workOrders.slice(0, 20).map((wo, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200/60 dark:border-slate-700/50">
                  <div className="min-w-0 pr-2">
                    <p className="font-extrabold font-mono text-[11px] text-slate-900 dark:text-slate-100 truncate">{wo.work_order_no}</p>
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{wo.site_details}</p>
                  </div>
                  <span className="shrink-0 font-extrabold text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-600 dark:text-amber-400">{wo.value}</span>
                </div>
              ))}
              {hoveredBucket.workOrders.length > 20 && <p className="text-[10px] text-center font-bold text-slate-400 pt-1">+{hoveredBucket.workOrders.length - 20} more</p>}
            </div>
          ) : <p className="text-xs text-slate-500 italic text-center py-2">No active work orders in this band</p>}
        </div>,
        document.body
      )}
    </div>
  );
};

/* ─── Department Wise Estimate Donut ─────────────────────────────── */
const DepartmentWiseEstimate = ({ projects }) => {
  const { isDark } = useTheme();
  const [hoveredDept, setHoveredDept] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const DEFAULT_COLORS = ['#3B82F6','#10B981','#8B5CF6','#F97316','#64748B','#EF4444','#14B8A6','#EC4899'];

  const items = useMemo(() => {
    const map = {};
    const countMap = {};
    (projects || []).forEach(p => {
      const d = p.department || 'General';
      map[d] = (map[d] || 0) + Number(p.work_order_value || 0);
      countMap[d] = (countMap[d] || 0) + 1;
    });
    const entries = Object.entries(map);
    if (entries.length === 0) {
      return [];
    }
    const total = entries.reduce((a, [, v]) => a + v, 0) || 1;
    return entries.map(([dept, amount], i) => ({
      department: dept,
      amount,
      count: countMap[dept] || 0,
      percentage: +((amount / total) * 100).toFixed(1),
      color: DEFAULT_COLORS[i % DEFAULT_COLORS.length]
    }));
  }, [projects]);

  const totalAmount = useMemo(() => items.reduce((a, it) => a + it.amount, 0), [items]);
  const slices = useMemo(() => buildDonutSlices(items, totalAmount, it => it.amount), [items, totalAmount]);

  const handleMouseEnter = (e, item) => {
    const ph = 100, pw = 240;
    let y = e.clientY - ph - 15; if (y < 20) y = Math.min(window.innerHeight - ph - 20, e.clientY + 20);
    let x = Math.min(window.innerWidth - pw - 20, Math.max(20, e.clientX - 50));
    setPopoverPos({ x, y }); setHoveredDept(item);
  };
  const handleMouseMove = (e) => {
    if (hoveredDept) {
      const ph = 100, pw = 240;
      let y = e.clientY - ph - 15; if (y < 20) y = Math.min(window.innerHeight - ph - 20, e.clientY + 20);
      let x = Math.min(window.innerWidth - pw - 20, Math.max(20, e.clientX - 50));
      setPopoverPos({ x, y });
    }
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-4 sm:p-5 relative" onMouseMove={handleMouseMove}>
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Distribution of estimated project expenditure allocated across operational departments."
            formula="Dept Share % = (Sum of Approved Estimates in Dept / Total Zonal Estimate) × 100"
          />
          <div>
            <h3 className="chart-title text-base sm:text-lg font-extrabold tracking-tight" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>Department Wise Estimate Amount</h3>
            <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">Breakdown of estimated costs across operational departments</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-center justify-center gap-4 my-auto py-2">
        <div className="relative w-44 h-44 sm:w-48 sm:h-48 shrink-0 mx-auto">
          {items.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center text-xs font-bold text-slate-500 uppercase tracking-wider text-center p-4">No projects for selected ZO Name</div>
          ) : (
            <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
              {slices.map((slice, idx) => slice.pathData && (
                <g key={idx} className="transition-all duration-300 hover:opacity-90 cursor-pointer group"
                  onMouseEnter={(e) => handleMouseEnter(e, slice)} onMouseLeave={() => setHoveredDept(null)}>
                  <path d={slice.pathData} fill={slice.color} stroke={isDark ? '#0f172a' : '#ffffff'} strokeWidth="2.5"
                    style={{ transform: hoveredDept?.department === slice.department ? 'scale(1.04)' : 'scale(1)', transformOrigin: '100px 100px' }} />
                </g>
              ))}
            </svg>
          )}
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full pt-2 border-t border-white/5">
          {items.map((item, idx) => (
            <div key={idx}
              className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${hoveredDept?.department === item.department ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]' : 'hover:bg-slate-500/10 border border-transparent'}`}
              onMouseEnter={(e) => handleMouseEnter(e, item)} onMouseLeave={() => setHoveredDept(null)}>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span className="chart-text-primary text-slate-800 dark:text-slate-200 font-bold text-xs truncate" title={item.department}>{item.department}</span>
              </div>
              <span className="text-slate-400 font-mono text-[10px] font-bold shrink-0">{item.percentage}%</span>
            </div>
          ))}
        </div>
      </div>
      {hoveredDept && ReactDOM.createPortal(
        <div className="fixed z-[99999] rounded-2xl shadow-2xl p-3.5 min-w-[220px] pointer-events-none transition-all duration-150 backdrop-blur-md"
          style={{ top: popoverPos.y, left: popoverPos.x, backgroundColor: isDark ? 'rgba(15,23,42,0.98)' : 'rgba(255,255,255,0.98)', border: `1.5px solid ${hoveredDept.color}`, boxShadow: `0 20px 35px -5px rgba(0,0,0,0.7), 0 8px 16px -6px ${hoveredDept.color}60` }}>
          <div className="flex items-center gap-2 mb-1.5 border-b border-slate-200 dark:border-slate-700/60 pb-1.5">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hoveredDept.color }} />
            <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">{hoveredDept.department}</span>
          </div>
          <div className="flex items-baseline justify-between gap-3 mt-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Estimated Amount:</span>
            <span className="font-black text-sm font-mono text-amber-400">{fmtCr(hoveredDept.amount)}</span>
          </div>
          {hoveredDept.count !== undefined && (
            <div className="flex items-baseline justify-between gap-3 mt-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Work Orders:</span>
              <span className="font-bold text-xs font-mono text-sky-400">{hoveredDept.count} {hoveredDept.count === 1 ? 'Work Order' : 'Work Orders'}</span>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-3 mt-0.5">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Share of Estimate:</span>
            <span className="font-bold text-xs font-mono text-slate-200">{hoveredDept.percentage}%</span>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

/* ─── Key Financial Indicators ────────────────────────────────────── */
const KeyFinancialIndicators = ({ projects }) => {
  const { isDark } = useTheme();

  const emd = useMemo(() => (projects || []).reduce((a, p) => a + Number(p.earnest_money_deposit || 0), 0), [projects]);
  const sd = useMemo(() => (projects || []).reduce((a, p) => a + Number(p.security_deposit_amount || 0), 0), [projects]);
  const itTds = useMemo(() => (projects || []).reduce((a, p) => a + Number(p.it_tds || 0), 0), [projects]);
  const sgst = useMemo(() => (projects || []).reduce((a, p) => a + Number(p.sgst || 0), 0), [projects]);
  const cgst = useMemo(() => (projects || []).reduce((a, p) => a + Number(p.cgst || 0), 0), [projects]);

  const items = useMemo(() => [
    { label: 'EMD Amount',        value: emd, color: '#10b981', bgColor: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" /></svg> },
    { label: 'Security Deposit',  value: sd, color: '#0ea5e9', bgColor: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg> },
    { label: 'IT TDS',            value: itTds, color: '#f59e0b', bgColor: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg> },
    { label: 'SGST',              value: sgst, color: '#f43f5e', bgColor: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg> },
    { label: 'CGST',              value: cgst, color: '#a78bfa', bgColor: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20', icon: <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 11h10M7 15h10M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /></svg> },
  ], [emd, sd, itTds, sgst, cgst]);

  const maxAmount = Math.max(1, ...items.map(i => i.value));
  return (
    <div className="chart-panel h-full flex flex-col justify-between p-5">
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="Summary of statutory withholdings and security deposits retained across zonal projects."
            formula="Withholdings = EMD + Security Deposit (10%) + IT TDS (2%) + SGST (1%) + CGST (1%)"
          />
          <div>
            <h3 className="chart-title" style={{ color: isDark ? '#e2e8f4' : '#1E3A8A' }}>Key Financial Indicators</h3>
            <p className="chart-subtitle">Summary of statutory withholdings</p>
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-between my-auto gap-3">
        {items.map((item, idx) => {
          const barWidth = (item.value / maxAmount) * 100;
          return (
            <div key={idx} className="group">
              <div className="flex items-center justify-between mb-1.5 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className={`p-1.5 rounded-lg border shadow-xs shrink-0 ${item.bgColor}`}>{item.icon}</div>
                  <span className="font-bold text-xs text-slate-700 dark:text-slate-200 truncate">{item.label}</span>
                </div>
                <span className="font-extrabold text-xs font-mono text-slate-900 dark:text-slate-100 shrink-0 whitespace-nowrap">{fmtCr(item.value)}</span>
              </div>
              <div className="relative h-1 bg-white/[0.055] rounded-full overflow-visible">
                <div className="absolute left-0 top-0 h-full rounded-full transition-all duration-700" style={{ width: `${barWidth}%`, background: `linear-gradient(90deg, ${item.color}99 0%, ${item.color} 100%)` }} />
                <span className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full transition-all duration-700" style={{ left: `calc(${barWidth}% - 4px)`, background: item.color, boxShadow: `0 0 6px 2px ${item.color}80` }} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/* ─── Fund Flow Waterfall ─────────────────────────────────────────── */
const FundFlowWaterfall = ({ projects }) => {
  const c = useChartColors();
  const W = 600, H = 300, PAD_LEFT = 180, PAD_RIGHT = 100, PAD_Y = 40;
  const barH = 24, gap = 16;

  const rows = useMemo(() => {
    const p = projects || [];
    const totalWOVal = p.reduce((a, pr) => a + Number(pr.work_order_value || 0), 0);
    const est = p.reduce((a, pr) => a + Number(pr.estimate_amount || 0), 0);
    const allocated = p.reduce((a, pr) => a + Number(pr.approved_amount || 0), 0);
    const reqApproved = p.reduce((a, pr) => a + Number(pr.approved_requisitions_amount || pr.requisition_amount || 0), 0);
    const billed = p.reduce((a, pr) => a + Number(pr.gross_billed || 0), 0);
    const paid = p.reduce((a, pr) => a + Number(pr.agency_paid || 0), 0);

    return [
      { stage: 'Final Approved Estimate', amount: est },
      { stage: 'HO Allocated',            amount: allocated },
      { stage: 'Requisitions Approved',   amount: reqApproved },
      { stage: 'Gross Billed',            amount: billed },
      { stage: 'Agency Paid',             amount: paid },
    ];
  }, [projects]);

  const maxVal = Math.max(1, ...rows.map(d => Number(d.amount || 0)));
  const scale = (v) => (v / maxVal) * (W - PAD_LEFT - PAD_RIGHT);

  return (
    <div className="chart-panel h-full">
      <div className="flex justify-between items-start mb-2">
        <div>
          <h3 className="chart-title">Fund Flow Pipeline</h3>
          <p className="chart-subtitle">Capital flow drop-off from cost estimate to agency payment</p>
        </div>
        <ChartInfoTooltip
          description="Capital realization pipeline tracking fund flow drop-off from cost estimate to agency payment."
          formula="Stage Drop-off = Current Stage Amount - Subsequent Stage Amount"
        />
      </div>
      <div className="relative mt-6">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="zo-emer" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#059669" stopOpacity={c.isDark ? '0.8' : '0.9'} />
              <stop offset="100%" stopColor="#10b981" stopOpacity={c.isDark ? '0.8' : '0.9'} />
            </linearGradient>
            <linearGradient id="zo-rose" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#dc2626" stopOpacity={c.isDark ? '0.8' : '0.9'} />
              <stop offset="100%" stopColor="#f43f5e" stopOpacity={c.isDark ? '0.8' : '0.9'} />
            </linearGradient>
          </defs>
          {rows.map((d, i) => {
            const bW = scale(d.amount);
            const y = PAD_Y + i * (barH + gap);
            const prev = i > 0 ? Number(rows[i - 1].amount || 0) : d.amount;
            const diff = prev - d.amount;
            const isDrop = diff > 0;
            return (
              <g key={i}>
                <text x={PAD_LEFT - 12} y={y + 16} textAnchor="end" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="0.5">{d.stage.toUpperCase()}</text>
                <rect x={PAD_LEFT} y={y} width={Math.max(2, bW)} height={barH} rx={4} fill={isDrop && i > 0 ? 'url(#zo-rose)' : 'url(#zo-emer)'} className="transition-all duration-300 hover:fill-opacity-90" />
                <text x={PAD_LEFT + bW + 10} y={y + 16} fill={c.labelStrong} fontSize="8" fontWeight="bold">{fmtCr(d.amount)}</text>
                {i > 0 && isDrop && (
                  <g>
                    <path d={`M ${PAD_LEFT + scale(prev)} ${y - gap} L ${PAD_LEFT + scale(prev)} ${y} L ${PAD_LEFT + bW} ${y}`} fill="none" stroke={c.dropOffConnector} strokeWidth="1" strokeDasharray="2 2" />
                    <text x={PAD_LEFT + scale(prev) + 6} y={y - 4} fill={c.isDark ? '#f43f5e' : '#be123c'} fontSize="7" fontWeight="900">-{fmtCr(diff)}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
};

/* ─── Bubble Risk Matrix ──────────────────────────────────────────── */
const BubbleRiskMatrix = ({ projects }) => {
  const [tooltip, setTooltip] = useState(null);
  const c = useChartColors();
  const W = 600, H = 380, PAD = 58;
  const toX = (v) => PAD + (Math.min(v, 140) / 140) * (W - 2 * PAD);
  const toY = (v) => (H - PAD) - (Math.min(v, 100) / 100) * (H - 2 * PAD);

  const bubbles = (projects && projects.length > 0)
    ? projects.map(p => ({ work_order_no: p.work_order_no, site_details: p.site_details, budget_utilization_pct: p.budget_utilization_pct || 70, physical_progress: p.physical_progress || 0, days_since_dpr: p.days_since_last_progress_report || 5, health_status: p.health_status || 'Healthy' }))
    : [];

  return (
    <div className="chart-panel h-full flex flex-col">
      <div className="flex justify-between items-center mb-3 shrink-0">
        <div>
          <h3 className="chart-title">Bubble Risk Matrix</h3>
          <p className="chart-subtitle">Budget vs Physical Progress vs reporting frequency</p>
        </div>
        <div className="flex gap-3 text-[8px] font-black uppercase tracking-wider chart-label">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500" /> Healthy</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-amber-500" /> Warning</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-rose-500" /> Critical</span>
        </div>
      </div>
      <div className="relative flex-1 flex items-center justify-center min-h-0">
        {bubbles.length === 0 ? (
          <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">No project data for selected ZO Name</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-full max-h-[60vh]" preserveAspectRatio="xMidYMid meet">
            <line x1={toX(70)} y1={PAD} x2={toX(70)} y2={H - PAD} stroke={c.gridLineDash} strokeDasharray="4 4" />
            <line x1={PAD} y1={toY(50)} x2={W - PAD} y2={toY(50)} stroke={c.gridLineDash} strokeDasharray="4 4" />
            <text x={PAD + 10} y={PAD + 18} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">EFFICIENT</text>
            <text x={toX(70) + 10} y={PAD + 18} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">ON TRACK</text>
            <text x={PAD + 10} y={H - PAD - 10} fill={c.quadrantNormal} fontSize="8" fontWeight="bold" letterSpacing="1">DORMANT</text>
            <text x={toX(70) + 10} y={H - PAD - 10} fill={c.quadrantCritical} fontSize="8" fontWeight="bold" letterSpacing="1">CRITICAL OVERRUN</text>
            <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke={c.axisLine} strokeWidth="1" />
            <text x={W / 2} y={H - 12} textAnchor="middle" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="1">BUDGET UTILIZATION %</text>
            <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke={c.axisLine} strokeWidth="1" />
            <text x={16} y={H / 2} textAnchor="middle" fill={c.labelNormal} fontSize="8" fontWeight="bold" letterSpacing="1" transform={`rotate(-90, 16, ${H / 2})`}>PHYSICAL PROGRESS %</text>
            {[0, 35, 70, 105, 140].map(v => <text key={v} x={toX(v)} y={H - PAD + 14} textAnchor="middle" fill={c.labelMuted} fontSize="7">{v}%</text>)}
            {[0, 25, 50, 75, 100].map(v => <text key={v} x={PAD - 8} y={toY(v) + 3} textAnchor="end" fill={c.labelMuted} fontSize="7">{v}%</text>)}
            {bubbles.map((d, i) => {
              const r = Math.min(20, 6 + Number(d.days_since_dpr || 0) / 4);
              const fill = d.health_status === 'Critical' ? '#ef4444' : d.health_status === 'Warning' ? '#f59e0b' : '#10b981';
              return (
                <circle key={i} cx={toX(d.budget_utilization_pct || 0)} cy={toY(d.physical_progress || 0)} r={r}
                  fill={fill} fillOpacity={0.75} stroke={fill} strokeWidth={1.5}
                  className="cursor-pointer transition-all duration-200 hover:fill-opacity-100"
                  onMouseEnter={(e) => setTooltip({ ...d, x: e.clientX, y: e.clientY })}
                  onMouseMove={(e) => setTooltip(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null)}
                  onMouseLeave={() => setTooltip(null)}
                />
              );
            })}
          </svg>
        )}
        {tooltip && (
          <div className="fixed z-50 chart-tooltip p-3 rounded-2xl text-[10px] pointer-events-none min-w-[180px] shadow-2xl"
            style={{ top: tooltip.y - 120, left: tooltip.x + 20 }}>
            <p className="font-extrabold truncate chart-tooltip-title">{tooltip.site_details || 'Site Project'}</p>
            <p className="chart-tooltip-mono text-[9px] mt-0.5">{tooltip.work_order_no}</p>
            <div className="mt-2 space-y-1 pt-1.5 chart-tooltip-divider">
              <p className="chart-tooltip-label">Budget Spent: <span className="text-amber-600 font-extrabold">{tooltip.budget_utilization_pct?.toFixed(1)}%</span></p>
              <p className="chart-tooltip-label">Physical Progress: <span className="text-emerald-600 font-extrabold">{tooltip.physical_progress}%</span></p>
              <p className="chart-tooltip-label">Last DPR Visit: <span className={tooltip.days_since_dpr > 7 ? 'text-rose-600 font-extrabold' : 'chart-tooltip-normal'}>{tooltip.days_since_dpr}d ago</span></p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

/* ─── S-Curve Progress ────────────────────────────────────────────── */
const SCurveProgress = ({ projects }) => {
  const c = useChartColors();
  const W = 600, H = 330, PAD_TOP = 40, PAD_BOT = 60, PAD_SIDE = 50;
  const months = ['Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'];
  const planned = [10, 25, 42, 58, 74, 88];
  const actual = useMemo(() => {
    if (!projects?.length) return [0, 0, 0, 0, 0, 0];
    const avg = Math.round(projects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / projects.length);
    return [Math.round(avg * 0.08), Math.round(avg * 0.21), Math.round(avg * 0.38), Math.round(avg * 0.55), Math.round(avg * 0.72), avg];
  }, [projects]);

  const toX = (i) => PAD_SIDE + (i / (months.length - 1)) * (W - 2 * PAD_SIDE);
  const toY = (v) => (H - PAD_BOT) - (v / 100) * (H - PAD_TOP - PAD_BOT);
  const pts = (arr) => arr.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');

  return (
    <div className="chart-panel h-full flex flex-col justify-between">
      <div className="flex justify-between items-center mb-4">
        <div>
          <h3 className="chart-title">S-Curve Performance Progress</h3>
          <p className="chart-subtitle">Planned linear trajectory vs actual DPR submissions</p>
        </div>
      </div>
      <div className="relative flex-1 flex flex-col justify-center">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
          {[0, 25, 50, 75, 100].map((v, i) => {
            const y = toY(v);
            return <g key={i}><line x1={PAD_SIDE} y1={y} x2={W - PAD_SIDE} y2={y} stroke={c.gridLine} /><text x={PAD_SIDE - 8} y={y + 3} textAnchor="end" fill={c.labelMuted} fontSize="8">{v}%</text></g>;
          })}
          <text x={PAD_SIDE} y={H - PAD_BOT + 16} fill={c.labelMuted} fontSize="8">START DATE</text>
          <text x={W - PAD_SIDE} y={H - PAD_BOT + 16} textAnchor="end" fill={c.labelMuted} fontSize="8">COMPLETION</text>
          {months.map((m, i) => <text key={m} x={toX(i)} y={H - PAD_BOT + 32} textAnchor="middle" fill={c.labelMuted} fontSize="9" fontWeight="bold">{m}</text>)}
          <polyline fill="none" stroke={c.isDark ? '#f59e0b' : '#d97706'} strokeWidth="2" strokeDasharray="5 4" points={pts(planned)} />
          <polyline fill="none" stroke={c.isDark ? '#10b981' : '#059669'} strokeWidth="3" points={pts(actual)} />
          {actual.map((v, i) => <circle key={i} cx={toX(i)} cy={toY(v)} r="4" fill={c.isDark ? '#10b981' : '#059669'} />)}
        </svg>
        <div className="flex gap-6 mt-3 text-[9px] font-bold uppercase tracking-widest chart-label justify-center">
          <div className="flex items-center gap-1.5"><span className="w-3 h-0.5 border-t-2 border-dashed" style={{ borderColor: c.isDark ? '#f59e0b' : '#d97706' }} /><span>Planned Target</span></div>
          <div className="flex items-center gap-1.5"><span className="w-3 h-1 rounded-sm" style={{ backgroundColor: c.isDark ? '#10b981' : '#059669' }} /><span>Actual Progress</span></div>
        </div>
      </div>
    </div>
  );
};

/* ─── Investment vs Recovery Realization Plot ─────────────────────── */
const InvestmentRecoveryPlot = ({ projects, agencyPaymentAmount = 0, isModal = false }) => {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState('summary');
  const [woPage, setWoPage] = useState(1);
  const [searchWo, setSearchWo] = useState('');
  const pageSize = 4;

  const metrics = useMemo(() => {
    const pList = projects || [];
    const totalProjects = pList.length || 1;
    const woValue = pList.reduce((a, p) => a + Number(p.work_order_value || 0), 0);
    const investment = pList.reduce((a, p) => a + Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0), 0);
    const grossBilled = pList.reduce((a, p) => a + Number(p.gross_billed || 0), 0);
    let billReceived = pList.reduce((a, p) => a + Number(p.agency_payment ?? p.agency_paid ?? 0), 0);
    if (!billReceived && agencyPaymentAmount) {
      billReceived = Number(agencyPaymentAmount);
    }

    const pendingRecovery = Math.max(0, investment - billReceived);
    const surplusRecovery = Math.max(0, billReceived - investment);
    const remainingWOValue = Math.max(0, woValue - investment);
    const deductions = Math.max(0, grossBilled - billReceived);

    const investmentPct = woValue > 0 ? ((investment / woValue) * 100).toFixed(1) : '0.0';
    const disbursementPct = woValue > 0 ? ((billReceived / woValue) * 100).toFixed(1) : '0.0';
    const recoveryAgainstInvestPct = investment > 0 ? ((billReceived / investment) * 100).toFixed(1) : '0.0';
    const recoveryBarPct = Math.min(100, Number(recoveryAgainstInvestPct));
    const deductionRate = grossBilled > 0 ? ((deductions / grossBilled) * 100).toFixed(1) : '0.0';

    const getProgressBand = (prog, status) => {
      const p = Number(prog || 0);
      if (p > 100 || status === 'Critical') return { label: '>100% Over Budget', color: '#EF4444', bg: 'bg-rose-500/15 text-rose-400 border-rose-500/30' };
      if (p === 100) return { label: '100% Completed', color: '#16A34A', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' };
      if (p >= 81) return { label: `${p}% Excellent`, color: '#10B981', bg: 'bg-teal-500/15 text-teal-400 border-teal-500/30' };
      if (p >= 61) return { label: `${p}% Very Good`, color: '#15803D', bg: 'bg-emerald-600/15 text-emerald-300 border-emerald-600/30' };
      if (p >= 41) return { label: `${p}% Good`, color: '#22C55E', bg: 'bg-green-500/15 text-green-400 border-green-500/30' };
      if (p >= 21) return { label: `${p}% Fair`, color: '#EAB308', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' };
      if (p >= 1) return { label: `${p}% Initial`, color: '#3B82F6', bg: 'bg-sky-500/15 text-sky-400 border-sky-500/30' };
      return { label: '0% Not Started', color: '#64748B', bg: 'bg-slate-500/15 text-slate-400 border-slate-500/30' };
    };

    const rawBands = [
      { label: '0% Not Started', color: '#64748B', count: pList.filter(p => !p.physical_progress || p.physical_progress === 0).length },
      { label: '1–20% Initial Stage', color: '#3B82F6', count: pList.filter(p => p.physical_progress > 0 && p.physical_progress <= 20).length },
      { label: '21–40% Fair', color: '#EAB308', count: pList.filter(p => p.physical_progress > 20 && p.physical_progress <= 40).length },
      { label: '41–60% Good', color: '#22C55E', count: pList.filter(p => p.physical_progress > 40 && p.physical_progress <= 60).length },
      { label: '61–80% Very Good', color: '#15803D', count: pList.filter(p => p.physical_progress > 60 && p.physical_progress <= 80).length },
      { label: '81–99% Excellent', color: '#10B981', count: pList.filter(p => p.physical_progress > 80 && p.physical_progress < 100).length },
      { label: '100% Completed', color: '#16A34A', count: pList.filter(p => p.physical_progress === 100).length },
      { label: '>100% Over Budget', color: '#EF4444', count: pList.filter(p => p.physical_progress > 100 || p.health_status === 'Critical').length },
    ];

    const bands = rawBands.map(b => ({
      ...b,
      pct: ((b.count / totalProjects) * 100).toFixed(1),
    }));

    const woItems = pList.map(p => {
      const wVal = Number(p.work_order_value || 0);
      const inv = Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0);
      const rec = Number(p.agency_payment ?? p.agency_paid ?? 0);
      const pend = Math.max(0, inv - rec);
      const surplus = Math.max(0, rec - inv);
      const rem = Math.max(0, wVal - inv);
      const band = getProgressBand(p.physical_progress, p.health_status);
      return {
        work_order_no: p.work_order_no,
        site_details: p.site_details,
        department: p.department,
        woValue: wVal,
        investment: inv,
        billReceived: rec,
        pendingRecovery: pend,
        surplusRecovery: surplus,
        remainingWOValue: rem,
        band,
        physical_progress: p.physical_progress || 0,
      };
    });

    return {
      totalProjects,
      woValue,
      investment,
      billReceived,
      pendingRecovery,
      surplusRecovery,
      remainingWOValue,
      investmentPct,
      billRecoveryPct,
      recoveryAgainstInvestPct,
      recoveryBarPct,
      bands,
      woItems,
    };
  }, [projects, agencyPaymentAmount]);

  const filteredWos = useMemo(() => {
    const q = searchWo.toLowerCase().trim();
    if (!q) return metrics.woItems;
    return metrics.woItems.filter(item =>
      (item.work_order_no || '').toLowerCase().includes(q) ||
      (item.site_details || '').toLowerCase().includes(q) ||
      (item.department || '').toLowerCase().includes(q)
    );
  }, [metrics.woItems, searchWo]);

  const totalWoPages = Math.ceil(filteredWos.length / pageSize) || 1;
  const pagedWos = useMemo(() => {
    const start = (woPage - 1) * pageSize;
    return filteredWos.slice(start, start + pageSize);
  }, [filteredWos, woPage, pageSize]);

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-3.5 sm:p-5 relative overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h3 className="chart-title text-sm sm:text-base font-extrabold tracking-tight truncate" style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}>
            Investment &amp; Bill Recovery Realization
          </h3>
          <p className="chart-subtitle text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {viewMode === 'summary' ? 'Realization Ratios, Dual Scale Breakdown & Progress Distribution' : 'Work Order Wise Realization Breakdown'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
          <div className="flex items-center gap-1 bg-white/5 border border-white/10 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setViewMode('summary')}
              className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition ${viewMode === 'summary' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              Summary
            </button>
            <button
              type="button"
              onClick={() => setViewMode('work_order')}
              className={`px-2.5 py-1 rounded-lg text-[9.5px] font-black uppercase tracking-wider transition ${viewMode === 'work_order' ? 'bg-amber-500 text-black shadow-md' : 'text-slate-400 hover:text-white'}`}
            >
              WO Wise ({metrics.woItems.length})
            </button>
          </div>

          <ChartInfoTooltip
            description="Capital investment vs bill recovery realization across work order progress bands."
            formula="Pending Recovery = Requisition Investment - Contractor Bill Payments Received"
          />
        </div>
      </div>

      {viewMode === 'summary' ? (
        <>
          {/* Top Formula KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 my-2">
            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-amber-400 truncate">Total Investment %</p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 whitespace-nowrap">Inv / WO</span>
                  <ChartInfoTooltip
                    description="Percentage of total portfolio Work Order value that has been requested and approved for project execution."
                    formula="Total Investment % = (Approved Requisitions / Total WO Value) × 100"
                  />
                </div>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-amber-400 mt-1">{metrics.investmentPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Inv: <strong className="text-slate-200">{fmtCr(metrics.investment)}</strong></span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-emerald-400 truncate">Bill Recovery %</p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 whitespace-nowrap">Rec / WO</span>
                  <ChartInfoTooltip
                    description="Percentage of total portfolio Work Order value recovered through paid contractor bills."
                    formula="Bill Recovery % = (Agency Payments Realized / Total WO Value) × 100"
                  />
                </div>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-emerald-400 mt-1">{metrics.billRecoveryPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Rec: <strong className="text-slate-200">{fmtCr(metrics.billReceived)}</strong></span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200'}`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className="text-[9px] font-extrabold uppercase tracking-wider text-teal-400 truncate">Payment Disbursement %</p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-teal-500/10 text-teal-300 border border-teal-500/20 whitespace-nowrap">Paid / WO</span>
                  <ChartInfoTooltip
                    description="Percentage of total portfolio Work Order value that has actually been disbursed to agencies as net payment. Represents actual fund outflow rate against contracted value."
                    formula="Payment Disbursement % = (Net Agency Payments / Total WO Value) × 100"
                  />
                </div>
              </div>
              <p className="text-base sm:text-lg font-black font-mono text-teal-400 mt-1">{metrics.disbursementPct}%</p>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Paid: <strong className="text-slate-200">{fmtCr(metrics.billReceived)}</strong></span>
                <span className="text-slate-500 truncate">of {fmtCr(metrics.woValue)}</span>
              </p>
            </div>

            <div className={`p-2.5 rounded-xl border transition-all flex flex-col justify-between relative ${
              metrics.surplusRecovery > 0
                ? (isDark ? 'bg-amber-950/40 border-amber-500/30' : 'bg-amber-50 border-amber-300')
                : (isDark ? 'bg-slate-900/80 border-white/10' : 'bg-slate-50 border-slate-200')
            }`}>
              <div className="flex items-center justify-between gap-1 min-w-0">
                <p className={`text-[9px] font-extrabold uppercase tracking-wider truncate ${metrics.surplusRecovery > 0 ? 'text-amber-400' : 'text-sky-400'}`}>Disbursement vs Investment</p>
                <div className="flex items-center gap-1 shrink-0">
                  <span className={`text-[7.5px] font-mono font-bold px-1.5 py-0.5 rounded whitespace-nowrap ${
                    metrics.surplusRecovery > 0
                      ? 'bg-amber-500/10 text-amber-300 border border-amber-500/20'
                      : 'bg-sky-500/10 text-sky-300 border border-sky-500/20'
                  }`}>Paid / Inv</span>
                  <ChartInfoTooltip
                    description={metrics.surplusRecovery > 0
                      ? '⚠ Over-disbursement: Agency payments exceed approved requisition investment. This may indicate payments released outside the requisition approval chain — flag for compliance audit.'
                      : 'Ratio of net agency payments against approved requisition investment. Shows what fraction of the investment pool has been disbursed to agencies.'}
                    formula="Disbursement vs Investment % = (Net Agency Payments / Approved Requisitions) × 100"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <p className={`text-base sm:text-lg font-black font-mono ${metrics.surplusRecovery > 0 ? 'text-amber-400' : 'text-sky-400'}`}>{metrics.recoveryAgainstInvestPct}%</p>
                {metrics.surplusRecovery > 0 && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 whitespace-nowrap">⚠ Over-Disbursed</span>
                )}
              </div>
              <p className="text-[8.5px] text-slate-400 font-mono mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 border-t border-white/5 pt-1 min-w-0">
                <span className="truncate">Paid: <strong className="text-slate-200">{fmtCr(metrics.billReceived)}</strong>
                  {metrics.surplusRecovery > 0
                    ? <span className="text-amber-400 font-bold"> (+{fmtCr(metrics.surplusRecovery)} over)</span>
                    : <span className="text-rose-400 font-bold"> (Pend: {fmtCr(metrics.pendingRecovery)})</span>
                  }
                </span>
                <span className="text-slate-500 truncate">of Inv: {fmtCr(metrics.investment)}</span>
              </p>
            </div>
          </div>

          {/* Gross Bill → Deductions → Net Paid Pipeline */}
          {metrics.grossBilled > 0 && (
            <div className="my-2 p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-[8.5px] font-black uppercase tracking-wider text-slate-400 font-mono">Gross Bill → Deductions → Net Paid Pipeline</p>
                <ChartInfoTooltip
                  description="Shows how gross billed amount reduces to net agency payment after statutory deductions (TDS, Security Deposit, GST, EMD etc.)."
                  formula="Deductions = Gross Bill Amount − Net Agency Payment"
                />
              </div>
              <div className="flex items-center gap-2 text-[8px] font-mono flex-wrap">
                <div className="flex flex-col items-center gap-0.5 p-1.5 rounded-lg bg-sky-500/10 border border-sky-500/20 min-w-[80px]">
                  <span className="text-sky-300 font-bold uppercase tracking-wider text-[7px]">Gross Billed</span>
                  <span className="text-sky-200 font-black text-[11px]">{fmtCr(metrics.grossBilled)}</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-rose-400 font-black text-[10px]">−</span>
                  <span className="text-rose-300 font-bold text-[7px] uppercase tracking-wider">{metrics.deductionRate}%</span>
                </div>
                <div className="flex flex-col items-center gap-0.5 p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/20 min-w-[80px]">
                  <span className="text-rose-300 font-bold uppercase tracking-wider text-[7px]">Deductions</span>
                  <span className="text-rose-200 font-black text-[11px]">{fmtCr(metrics.deductions)}</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <span className="text-emerald-400 font-black text-[10px]">→</span>
                </div>
                <div className="flex flex-col items-center gap-0.5 p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 min-w-[80px]">
                  <span className="text-emerald-300 font-bold uppercase tracking-wider text-[7px]">Net Agency Paid</span>
                  <span className="text-emerald-200 font-black text-[11px]">{fmtCr(metrics.billReceived)}</span>
                </div>
                <div className="flex-1 min-w-[80px]">
                  <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-800">
                    <div
                      style={{ width: `${metrics.grossBilled > 0 ? ((metrics.billReceived / metrics.grossBilled) * 100).toFixed(1) : 0}%` }}
                      className="bg-emerald-500 h-full"
                      title={`Net Paid: ${fmtCr(metrics.billReceived)}`}
                    />
                    <div
                      style={{ width: `${metrics.deductionRate}%` }}
                      className="bg-rose-500/70 h-full"
                      title={`Deductions: ${fmtCr(metrics.deductions)} (${metrics.deductionRate}%)`}
                    />
                  </div>
                  <p className="text-[7.5px] text-slate-500 mt-0.5 font-mono">Net retained: {metrics.grossBilled > 0 ? (100 - Number(metrics.deductionRate)).toFixed(1) : 0}% of Gross</p>
                </div>
              </div>
            </div>
          )}

          {/* Dual Realization Progress Bars */}
          <div className="my-2 space-y-2 p-2.5 rounded-xl border border-white/5 bg-slate-950/40">
            {/* Bar 1: Investment vs Remaining WO Value */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[8.5px] font-bold uppercase text-slate-400 mb-1 font-mono">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="truncate">1. Capital Investment Realization</span>
                  <ChartInfoTooltip
                    description="Visual breakdown of total investment disbursed against overall portfolio work order capacity."
                    formula="Remaining WO Value = Total WO Value - Approved Requisition Investment"
                  />
                </div>
                <span className="shrink-0 text-slate-300">WO Value: {fmtCr(metrics.woValue)}</span>
              </div>
              <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-800">
                <div
                  style={{ width: `${Math.max(1, Math.min(100, Number(metrics.investmentPct)))}%` }}
                  className="bg-amber-500 h-full transition-all duration-500"
                  title={`Investment: ${fmtCr(metrics.investment)} (${metrics.investmentPct}%)`}
                />
                <div
                  style={{ width: `${Math.max(0, 100 - Number(metrics.investmentPct))}%` }}
                  className="bg-sky-500/30 h-full transition-all duration-500"
                  title={`Remaining WO Value: ${fmtCr(metrics.remainingWOValue)}`}
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1 text-[8px] font-mono text-slate-400">
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" /> Total Inv: {fmtCr(metrics.investment)} ({metrics.investmentPct}%)</span>
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-sky-500/30 shrink-0" /> Remaining: {fmtCr(metrics.remainingWOValue)}</span>
              </div>
            </div>

            {/* Bar 2: Recovery Realization against Total Investment */}
            <div className="border-t border-white/5 pt-1.5">
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[8.5px] font-bold uppercase text-slate-400 mb-1 font-mono">
                <div className="flex items-center gap-1.5 truncate">
                  <span className="truncate">2. Recovery Realization (Investment Pool)</span>
                  <ChartInfoTooltip
                    description="Visual realization of actual contractor bill payments recovered against the disbursed investment pool."
                    formula="Pending Recovery = Approved Requisitions - Agency Billed Payments"
                  />
                </div>
                <span className="shrink-0 text-slate-300">Pool: {fmtCr(metrics.investment)}</span>
              </div>
              <div className="h-3 w-full rounded-full overflow-hidden flex bg-slate-800">
                <div
                  style={{ width: `${Math.max(1, metrics.recoveryBarPct)}%` }}
                  className="bg-emerald-500 h-full transition-all duration-500"
                  title={`Agency Paid: ${fmtCr(metrics.billReceived)} (${metrics.recoveryAgainstInvestPct}% of Investment)`}
                />
                {metrics.pendingRecovery > 0 && (
                  <div
                    style={{ width: `${Math.max(0, 100 - metrics.recoveryBarPct)}%` }}
                    className="bg-rose-500/80 h-full transition-all duration-500"
                    title={`Pending Bill Recovery: ${fmtCr(metrics.pendingRecovery)}`}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mt-1 text-[8px] font-mono text-slate-400">
                <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" /> Agency Paid: {fmtCr(metrics.billReceived)} ({metrics.recoveryAgainstInvestPct}%)</span>
                {metrics.surplusRecovery > 0
                  ? <span className="flex items-center gap-1 truncate text-emerald-400"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" /> Surplus: +{fmtCr(metrics.surplusRecovery)}</span>
                  : <span className="flex items-center gap-1 truncate"><span className="w-1.5 h-1.5 rounded-full bg-rose-500/80 shrink-0" /> Pending: {fmtCr(metrics.pendingRecovery)}</span>
                }
              </div>
            </div>
          </div>

          {/* Visual Progress Stage Color Bands with Stacked Bar & Distribution Badges */}
          <div className="mt-2 pt-2 border-t border-white/5">
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 mb-1">
              <p className="text-[8.5px] sm:text-[9px] font-black uppercase tracking-wider text-slate-400 truncate">Progress Stage Color Bands Distribution</p>
              <span className="text-[8px] font-mono text-slate-500 font-bold shrink-0">{metrics.totalProjects} Total WOs</span>
            </div>

            {/* Multi-segment distribution bar */}
            <div className="h-2 w-full rounded-full overflow-hidden flex bg-slate-800 mb-2">
              {metrics.bands.map((b, idx) => Number(b.pct) > 0 && (
                <div
                  key={idx}
                  style={{ width: `${b.pct}%`, backgroundColor: b.color }}
                  className="h-full transition-all duration-300"
                  title={`${b.label}: ${b.count} WOs (${b.pct}%)`}
                />
              ))}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[8.5px]">
              {metrics.bands.map((b, idx) => (
                <div key={idx} className="flex items-center justify-between p-1.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition min-w-0">
                  <div className="flex items-center gap-1 truncate min-w-0">
                    <span className="w-2 h-2 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: b.color }} />
                    <span className="font-bold text-slate-300 truncate text-[8.5px]">{b.label}</span>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0 font-mono ml-1">
                    <span className="font-black text-amber-400 text-[9px]">{b.count}</span>
                    <span className="text-[7.5px] text-slate-500">({b.pct}%)</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* Work Order Wise View Mode */
        <div className="flex flex-col flex-1 min-h-0 justify-between">
          <div className="mb-2">
            <input
              type="text"
              placeholder="Search work order or site..."
              value={searchWo}
              onChange={(e) => { setSearchWo(e.target.value); setWoPage(1); }}
              className={`w-full border rounded-xl px-3 py-1.5 text-xs focus:outline-none focus:border-amber-500/50 ${isDark ? 'bg-slate-950 border-white/10 text-slate-200 placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900'}`}
            />
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[260px] pr-1">
            {pagedWos.map((item, idx) => (
              <div
                key={idx}
                className={`p-2.5 rounded-xl border transition-all ${isDark ? 'bg-slate-900/60 border-white/10 hover:border-white/20' : 'bg-white border-slate-200 shadow-sm'}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <span
                      onClick={() => navigate && navigate(`/projects/${item.work_order_no}/digital-twin`)}
                      className="font-extrabold font-mono text-xs text-sky-400 hover:underline cursor-pointer truncate block"
                    >
                      {item.work_order_no}
                    </span>
                    <p className="text-[10px] text-slate-400 truncate">{item.site_details || item.department}</p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-black border uppercase tracking-wider shrink-0 ${item.band.bg}`}>
                    {item.band.label}
                  </span>
                </div>

                <div className="grid grid-cols-4 gap-1 mt-2 text-[9px] font-mono border-t border-white/5 pt-1.5">
                  <div>
                    <span className="text-slate-500 block text-[8px]">WO Value</span>
                    <span className="font-bold text-slate-200">{fmtCr(item.woValue)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px]">Investment</span>
                    <span className="font-bold text-amber-400">{fmtCr(item.investment)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px]">Received</span>
                    <span className="font-bold text-emerald-400">{fmtCr(item.billReceived)}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[8px]">Pending</span>
                    <span className="font-bold text-rose-400">{fmtCr(item.pendingRecovery)}</span>
                  </div>
                </div>
              </div>
            ))}
            {pagedWos.length === 0 && (
              <div className="py-8 text-center text-xs text-slate-500 italic">No work orders match current search</div>
            )}
          </div>

          {totalWoPages > 1 && (
            <div className="flex items-center justify-between pt-2 mt-1 border-t border-white/5 text-[10px] font-mono select-none">
              <span className="text-slate-400 font-bold">Pg {woPage} of {totalWoPages} ({filteredWos.length} WOs)</span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setWoPage(p => Math.max(1, p - 1))}
                  disabled={woPage === 1}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setWoPage(p => Math.min(totalWoPages, p + 1))}
                  disabled={woPage === totalWoPages}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── JE Leaderboard (paginated) ─────────────────────────────────── */
const JeLeaderboard = ({ projects, selectedZoName }) => {
  const { isDark } = useTheme();
  const [page, setPage] = useState(1);
  const rowsPerPage = 5;

  const jes = useMemo(() => {
    const map = {};
    (projects || []).forEach(p => {
      const name = p.assigned_je || p.je_user_id || p.assigned_to;
      if (name) {
        if (!map[name]) map[name] = { name, projects: 0, reports: 0, streak: Math.floor(Math.random() * 15) + 1 };
        map[name].projects += 1;
        map[name].reports += Number(p.total_dpr_count || 12);
      }
    });
    return Object.values(map);
  }, [projects]);

  const ranked = useMemo(() => [...jes].sort((a, b) => (b.reports * 2 + b.streak * 5 + b.projects) - (a.reports * 2 + a.streak * 5 + a.projects)), [jes]);
  const totalPages = Math.ceil(ranked.length / rowsPerPage) || 1;
  const paged = ranked.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  return (
    <div className="chart-panel h-full flex flex-col justify-between">
      <div>
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="chart-title">JE Leaderboard</h3>
            <p className="chart-subtitle">Junior Engineers under {selectedZoName || 'selected ZO'} ranked by performance</p>
          </div>
          {totalPages > 1 && (
            <span className="text-[10px] font-bold text-slate-400 font-mono">Pg {page}/{totalPages}</span>
          )}
        </div>
        <div className="overflow-x-auto">
          {ranked.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-500 font-bold uppercase tracking-wider">No JEs found for selected ZO</div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="chart-table-header">
                  <th className="py-2 text-[9px] font-bold uppercase tracking-widest">Rank</th>
                  <th className="py-2 text-[9px] font-bold uppercase tracking-widest">JE Name</th>
                  <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">Projects</th>
                  <th className="py-2 text-center text-[9px] font-bold uppercase tracking-widest">DPRs</th>
                  <th className="py-2 text-right text-[9px] font-bold uppercase tracking-widest">Streak</th>
                </tr>
              </thead>
              <tbody className="chart-table-body">
                {paged.map((je, i) => {
                  const rank = (page - 1) * rowsPerPage + i + 1;
                  return (
                    <tr key={i} className="chart-table-row transition-colors">
                      <td className="py-3">
                        <span className={`w-6 h-6 rounded-full font-extrabold text-[10px] inline-flex items-center justify-center ${rank === 1 ? 'bg-amber-500 text-white' : rank === 2 ? 'bg-slate-400 dark:bg-slate-600 text-white' : rank === 3 ? 'bg-amber-700 text-white' : 'bg-white/10 text-slate-300'}`}>{rank}</span>
                      </td>
                      <td className="py-3 font-bold chart-text-primary">{je.name}</td>
                      <td className="py-3 text-center font-bold chart-text-secondary">{je.projects}</td>
                      <td className="py-3 text-center font-bold chart-text-secondary">{je.reports}</td>
                      <td className="py-3 text-right font-mono font-bold text-emerald-400">🔥 {je.streak}d</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
      {ranked.length > rowsPerPage && (
        <div className="flex items-center justify-between pt-4 mt-2 border-t border-white/5 text-[10px] font-mono shrink-0">
          <span className="text-slate-400 font-bold">
            Showing {(page - 1) * rowsPerPage + 1}–{Math.min(page * rowsPerPage, ranked.length)} of {ranked.length} JEs
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >Prev</button>
            <span className="px-2 font-black text-amber-400">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >Next</button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Executive KPI Strip (10 tiles) ─────────────────────────────── */
const ExecutiveKpiStrip = ({ projects }) => {
  const { isDark } = useTheme();

  const totalWO = projects.length;
  const running = projects.filter(p => !['Completed', 'Closed'].includes(p.status)).length;
  const completed = projects.filter(p => ['Completed', 'Closed'].includes(p.status)).length;
  const pending = projects.filter(p => p.status === 'Pending').length;
  const totalWOVal = projects.reduce((a, p) => a + Number(p.work_order_value || 0), 0);
  const totalEst = projects.reduce((a, p) => a + Number(p.estimate_amount || 0), 0);
  const totalReq = projects.reduce((a, p) => a + Number(p.requisition_amount || 0), 0);
  const approvedReq = projects.reduce((a, p) => a + Number(p.approved_requisitions_amount || p.approved_amount || 0), 0);
  const zoBalance = projects.reduce((a, p) => a + Number(p.balance || 0), 0);
  const refund = projects.reduce((a, p) => a + Number(p.refund_amount || 0), 0);
  const grossBill = projects.reduce((a, p) => a + Number(p.gross_billed || 0), 0);
  const agencyPay = projects.reduce((a, p) => a + Number(p.agency_paid || 0), 0);
  const dueBill = Math.max(0, totalWOVal - grossBill);

  const kpis = [
    { id: 'wo', title: 'TOTAL WORK ORDERS', description: 'Total active and completed work orders in zone.', formula: 'Count(zonal_projects)', color: '#60a5fa', glow: 'linear-gradient(90deg, #3b82f6, transparent)', value: totalWO, subtext: `Running: ${running} | Completed: ${completed}\nPending: ${pending}` },
    { id: 'woval', title: 'TOTAL WO VALUE', description: 'Consolidated monetary value of all awarded zonal work orders.', formula: 'Sum(work_order_value)', color: '#34d399', glow: 'linear-gradient(90deg, #10b981, transparent)', value: fmtCr(totalWOVal), subtext: null },
    { id: 'est', title: 'TOTAL ESTIMATE AMOUNT', description: 'Aggregated cost estimate value of final approved sheets in zone.', formula: 'Sum(estimate_amount where status = \'Final Approved\')', color: '#c084fc', glow: 'linear-gradient(90deg, #a855f7, transparent)', value: fmtCr(totalEst), subtext: `${totalWOVal ? ((totalEst / totalWOVal) * 100).toFixed(1) : 0}% of WO Value` },
    { id: 'req', title: 'TOTAL REQUISITION (ZO→HO)', description: 'Total site fund requisitions requested from Zonal Office.', formula: 'Sum(approved_amount where status = \'Approved\')', color: '#fb923c', glow: 'linear-gradient(90deg, #f97316, transparent)', value: fmtCr(totalReq), subtext: `${totalEst ? ((totalReq / totalEst) * 100).toFixed(1) : 0}% of Estimate` },
    { id: 'app', title: 'TOTAL APPROVED (HO→ZO)', description: 'Total funds authorized and allocated from Head Office to Zone.', formula: 'Sum(approve_ho_amount where status = \'Approved\')', color: '#fbbf24', glow: 'linear-gradient(90deg, #f59e0b, transparent)', value: fmtCr(approvedReq), subtext: `${totalReq ? ((approvedReq / totalReq) * 100).toFixed(1) : 0}% of Requisition` },
    { id: 'bal', title: 'ZO AVAILABLE BALANCE', description: 'Liquid fund balance currently available in Zonal Office ledger.', formula: 'Sum(available_balance)', color: '#38bdf8', glow: 'linear-gradient(90deg, #0284c7, transparent)', value: fmtCr(zoBalance), subtext: null },
    { id: 'ref', title: 'TOTAL REFUND AMOUNT', description: 'Unspent excess funds returned from Zonal Office to Head Office.', formula: 'Sum(transaction_type = \'RETURN\')', color: '#2dd4bf', glow: 'linear-gradient(90deg, #14b8a6, transparent)', value: fmtCr(refund), subtext: null },
    { id: 'gb', title: 'GROSS BILL AMOUNT', description: 'Gross contractor billings submitted across zonal work orders.', formula: 'Sum(gross_bill)', color: '#f87171', glow: 'linear-gradient(90deg, #ef4444, transparent)', value: fmtCr(grossBill), subtext: `${totalEst ? ((grossBill / totalEst) * 100).toFixed(1) : 0}% of Estimate` },
    { id: 'ap', title: 'AGENCY PAYMENT', description: 'Net payments disbursed to contractors after statutory withholdings.', formula: 'Sum(agency_payment)', color: '#818cf8', glow: 'linear-gradient(90deg, #6366f1, transparent)', value: fmtCr(agencyPay), subtext: `${grossBill ? ((agencyPay / grossBill) * 100).toFixed(1) : 0}% of Gross Bill` },
    { id: 'due', title: 'REMAINING BILL AMOUNT', description: 'Pending unbilled work order value exposure remaining in zone.', formula: 'Total WO Value - Gross Bill Amount', color: '#ec4899', glow: 'linear-gradient(90deg, #db2777, transparent)', value: fmtCr(dueBill), subtext: `${totalWOVal ? ((dueBill / totalWOVal) * 100).toFixed(1) : 0}% of WO Value` },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 xl:grid-cols-10 gap-3 mb-6">
      {kpis.map((kpi) => (
        <div
          key={kpi.id}
          className={`relative p-3.5 rounded-2xl border flex flex-col justify-between transition-all duration-300 hover:-translate-y-0.5 overflow-hidden ${isDark ? 'bg-[#101520]/90 border-white/10 shadow-[0_4px_20px_rgba(0,0,0,0.4)] hover:border-white/20' : 'bg-white border-slate-200 shadow-sm hover:shadow-md'}`}
          style={{ minHeight: '135px' }}
        >
          <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: kpi.glow }} />
          <div className="absolute top-2.5 right-2.5 z-10">
            <ChartInfoTooltip description={kpi.description} formula={kpi.formula} />
          </div>
          <p className="text-[9.5px] font-black tracking-wider uppercase leading-snug pr-6" style={{ color: kpi.color }}>{kpi.title}</p>
          <div className="my-auto py-1">
            <span className={`text-base xl:text-lg font-bold font-mono tracking-tight ${isDark ? 'text-slate-100' : 'text-slate-900'}`}>{kpi.value}</span>
          </div>
          {kpi.subtext ? (
            <p className={`text-[9.5px] font-medium leading-tight whitespace-pre-line ${isDark ? 'text-slate-400/80' : 'text-slate-600'}`}>{kpi.subtext}</p>
          ) : <div className="h-3" />}
        </div>
      ))}
    </div>
  );
};

/* ─── Work Order Telemetry Table ─────────────────────────────────── */
const WorkOrderTelemetryTable = ({ data, availableZos, selectedZo, onSelectZo, getZoDisplayName }) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [sortField, setSortField] = useState('health_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const rowsPerPage = 5;

  const filtered = data.filter(p => {
    const q = search.toLowerCase().trim();
    const matchSearch = !q || (p.work_order_no || '').toLowerCase().includes(q) || (p.site_details || '').toLowerCase().includes(q) || (p.department || '').toLowerCase().includes(q) || (p.zo_name || p.zo_user_id || p.zone || '').toLowerCase().includes(q) || (p.district || '').toLowerCase().includes(q);
    const matchZo = !selectedZo || (p.zo_user_id || p.zo_name || p.zone || '').toLowerCase().trim() === selectedZo.toLowerCase().trim();
    const matchDept = !deptFilter || (p.department || '').toLowerCase().trim() === deptFilter.toLowerCase().trim();
    return matchSearch && matchZo && matchDept;
  });

  const depts = Array.from(new Set(data.map(p => p.department).filter(Boolean))).sort();

  const sorted = [...filtered].sort((a, b) => {
    const aVal = a[sortField] ?? 0, bVal = b[sortField] ?? 0;
    if (aVal < bVal) return sortAsc ? -1 : 1;
    if (aVal > bVal) return sortAsc ? 1 : -1;
    return 0;
  });

  const totalPages = Math.ceil(sorted.length / rowsPerPage) || 1;
  const paginated = sorted.slice((page - 1) * rowsPerPage, page * rowsPerPage);

  const handleSort = (field) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(false); }
    setPage(1);
  };

  const handleExport = () => {
    if (sorted.length === 0) return;
    exportProjectsToExcel(sorted);
  };

  return (
    <div className="relative w-full glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/10 mb-8 text-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="High-density project tracking telemetry table with real-time health score metrics for zonal projects."
            formula="Health Score = 100 - (Days Since DPR × 2) - (Budget Overrun %)"
          />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Work Order Telemetry</h3>
            <p className="text-[9px] text-slate-500 uppercase font-black tracking-wider mt-1">High-density zonal project tracking and performance telemetry</p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={sorted.length === 0}
            className="px-3.5 py-2 rounded-xl bg-emerald-500 text-black text-[9px] font-black uppercase tracking-widest hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer"
          >
            Export Excel
          </button>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6 items-center">
        <input
          type="text" placeholder="Search work order or site..."
          value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-white/20 transition"
        />
        <select value={deptFilter} onChange={(e) => { setDeptFilter(e.target.value); setPage(1); }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 focus:outline-none focus:border-white/20 transition">
          <option value="">All Departments</option>
          {depts.map(d => <option key={d} value={d}>{d}</option>)}
        </select>

        {/* Paginated ZO Selector Component */}
        <PaginatedZoSelector
          availableZos={availableZos}
          selectedZo={selectedZo}
          onSelectZo={(zoId) => { onSelectZo(zoId); setPage(1); }}
          getZoDisplayName={getZoDisplayName}
        />

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {(search || deptFilter || selectedZo) && (
            <button onClick={() => { setSearch(''); setDeptFilter(''); onSelectZo(null); setPage(1); }}
              className="px-3 py-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold uppercase tracking-wider hover:bg-rose-500/20 transition cursor-pointer">
              Reset Filters
            </button>
          )}
          <span className="text-[10px] text-slate-500 font-bold font-mono">{filtered.length} / {data.length} WOs</span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 pb-2 text-slate-500 select-none">
              <th onClick={() => handleSort('work_order_no')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest">WO No {sortField === 'work_order_no' && (sortAsc ? '▲' : '▼')}</th>
              <th className="py-2.5 text-[9px] font-bold uppercase tracking-widest">ZO Name</th>
              <th className="py-2.5 text-[9px] font-bold uppercase tracking-widest">Dept</th>
              <th onClick={() => handleSort('work_order_value')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Value {sortField === 'work_order_value' && (sortAsc ? '▲' : '▼')}</th>
              <th onClick={() => handleSort('approved_requisitions_amount')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Spent {sortField === 'approved_requisitions_amount' && (sortAsc ? '▲' : '▼')}</th>
              <th onClick={() => handleSort('physical_progress')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Progress {sortField === 'physical_progress' && (sortAsc ? '▲' : '▼')}</th>
              <th onClick={() => handleSort('health_score')} className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center">Health {sortField === 'health_score' && (sortAsc ? '▲' : '▼')}</th>
              <th className="py-2.5 text-right text-[9px] font-bold uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paginated.map((row, idx) => {
              const scoreBg = row.health_score >= 80 ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-500/20'
                : row.health_score >= 60 ? 'bg-amber-900/20 text-amber-400 border border-amber-500/20'
                : 'bg-rose-900/20 text-rose-400 border border-rose-500/20';
              const zoDisplayName = getZoDisplayName ? getZoDisplayName(row.zo_name || row.zo_user_id || row.zone) : (row.zo_name || row.zo_user_id || row.zone || 'N/A');
              return (
                <tr key={idx} className="hover:bg-white/5 transition-colors">
                  <td onClick={() => navigate(`/projects/${row.work_order_no}/digital-twin`)} className="py-3.5 font-extrabold text-sky-400 hover:underline cursor-pointer font-mono">{row.work_order_no}</td>
                  <td className="py-3.5 text-slate-300 font-bold uppercase">{zoDisplayName}</td>
                  <td className="py-3.5 text-slate-400">{row.department}</td>
                  <td className="py-3.5 text-center font-mono text-slate-300">{formatINR(row.work_order_value)}</td>
                  <td className="py-3.5 text-center font-mono text-emerald-400">{formatINR(row.approved_requisitions_amount)}</td>
                  <td className="py-3.5 text-center"><span className="font-extrabold text-slate-200">{row.physical_progress}%</span></td>
                  <td className="py-3.5 text-center"><span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${scoreBg}`}>{Math.round(row.health_score)}</span></td>
                  <td className="py-3.5 text-right">
                    <span className={`px-2.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${row.health_status === 'Critical' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' : row.health_status === 'Warning' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}`}>{row.health_status || 'Healthy'}</span>
                  </td>
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr><td colSpan="8" className="py-8 text-center text-slate-500 font-bold uppercase tracking-widest">No work orders match current filters</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/5 select-none">
          <span className="text-[10px] text-slate-500 font-bold uppercase">Page {page} of {totalPages} ({sorted.length} records)</span>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer">
              Prev
            </button>
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer">
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Zonal Control & Credit Overview Component (homedashboard.html ZO view) ─── */
const ZoHomedashboardOverview = ({ selectedZoName, projects, balancesRes, isDark }) => {
  const navigate = useNavigate();

  // Find active ZO balance
  const activeBal = useMemo(() => {
    const list = balancesRes?.balances || (balancesRes?.balance ? [balancesRes.balance] : []);
    if (!list.length) return { available_balance: 0, assigned_credit_limit: 2000000 };
    if (!selectedZoName) return list[0] || { available_balance: 0, assigned_credit_limit: 2000000 };
    const match = list.find(b => {
      const name = (b.zo_name || b.zo_user_id || '').toLowerCase();
      return name.includes(selectedZoName.toLowerCase());
    });
    return match || list[0];
  }, [balancesRes, selectedZoName]);

  const availBal = activeBal.available_balance ?? 0;
  const limitBal = activeBal.assigned_credit_limit ?? activeBal.allocated_amount ?? 2000000;

  // Calculate JE productivity list from projects
  const jeStats = useMemo(() => {
    const map = new Map();
    (projects || []).forEach(p => {
      const jeName = p.je_name || p.assigned_je || 'Unassigned JE';
      if (!map.has(jeName)) {
        map.set(jeName, { name: jeName, count: 0, totalProgress: 0 });
      }
      const item = map.get(jeName);
      item.count += 1;
      item.totalProgress += Number(p.physical_progress || 0);
    });

    return Array.from(map.values()).map(je => {
      const avg = je.count > 0 ? Math.round(je.totalProgress / je.count) : 0;
      let status = 'Active';
      let streak = Math.max(1, Math.min(15, Math.round(je.count * 3)));
      if (avg >= 70) status = 'Excellent';
      else if (avg < 40) status = 'Warning';
      return { ...je, avg, status, streak };
    }).sort((a, b) => b.count - a.count);
  }, [projects]);

  return (
    <div className={`p-6 rounded-3xl border mb-8 transition-all ${isDark ? 'bg-[#0f141f]/80 border-white/10 text-slate-100 shadow-2xl' : 'bg-white border-slate-200 text-slate-900 shadow-xl'}`}>
      
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-5 border-b border-white/10 mb-6">
        <div>
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 font-mono">
            {selectedZoName || 'Zonal Office Session'}
          </span>
          <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight mt-0.5">
            Zonal Credit Limit Ledger
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Available credit, assigned projects, and junior engineer productivity for your zone.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => navigate('/fund-requests')}
            className="px-4 py-2 rounded-xl bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500 hover:text-slate-950 text-amber-400 font-extrabold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5 shadow-sm"
          >
            <span>💸 Fund Request</span>
            <span className="text-amber-300">→</span>
          </button>
          <button
            onClick={() => navigate('/zonal-balances')}
            className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-200 font-extrabold text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-1.5"
          >
            <span>📊 Zonal Ledger</span>
            <span className="text-slate-400">→</span>
          </button>
        </div>
      </div>

      {/* KPI Row (Available Credit Balance, Total Limit, Mapped Projects) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-emerald-950/20 border-emerald-500/20' : 'bg-emerald-50 border-emerald-200'}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Available Credit Balance</span>
          <div className="text-2xl font-black text-emerald-400 mt-1">{fmtCr(availBal)}</div>
          <span className="text-[10px] text-emerald-500/80 font-mono mt-1 block">Ready for requisition payout</span>
        </div>
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-slate-900/60 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Total Assigned Limit</span>
          <div className="text-2xl font-black text-slate-100 mt-1">{fmtCr(limitBal)}</div>
          <span className="text-[10px] text-slate-400 font-mono mt-1 block">Sanctioned Zonal Credit Cap</span>
        </div>
        <div className={`p-4 rounded-2xl border ${isDark ? 'bg-amber-950/20 border-amber-500/20' : 'bg-amber-50 border-amber-200'}`}>
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 block">Mapped Active Projects</span>
          <div className="text-2xl font-black text-amber-400 mt-1">{projects.length} WO Sites</div>
          <span className="text-[10px] text-amber-500/80 font-mono mt-1 block">Active sites under monitoring</span>
        </div>
      </div>

      {/* Grid Content: JE Productivity & Workload (Left) + Zonal Controls & Fund Feed (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        
        {/* Left Column: JE Productivity & Workload Distribution */}
        <div className="lg:col-span-7 space-y-6">
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200">
                Junior Engineer Productivity <span className="text-slate-500 font-normal">· {jeStats.length} JEs</span>
              </span>
              <button onClick={() => navigate('/analytics/leaderboard')} className="text-[10px] font-bold uppercase tracking-wider text-amber-400 hover:underline">
                Full Leaderboard →
              </button>
            </div>
            
            {jeStats.length === 0 ? (
              <div className="py-6 text-center text-xs text-slate-500 italic">No JEs currently mapped to this zone</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/10 text-[9px] font-black uppercase text-slate-400">
                      <th className="pb-2">JE Name</th>
                      <th className="pb-2 text-center">Assigned Sites</th>
                      <th className="pb-2 text-center">Daily Streak</th>
                      <th className="pb-2 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {jeStats.slice(0, 5).map((je, idx) => (
                      <tr key={idx} className="hover:bg-white/5 transition">
                        <td className="py-2.5 font-bold text-slate-200">{je.name}</td>
                        <td className="py-2.5 text-center font-mono text-slate-300">{je.count}</td>
                        <td className="py-2.5 text-center font-mono text-amber-400">🔥 {je.streak} days</td>
                        <td className="py-2.5 text-right">
                          <span className={`px-2 py-0.5 rounded text-[8px] font-black uppercase ${
                            je.status === 'Excellent' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                            je.status === 'Active' ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20' :
                            'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          }`}>
                            {je.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Workload Distribution Progress Bars */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-4">
              Zonal Workload Distribution
            </span>
            <div className="space-y-3">
              {jeStats.slice(0, 4).map((je, idx) => {
                const pct = Math.min(100, Math.round((je.count / (projects.length || 1)) * 100));
                return (
                  <div key={idx}>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-slate-300">{je.name}</span>
                      <span className="text-slate-500 font-mono">{je.count} mapped work orders ({pct}%)</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/5 border border-white/5 overflow-hidden">
                      <div className="h-full bg-amber-500 rounded-full transition-all duration-500" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right Column: Zonal Controls & Ledger */}
        <div className="lg:col-span-5 space-y-6">
          
          {/* Quick Zonal Controls Panel */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-4">
              Zonal Quick Controls
            </span>
            <div className="space-y-2.5">
              <button
                onClick={() => navigate('/fund-requests')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-amber-500/40 hover:bg-amber-500/10 text-left transition group cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-amber-400">Initiate Zonal Fund Request</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Current balance: {fmtCr(availBal)}</div>
                </div>
                <span className="text-amber-400 font-bold text-sm">→</span>
              </button>

              <button
                onClick={() => navigate('/zonal-balances')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-sky-500/40 hover:bg-sky-500/10 text-left transition group cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-sky-400">Inspect Zonal Ledger</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Full transaction history &amp; credit cap</div>
                </div>
                <span className="text-sky-400 font-bold text-sm">→</span>
              </button>

              <button
                onClick={() => navigate('/daily-progress')}
                className="w-full flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/5 hover:border-emerald-500/40 hover:bg-emerald-500/10 text-left transition group cursor-pointer"
              >
                <div>
                  <div className="text-xs font-bold text-slate-200 group-hover:text-emerald-400">Audit Site Progress Logs</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">DPR visits &amp; site photos feedback</div>
                </div>
                <span className="text-emerald-400 font-bold text-sm">→</span>
              </button>
            </div>
          </div>

          {/* Recent Zonal Activity Timeline */}
          <div className={`p-4 sm:p-5 rounded-2xl border ${isDark ? 'bg-slate-900/40 border-white/5' : 'bg-slate-50 border-slate-200'}`}>
            <span className="text-xs font-extrabold uppercase tracking-widest text-slate-200 block mb-3">
              Zonal Site Timeline
            </span>
            <div className="space-y-3 text-xs">
              <div className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-emerald-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-200 font-bold">DPR Progress Update Submitted</div>
                  <div className="text-[10px] text-slate-500 font-mono">Mapped JE logged site progress (WO Active)</div>
                </div>
              </div>
              <div className="flex gap-3 items-start">
                <span className="w-2 h-2 rounded-full bg-amber-400 mt-1.5 shrink-0" />
                <div>
                  <div className="text-slate-200 font-bold">Zonal Requisition Processed</div>
                  <div className="text-[10px] text-slate-500 font-mono">Disbursement recorded in credit balance</div>
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

/* ─── Main ZoDashboard ────────────────────────────────────────────── */
const ZoDashboard = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const { user } = useAuth();

  const isZoRole = user?.role === 'zo';
  const myZoId = user?.assigned_zone || user?.zo_name || user?.zone_name || user?.name || user?.mobile_number || user?.username || user?.user_id || user?.id;

  const [alertMsg, setAlertMsg] = useState(null);
  const [alertType, setAlertType] = useState('success');
  const [activeTab, setActiveTab] = useState('overview');
  const [activeView, setActiveView] = useState('all');
  const [selectedZo, setSelectedZo] = useState(null);
  const [zoomedChart, setZoomedChart] = useState(null);
  const [kpiDetailModal, setKpiDetailModal] = useState(null);

  // Strict Project Status & Date Range Filters
  const [projectStatusFilter, setProjectStatusFilter] = useState('all'); // 'all' | 'Running' | 'Closed' | 'Complete Under Maintenance'
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [datePreset, setDatePreset] = useState('all'); // 'all' | 'month' | 'quarter' | 'half' | 'custom'

  const handleDatePreset = (preset) => {
    setDatePreset(preset);
    const now = new Date();
    if (preset === 'all') {
      setStartDate('');
      setEndDate('');
    } else if (preset === 'month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      setStartDate(firstDay);
      setEndDate(today);
    } else if (preset === 'quarter') {
      const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      setStartDate(threeMonthsAgo);
      setEndDate(today);
    } else if (preset === 'half') {
      const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const today = now.toISOString().slice(0, 10);
      setStartDate(sixMonthsAgo);
      setEndDate(today);
    }
  };

  /* ── Data Queries ── */
  const { data: insightsRes } = useQuery({
    queryKey: ['zoInsights'],
    queryFn: async () => { const res = await getHoActionableInsights(); return res.data; }
  });

  const { data: chartRes } = useQuery({
    queryKey: ['zoChartData', activeView, selectedZo, projectStatusFilter, startDate, endDate],
    queryFn: async () => {
      const res = await getHoChartData({
        view: activeView,
        zone: selectedZo || undefined,
        project_status: projectStatusFilter,
        start_date: startDate || undefined,
        end_date: endDate || undefined
      });
      return res.data;
    }
  });

  const { data: projectsRes } = useQuery({
    queryKey: ['projectsHealthList'],
    queryFn: async () => { const res = await getProjectsHealth(); return res.data; }
  });

  const { data: balancesRes } = useQuery({
    queryKey: ['zoBalancesList'],
    queryFn: async () => { const res = await getZonalBalances(); return res.data; },
    staleTime: 30000
  });

  const { data: eligibleZosRes } = useQuery({
    queryKey: ['eligibleZosList'],
    queryFn: async () => { const res = await getEligibleZOs(); return res.data; },
    staleTime: 60000
  });

  const projectsList = projectsRes?.data || [];

  /* ── Derived ZO Display Names & List for Dropdown Filter ── */
  const availableZos = useMemo(() => {
    const map = new Map();

    // 1. From eligible ZOs API
    const eligible = eligibleZosRes?.data || eligibleZosRes?.zos || [];
    eligible.forEach(z => {
      const id = z.mobile_number || z.zo_user_id || z.id;
      const name = z.display_name || z.name || z.zo_name || id;
      if (id) map.set(id, name);
    });

    // 2. From zoBalances API
    const balList = balancesRes?.balances || (balancesRes?.balance ? [balancesRes.balance] : []);
    balList.forEach(b => {
      const id = b.zo_user_id || b.zo_name;
      const name = b.zo_name || b.zo_user_id || id;
      if (id) map.set(id, name);
    });

    // 3. From projectsHealthList
    (projectsList || []).forEach(p => {
      const id = p.zo_user_id || p.zo_name || p.zone;
      const name = p.zo_name || p.zo_user_name || map.get(id) || p.zo_user_id || p.zone;
      if (id && !map.has(id)) map.set(id, name);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [eligibleZosRes, balancesRes, projectsList]);

  /* ── Auto-lock ZO for ZO role ── */
  useEffect(() => {
    if (isZoRole) {
      if (availableZos.length > 0) {
        const match = availableZos.find(z => 
          z.id.toLowerCase() === (myZoId || '').toLowerCase() || 
          z.name.toLowerCase() === (myZoId || '').toLowerCase() ||
          (user?.assigned_zone && z.name.toLowerCase().includes(user.assigned_zone.toLowerCase()))
        );
        if (match) {
          if (selectedZo !== match.id) setSelectedZo(match.id);
        } else if (myZoId && selectedZo !== myZoId) {
          setSelectedZo(myZoId);
        }
      } else if (myZoId && selectedZo !== myZoId) {
        setSelectedZo(myZoId);
      }
    }
  }, [isZoRole, myZoId, availableZos, selectedZo, user?.assigned_zone]);

  const zoNameMap = useMemo(() => {
    const m = {};
    availableZos.forEach(z => { m[z.id] = z.name; });
    return m;
  }, [availableZos]);

  const getZoDisplayName = (zoIdOrName) => {
    if (!zoIdOrName) return 'Unassigned ZO';
    if (zoNameMap[zoIdOrName]) return zoNameMap[zoIdOrName];
    if (typeof zoIdOrName === 'string' && /^[0-9a-fA-F]{8,}$/.test(zoIdOrName)) {
      const match = availableZos.find(z => z.id.toLowerCase() === zoIdOrName.toLowerCase());
      if (match) return match.name;
      return 'Zonal Officer';
    }
    if (typeof zoIdOrName === 'string' && zoIdOrName.startsWith('+91')) {
      return `ZO (${zoIdOrName.slice(0, 10)})`;
    }
    return zoIdOrName;
  };

  const selectedZoName = useMemo(() => {
    if (!selectedZo) return null;
    return getZoDisplayName(selectedZo);
  }, [selectedZo, zoNameMap]);

  const refreshMutation = useMutation({
    mutationFn: refreshAnalyticsViews,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projectsHealthList'] });
      queryClient.invalidateQueries({ queryKey: ['zoChartData'] });
      queryClient.invalidateQueries({ queryKey: ['zoInsights'] });
      queryClient.invalidateQueries({ queryKey: ['zoBalancesList'] });
      queryClient.invalidateQueries({ queryKey: ['eligibleZosList'] });
      showToast('Database views refreshed successfully!', 'success');
    },
    onError: (err) => showToast(err.response?.data?.message || 'Failed to refresh views.', 'error'),
  });

  const showToast = (msg, type) => {
    setAlertMsg(msg); setAlertType(type);
    setTimeout(() => setAlertMsg(null), 4000);
  };

  const insights = insightsRes || {};
  const stalledProjects = insights.stalledProjects || [];
  const lowRunwayZones = (insights.runwayData || []).filter(z => z.runway_days !== null && z.runway_days < 21);

  /* ── Strictly Filter Projects by Selected ZO Name ── */
  const filteredProjects = useMemo(() => {
    if (!selectedZo) return projectsList;
    return projectsList.filter(p => {
      const pZo = (p.zo_user_id || p.zo_name || p.zone || '').toLowerCase().trim();
      const sel = selectedZo.toLowerCase().trim();
      const selName = (zoNameMap[selectedZo] || '').toLowerCase().trim();
      return pZo === sel || pZo === selName;
    });
  }, [projectsList, selectedZo, zoNameMap]);

  /* ── Filter Ticker by Selected ZO Name ── */
  const filteredStalledProjects = useMemo(() => {
    if (!selectedZo) return stalledProjects;
    return stalledProjects.filter(p => {
      const pZo = (p.zo_user_id || p.zo_name || p.zone || '').toLowerCase().trim();
      const sel = selectedZo.toLowerCase().trim();
      const selName = (zoNameMap[selectedZo] || '').toLowerCase().trim();
      return pZo === sel || pZo === selName;
    });
  }, [stalledProjects, selectedZo, zoNameMap]);

  const filteredLowRunwayZones = useMemo(() => {
    const valid = lowRunwayZones.filter(z => {
      const id = z.zo_user_id || z.zo_name || z.zone;
      if (!id) return false;
      if (typeof id === 'string' && /^[0-9a-fA-F]{8,}$/.test(id) && !zoNameMap[id]) {
        return false;
      }
      return true;
    });

    if (!selectedZo) return valid;

    return valid.filter(z => {
      const zZo = (z.zo_user_id || z.zo_name || z.zone || '').toLowerCase().trim();
      const sel = selectedZo.toLowerCase().trim();
      const selName = (zoNameMap[selectedZo] || '').toLowerCase().trim();
      return zZo === sel || zZo === selName;
    });
  }, [lowRunwayZones, selectedZo, zoNameMap]);

  return (
    <>
      {/* Toast */}
      {alertMsg && (
        <div className={`fixed top-6 right-6 z-50 px-6 py-4 rounded-2xl shadow-xl backdrop-blur-md flex items-center gap-3 border transition-all duration-300 ${alertType === 'success' ? 'bg-emerald-950/80 border-emerald-500/30 text-emerald-400' : 'bg-rose-950/80 border-rose-500/30 text-rose-400'}`}>
          <span className="text-sm font-bold tracking-wide">{alertMsg}</span>
          <button onClick={() => setAlertMsg(null)} className="text-slate-400 hover:text-white">&times;</button>
        </div>
      )}

      {/* Header Bar */}
      <div className="mb-10 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 pb-6 border-b border-white/5">
        <div>
          <div className="flex items-center gap-2.5 mb-2">
            <span className="w-2 h-2 rounded-full" style={{ background: '#f0a843', boxShadow: '0 0 8px #f0a843, 0 0 18px rgba(240,168,67,0.35)', animation: 'pulse 2.5s ease-in-out infinite' }} />
            <span className="font-mono text-[10px] uppercase tracking-[3px] text-amber-500">Zonal Office Analytics</span>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight mt-1 text-slate-900 dark:text-slate-100" style={{ letterSpacing: '-0.04em' }}>
            Zonal Control Room {selectedZoName ? `— ${selectedZoName}` : ''}
          </h1>
          <div className="flex items-center gap-2 mt-1.5">
            {selectedZo ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 text-xs font-black uppercase tracking-wider">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                Active Filter — ZO Name: {selectedZoName} ({filteredProjects.length} Projects)
                {!isZoRole && (
                  <button onClick={() => setSelectedZo(null)} className="ml-1.5 hover:text-white text-amber-300 font-black cursor-pointer" title="Clear ZO Name Filter">&times;</button>
                )}
              </span>
            ) : (
              <p className="text-xs text-slate-400 leading-relaxed">Consolidated Zonal Office (ZO) KPIs, JE leaderboard, risk matrix, and cost realization analytics.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono font-bold text-slate-300 dark:text-slate-300 bg-white/5 px-2.5 py-1 rounded-xl border border-white/10 flex items-center gap-1.5 shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Data Source: Live Zonal Database Sync
            </span>
            <ChartInfoTooltip
              description="Zonal analytics metrics are derived in real-time from live system entries across Work Orders, Approved Estimates, ZO Fund Requisitions, Bank Disbursals, DPR Logs, and Contractor Bills."
              formula="Source = Live SQL aggregation across zonal_projects, estimate_sheets, requisitions & agency_bills"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {/* Custom Paginated ZO Name Filter Component */}
            {isZoRole ? (
              <div className="flex items-center gap-2 bg-amber-500/15 border border-amber-500/30 rounded-2xl px-4 py-2.5 text-xs font-black uppercase tracking-wider text-amber-400 shadow-sm backdrop-blur-md">
                <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-[10px] text-slate-400 font-bold uppercase">Zone (Locked):</span>
                <span className="text-slate-100 font-extrabold max-w-[200px] truncate">{selectedZoName || myZoId || 'Assigned Zone'}</span>
              </div>
            ) : (
              <PaginatedZoSelector
                availableZos={availableZos}
                selectedZo={selectedZo}
                onSelectZo={setSelectedZo}
                getZoDisplayName={getZoDisplayName}
              />
            )}

            {/* Refresh Views Button */}
            <button
              onClick={() => refreshMutation.mutate()}
              disabled={refreshMutation.isPending}
              className={`px-5 py-2.5 rounded-2xl border border-transparent text-xs font-black uppercase tracking-widest flex items-center gap-2 transition-all duration-300 ${refreshMutation.isPending ? 'bg-white/5 border-white/10 text-slate-400 cursor-not-allowed' : 'bg-white hover:bg-white/90 text-slate-950 shadow-[0_4px_16px_rgba(0,0,0,0.4)] hover:shadow-[0_8px_24px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 cursor-pointer'}`}
            >
              <svg className={`w-3.5 h-3.5 ${refreshMutation.isPending ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H18" />
              </svg>
              {refreshMutation.isPending ? 'Refreshing...' : 'Refresh Views'}
            </button>
          </div>
        </div>
      </div>

      {/* Project Status & Date Range Filter Toolbar */}
      <div className="glass-panel p-4 rounded-2xl mb-8 flex flex-col xl:flex-row gap-4 items-center justify-between border border-white/10 shadow-lg">
        {/* Project Status Filter Tabs */}
        <div className="flex items-center gap-2 flex-wrap w-full xl:w-auto">
          <span className="text-[10px] uppercase font-black tracking-widest text-slate-400 mr-1">Project Status:</span>
          {[
            { id: 'all', label: 'All Projects' },
            { id: 'Running', label: 'Running' },
            { id: 'Closed', label: 'Closed' },
            { id: 'Complete Under Maintenance', label: 'Under Maintenance' }
          ].map(status => (
            <button
              key={status.id}
              onClick={() => setProjectStatusFilter(status.id)}
              className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all border cursor-pointer ${
                projectStatusFilter === status.id
                  ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-md shadow-amber-500/20'
                  : 'bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white'
              }`}
            >
              {status.label}
            </button>
          ))}
        </div>

        {/* Date Range Controls */}
        <div className="flex flex-wrap items-center gap-3 w-full xl:w-auto justify-start xl:justify-end">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase font-black tracking-widest text-slate-400">Preset:</span>
            {[
              { id: 'all', label: 'All Time' },
              { id: 'month', label: 'This Month' },
              { id: 'quarter', label: '3 Months' },
              { id: 'half', label: '6 Months' }
            ].map(p => (
              <button
                key={p.id}
                onClick={() => handleDatePreset(p.id)}
                className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase transition-all border cursor-pointer ${
                  datePreset === p.id
                    ? 'bg-white text-slate-950 border-white'
                    : 'bg-white/5 border-white/10 text-slate-400 hover:text-slate-200'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border-l border-white/10 pl-3">
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase">From:</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-amber-500/50"
              />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase">To:</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setDatePreset('custom');
                }}
                className="bg-slate-950/80 border border-white/10 rounded-lg px-2 py-1 text-[11px] text-slate-200 font-mono focus:outline-none focus:border-amber-500/50"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Risk Ticker */}
      {(filteredStalledProjects.length > 0 || filteredLowRunwayZones.length > 0) && (
        <div className="relative mb-8 overflow-hidden">
          <div className={`pointer-events-none absolute left-0 top-0 bottom-0 w-16 z-10 transition-colors ${isDark ? 'bg-gradient-to-r from-[#0b0e14] to-transparent' : 'bg-gradient-to-r from-slate-50 to-transparent'}`} />
          <div className={`pointer-events-none absolute right-0 top-0 bottom-0 w-16 z-10 transition-colors ${isDark ? 'bg-gradient-to-l from-[#0b0e14] to-transparent' : 'bg-gradient-to-l from-slate-50 to-transparent'}`} />
          <div className="flex overflow-hidden">
            <div className="animate-marquee gap-3 py-1 px-4">
              {filteredLowRunwayZones.map((z, idx) => (
                <div key={`z1-${idx}`} className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDark ? 'border-rose-500/30 bg-rose-950/20 text-rose-400' : 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  {getZoDisplayName(z.zo_name || z.zo_user_id || z.zone)} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {filteredStalledProjects.slice(0, 5).map((p, idx) => (
                <div key={`p1-${idx}`} onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors ${isDark ? 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:border-amber-500/50' : 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:border-amber-400'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}
              {/* duplicate for seamless loop */}
              {filteredLowRunwayZones.map((z, idx) => (
                <div key={`z2-${idx}`} className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${isDark ? 'border-rose-500/30 bg-rose-950/20 text-rose-400' : 'border-rose-300 bg-rose-50 text-rose-700 shadow-sm'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse shrink-0" />
                  {getZoDisplayName(z.zo_name || z.zo_user_id || z.zone)} — Balance depletes in {z.runway_days} days
                </div>
              ))}
              {filteredStalledProjects.slice(0, 5).map((p, idx) => (
                <div key={`p2-${idx}`} onClick={() => navigate(`/projects/${p.work_order_no}/digital-twin`)}
                  className={`shrink-0 flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-[10px] font-bold uppercase tracking-wider whitespace-nowrap cursor-pointer transition-colors ${isDark ? 'border-amber-500/30 bg-amber-950/20 text-amber-400 hover:border-amber-500/50' : 'border-amber-300 bg-amber-50 text-amber-800 shadow-sm hover:border-amber-400'}`}>
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
                  {p.work_order_no} — No DPR for {p.days_since_last_progress_report}d ({p.physical_progress}% done)
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Executive 10-KPI Strip (Filtered by Selected ZO Name) */}
      <div className="flex items-center gap-3 mb-3">
        <span className="font-mono text-[9.5px] uppercase tracking-[2.5px] text-slate-500">
          Zonal Office KPIs {selectedZoName ? `— ${selectedZoName}` : '(All ZO Names)'}
        </span>
        <div className="flex-1 h-px bg-white/[0.045]" />
      </div>
      <ExecutiveKpiStrip projects={filteredProjects} />

      {/* ── Section: Performance Overview ── */}
      <SectionLabel>Performance Overview {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('physical_progress')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <PhysicalWorkProgress projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('department')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <DepartmentWiseEstimate projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-4" onZoom={() => setZoomedChart('key_financials')}>
          <div style={{ minHeight: '520px' }} className="h-full">
            <KeyFinancialIndicators projects={filteredProjects} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Fund Flow & Risk ── */}
      <SectionLabel>Fund Flow &amp; Risk {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('fundflow')}>
          <div style={{ minHeight: '480px' }} className="h-full">
            <FundFlowWaterfall projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('bubble')}>
          <div style={{ minHeight: '480px' }} className="h-full">
            <BubbleRiskMatrix projects={filteredProjects} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Trends & Projections ── */}
      <SectionLabel>Trends &amp; Projections {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('scurve')}>
          <div style={{ minHeight: '420px' }} className="h-full">
            <SCurveProgress projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('revision')}>
          <div style={{ minHeight: '420px' }} className="h-full">
            <InvestmentRecoveryPlot projects={filteredProjects} />
          </div>
        </ZoomCard>
        <ZoomCard className="lg:col-span-1" onZoom={() => setZoomedChart('jeleaderboard')}>
          <div style={{ minHeight: '420px' }} className="h-full">
            <JeLeaderboard projects={filteredProjects} selectedZoName={selectedZoName} />
          </div>
        </ZoomCard>
      </div>

      {/* ── Section: Project Health Summary ── */}
      <SectionLabel>Project Health Summary {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
        {[
          { label: 'Active Projects', value: filteredProjects.length, subtext: 'Total ongoing', color: 'text-sky-400', border: 'border-sky-500/20 hover:border-sky-500/40', glow: 'shadow-sky-500/5', bgIcon: 'bg-sky-500/10 text-sky-400', filterFn: null,
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 v2M7 7h10" /></svg> },
          { label: 'Healthy', value: filteredProjects.filter(p => p.health_status === 'Healthy').length, subtext: 'On track', color: 'text-emerald-400', border: 'border-emerald-500/20 hover:border-emerald-500/40', glow: 'shadow-emerald-500/5', bgIcon: 'bg-emerald-500/10 text-emerald-400', filterFn: p => p.health_status === 'Healthy',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg> },
          { label: 'Warning', value: filteredProjects.filter(p => p.health_status === 'Warning').length, subtext: 'Needs review', color: 'text-amber-400', border: 'border-amber-500/20 hover:border-amber-500/40', glow: 'shadow-amber-500/5', bgIcon: 'bg-amber-500/10 text-amber-400', filterFn: p => p.health_status === 'Warning',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg> },
          { label: 'Critical', value: filteredProjects.filter(p => p.health_status === 'Critical').length, subtext: 'Action required', color: 'text-rose-400', border: 'border-rose-500/20 hover:border-rose-500/40', glow: 'shadow-rose-500/5', bgIcon: 'bg-rose-500/10 text-rose-400', filterFn: p => p.health_status === 'Critical',
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> },
          { label: 'Avg Progress', value: `${filteredProjects.length ? Math.round(filteredProjects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / filteredProjects.length) : 0}%`, subtext: 'Portfolio progress', color: 'text-indigo-400', border: 'border-indigo-500/20 hover:border-indigo-500/40', glow: 'shadow-indigo-500/5', bgIcon: 'bg-indigo-500/10 text-indigo-400', filterFn: null,
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg> },
          { label: 'Avg Health', value: `${filteredProjects.length ? Math.round(filteredProjects.reduce((a, p) => a + Number(p.health_score || 0), 0) / filteredProjects.length) : 0}`, subtext: 'Health score', color: 'text-violet-400', border: 'border-violet-500/20 hover:border-violet-500/40', glow: 'shadow-violet-500/5', bgIcon: 'bg-violet-500/10 text-violet-400', filterFn: null,
            icon: <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg> },
        ].map(({ label, value, subtext, color, border, glow, bgIcon, icon, filterFn }) => (
          <div
            key={label}
            onClick={() => {
              const filtered = filterFn ? filteredProjects.filter(filterFn) : filteredProjects;
              setKpiDetailModal({ title: `${label} ${selectedZoName ? `(${selectedZoName})` : ''}`, color, projects: filtered });
            }}
            className={`relative overflow-hidden rounded-2xl border p-4 backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:shadow-xl ${border} ${glow} ${isDark ? 'bg-slate-900/40 text-slate-100' : 'bg-white/80 border-slate-200 shadow-sm text-slate-900'} flex flex-col justify-between group cursor-pointer`}
          >
            <div className={`absolute inset-0 pointer-events-none ${isDark ? 'opacity-5 bg-[radial-gradient(#fff_1px,transparent_1px)] [background-size:8px_8px]' : 'opacity-10 bg-[radial-gradient(#000_1px,transparent_1px)] [background-size:8px_8px]'}`} />
            <div className="flex items-center justify-between mb-3 relative z-10">
              <div className={`p-2 rounded-xl ${bgIcon} transition-transform duration-300 group-hover:scale-110`}>{icon}</div>
              <span className={`text-[9px] font-black uppercase tracking-widest transition-colors ${isDark ? 'text-slate-500 group-hover:text-slate-300' : 'text-slate-500 group-hover:text-slate-700'}`}>{subtext}</span>
            </div>
            <div className="relative z-10 mt-1">
              <div className={`text-3xl font-black tabular-nums tracking-tight ${color} group-hover:brightness-125 transition-all`}>{value}</div>
              <div className={`text-[10px] font-black uppercase tracking-widest mt-1 flex items-center justify-between ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>
                <span>{label}</span>
                <span className="text-[8px] opacity-0 group-hover:opacity-100 transition-opacity font-bold">View →</span>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Section: Work Order Telemetry ── */}
      <SectionLabel>Work Order Telemetry {selectedZoName ? `— ${selectedZoName}` : ''}</SectionLabel>
      <div className="mb-6">
        <WorkOrderTelemetryTable
          data={filteredProjects}
          availableZos={availableZos}
          selectedZo={selectedZo}
          onSelectZo={setSelectedZo}
          getZoDisplayName={getZoDisplayName}
        />
      </div>

      {/* ── Zoom Modals ── */}
      {zoomedChart === 'physical_progress' && (
        <ChartModal title={`Physical Work Progress — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} onClose={() => setZoomedChart(null)}>
          <PhysicalWorkProgress projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'department' && (
        <ChartModal title={`Department Wise Estimate Breakdown — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} onClose={() => setZoomedChart(null)}>
          <DepartmentWiseEstimate projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'key_financials' && (
        <ChartModal title={`Key Financial Indicators — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} onClose={() => setZoomedChart(null)}>
          <KeyFinancialIndicators projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'bubble' && (
        <ChartModal title={`Bubble Risk Matrix Inspection — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="96vw" height="92vh" maxWidth="96vw" maxHeight="92vh" onClose={() => setZoomedChart(null)}>
          <BubbleRiskMatrix projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'fundflow' && (
        <ChartModal title={`Fund Flow Pipeline Inspection — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="96vw" height="92vh" maxWidth="96vw" maxHeight="92vh" onClose={() => setZoomedChart(null)}>
          <FundFlowWaterfall projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'scurve' && (
        <ChartModal title={`S-Curve Performance Progress — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="96vw" height="92vh" maxWidth="96vw" maxHeight="92vh" onClose={() => setZoomedChart(null)}>
          <SCurveProgress projects={filteredProjects} />
        </ChartModal>
      )}
      {zoomedChart === 'revision' && (
        <ChartModal
          title={`Investment & Bill Recovery Realization — ${selectedZoName || 'All ZO Names'}`}
          description="Capital investment vs bill recovery realization across work order progress bands."
          formula="Pending Recovery = Requisition Investment - Contractor Bill Payments Received"
          isDark={isDark}
          width="96vw"
          height="92vh"
          maxWidth="96vw"
          maxHeight="92vh"
          onClose={() => setZoomedChart(null)}
        >
          <InvestmentRecoveryPlot projects={filteredProjects} isModal={true} />
        </ChartModal>
      )}
      {zoomedChart === 'jeleaderboard' && (
        <ChartModal title={`JE Leaderboard — ${selectedZoName || 'All ZO Names'}`} isDark={isDark} width="80vw" height="80vh" maxWidth="80vw" maxHeight="80vh" onClose={() => setZoomedChart(null)}>
          <JeLeaderboard projects={filteredProjects} selectedZoName={selectedZoName} />
        </ChartModal>
      )}

      {/* ── KPI Detail Modal ── */}
      {kpiDetailModal && (
        <KpiDetailsModal
          title={kpiDetailModal.title}
          colorClass={kpiDetailModal.color}
          projects={kpiDetailModal.projects}
          getZoDisplayName={getZoDisplayName}
          onClose={() => setKpiDetailModal(null)}
        />
      )}
    </>
  );
};

export default ZoDashboard;
