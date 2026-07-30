import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../../ThemeContext';
import { formatINR } from '../utils/formatters';
import { exportProjectsToExcel } from '../../../utils/exportHelpers';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';

/* ─── Inner Paginated ZO Name Selector Component ──────────────────────── */
export const PaginatedZoSelector = ({ availableZos, selectedZo, onSelectZo, getZoDisplayName }) => {
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
    if (!q) return availableZos || [];
    return (availableZos || []).filter((z) => z.name.toLowerCase().includes(q) || z.id.toLowerCase().includes(q));
  }, [availableZos, search]);

  const totalPages = Math.ceil(filteredZos.length / pageSize) || 1;
  const pagedZos = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredZos.slice(start, start + pageSize);
  }, [filteredZos, page, pageSize]);

  const selectedName = selectedZo && getZoDisplayName ? getZoDisplayName(selectedZo) : selectedZo || 'All ZO Names (Entire Portfolio)';

  return (
    <div className="relative inline-block" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/30 hover:border-amber-500/50 rounded-2xl px-4 py-2.5 text-xs font-black uppercase tracking-wider text-amber-400 shadow-sm backdrop-blur-md transition-all cursor-pointer focus:outline-none focus:ring-1 focus:ring-amber-500/50"
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
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              className={`w-full border rounded-xl px-3 py-2 text-xs focus:outline-none focus:border-amber-500/50 ${isDark ? 'bg-slate-950 border-white/10 text-slate-200 placeholder-slate-500' : 'bg-slate-50 border-slate-200 text-slate-900 placeholder-slate-400'}`}
            />
          </div>

          <div
            onClick={() => {
              onSelectZo(null);
              setIsOpen(false);
            }}
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
            {pagedZos.map((z) => {
              const isSelected = selectedZo === z.id || selectedZo === z.name;
              return (
                <div
                  key={z.id}
                  onClick={() => {
                    onSelectZo(z.id);
                    setIsOpen(false);
                  }}
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
              <span className="text-slate-400 font-bold">
                Pg {page} of {totalPages} ({filteredZos.length} ZOs)
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                  className="px-2.5 py-1 rounded-lg border border-white/10 hover:bg-white/5 disabled:opacity-30 text-slate-300 font-bold uppercase cursor-pointer"
                >
                  Prev
                </button>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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

/* ─── Main WorkOrderTelemetryTable Component ───────────────────────────── */
export const WorkOrderTelemetryTable = ({
  data = [],
  onRowNavigate = null,
  selectedZone = null,
  onSelectZone = null,
  availableZos = null,
  selectedZo = null,
  onSelectZo = null,
  getZoDisplayName = null,
}) => {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [sortField, setSortField] = useState('health_score');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(1);
  const rowsPerPage = 5;

  const pList = data || [];

  // Filter list
  const filtered = useMemo(() => {
    return pList.filter((p) => {
      const q = search.toLowerCase().trim();
      const matchSearch =
        !q ||
        (p.work_order_no || '').toLowerCase().includes(q) ||
        (p.site_details || '').toLowerCase().includes(q) ||
        (p.department || '').toLowerCase().includes(q) ||
        (p.zo_name || p.zo_user_id || p.zone || '').toLowerCase().includes(q) ||
        (p.district || '').toLowerCase().includes(q);

      let matchZone = true;
      if (availableZos !== null && selectedZo !== null && selectedZo !== undefined) {
        matchZone =
          !selectedZo ||
          (p.zo_user_id || p.zo_name || p.zone || '').toLowerCase().trim() === selectedZo.toLowerCase().trim();
      } else if (selectedZone !== null && selectedZone !== undefined) {
        matchZone =
          !selectedZone ||
          (p.zone || p.zo_name || '').toLowerCase().trim() === selectedZone.toLowerCase().trim();
      }

      const matchDept =
        !deptFilter || (p.department || '').toLowerCase().trim() === deptFilter.toLowerCase().trim();

      return matchSearch && matchZone && matchDept;
    });
  }, [pList, search, availableZos, selectedZo, selectedZone, deptFilter]);

  // Unique departments and zones for filter dropdowns
  const depts = useMemo(() => {
    return Array.from(new Set(pList.map((p) => p.department).filter(Boolean))).sort();
  }, [pList]);

  const zones = useMemo(() => {
    return Array.from(new Set(pList.map((p) => p.zone || p.zo_name).filter(Boolean))).sort();
  }, [pList]);

  const getEffectiveHealthScore = (row) => {
    if (row.health_score !== undefined && row.health_score !== null && !isNaN(row.health_score)) {
      return Number(row.health_score);
    }
    const days = Number(row.days_since_last_progress_report || 0);
    const budgetUtil = Number(row.budget_utilization_pct || 0);
    return Math.min(100, Math.max(0, Math.round(100 - (days * 2) - budgetUtil)));
  };

  // Stable sort list
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      let aVal, bVal;
      if (sortField === 'health_score') {
        aVal = getEffectiveHealthScore(a);
        bVal = getEffectiveHealthScore(b);
      } else {
        aVal = a[sortField] ?? 0;
        bVal = b[sortField] ?? 0;
      }
      if (aVal < bVal) return sortAsc ? -1 : 1;
      if (aVal > bVal) return sortAsc ? 1 : -1;
      return 0;
    });
  }, [filtered, sortField, sortAsc]);

  // Pagination calculation
  const totalPages = Math.ceil(sorted.length / rowsPerPage) || 1;
  const paginated = useMemo(() => {
    const safePage = Math.min(page, totalPages);
    return sorted.slice((safePage - 1) * rowsPerPage, safePage * rowsPerPage);
  }, [sorted, page, totalPages, rowsPerPage]);

  const handleSort = (field) => {
    if (sortField === field) {
      setSortAsc(!sortAsc);
    } else {
      setSortField(field);
      setSortAsc(false);
    }
    setPage(1);
  };

  const handleExport = () => {
    if (sorted.length === 0) return;
    exportProjectsToExcel(sorted);
  };

  const handleNavigate = (row) => {
    if (onRowNavigate) {
      onRowNavigate(row);
    } else {
      navigate(`/projects/${row.work_order_no}/digital-twin`);
    }
  };

  const getSortAria = (field) => {
    if (sortField !== field) return 'none';
    return sortAsc ? 'ascending' : 'descending';
  };

  return (
    <div className="relative w-full glass-panel p-6 rounded-3xl border border-white/5 bg-slate-900/10 mb-8 text-xs">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-2">
          <ChartInfoTooltip
            description="High-density project tracking telemetry table with real-time health score metrics."
            formula="Health Score = 100 - (Days Since DPR × 2) - (Budget Overrun %)"
          />
          <div>
            <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">Work Order Telemetry</h3>
            <p className="text-[9px] text-slate-500 uppercase font-black tracking-wider mt-1">
              High-density project tracking and performance telemetry
            </p>
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleExport}
            disabled={sorted.length === 0}
            className="px-3.5 py-2 rounded-xl bg-emerald-500 text-black text-[9px] font-black uppercase tracking-widest hover:bg-emerald-400 disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer focus:outline-none focus:ring-1 focus:ring-emerald-400"
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* Filters Toolbar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6 items-center">
        <input
          type="text"
          placeholder="Search work order or site..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 placeholder-slate-600 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-amber-500/50 transition"
        />

        <select
          value={deptFilter}
          onChange={(e) => {
            setDeptFilter(e.target.value);
            setPage(1);
          }}
          className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-amber-500/50 transition"
        >
          <option value="">All Departments</option>
          {depts.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        {/* Zone Selector: ZO Mode or HO Mode */}
        {availableZos !== null ? (
          <PaginatedZoSelector
            availableZos={availableZos}
            selectedZo={selectedZo}
            onSelectZo={(zoId) => {
              if (onSelectZo) onSelectZo(zoId);
              setPage(1);
            }}
            getZoDisplayName={getZoDisplayName}
          />
        ) : (
          <select
            value={selectedZone || ''}
            onChange={(e) => {
              if (onSelectZone) onSelectZone(e.target.value || null);
              setPage(1);
            }}
            className="bg-slate-900 border border-white/10 rounded-xl px-4 py-2 text-[10px] text-slate-300 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-amber-500/50 transition"
          >
            <option value="">All Zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center justify-between sm:justify-end gap-2">
          {(search || deptFilter || selectedZone || selectedZo) && (
            <button
              onClick={() => {
                setSearch('');
                setDeptFilter('');
                if (onSelectZone) onSelectZone(null);
                if (onSelectZo) onSelectZo(null);
                setPage(1);
              }}
              className="px-3 py-2 rounded-xl bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[9px] font-bold uppercase tracking-wider hover:bg-rose-500/20 transition cursor-pointer"
            >
              Reset Filters
            </button>
          )}
          <span className="text-[10px] text-slate-500 font-bold font-mono">
            {filtered.length} / {pList.length} WOs
          </span>
        </div>
      </div>

      {/* Grid Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="border-b border-white/5 pb-2 text-slate-500 select-none">
              <th
                tabIndex={0}
                role="columnheader"
                aria-sort={getSortAria('work_order_no')}
                onClick={() => handleSort('work_order_no')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSort('work_order_no')}
                className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest focus:outline-none focus:text-amber-400"
              >
                WO No {sortField === 'work_order_no' && (sortAsc ? '▲' : '▼')}
              </th>
              <th className="py-2.5 text-[9px] font-bold uppercase tracking-widest">
                {availableZos !== null ? 'ZO Name' : 'Zone'}
              </th>
              <th className="py-2.5 text-[9px] font-bold uppercase tracking-widest">Dept</th>
              <th
                tabIndex={0}
                role="columnheader"
                aria-sort={getSortAria('work_order_value')}
                onClick={() => handleSort('work_order_value')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSort('work_order_value')}
                className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center focus:outline-none focus:text-amber-400"
              >
                Value {sortField === 'work_order_value' && (sortAsc ? '▲' : '▼')}
              </th>
              <th
                tabIndex={0}
                role="columnheader"
                aria-sort={getSortAria('approved_requisitions_amount')}
                onClick={() => handleSort('approved_requisitions_amount')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSort('approved_requisitions_amount')}
                className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center focus:outline-none focus:text-amber-400"
              >
                Spent {sortField === 'approved_requisitions_amount' && (sortAsc ? '▲' : '▼')}
              </th>
              <th
                tabIndex={0}
                role="columnheader"
                aria-sort={getSortAria('physical_progress')}
                onClick={() => handleSort('physical_progress')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSort('physical_progress')}
                className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center focus:outline-none focus:text-amber-400"
              >
                Progress {sortField === 'physical_progress' && (sortAsc ? '▲' : '▼')}
              </th>
              <th
                tabIndex={0}
                role="columnheader"
                aria-sort={getSortAria('health_score')}
                onClick={() => handleSort('health_score')}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleSort('health_score')}
                className="py-2.5 cursor-pointer hover:text-white text-[9px] font-bold uppercase tracking-widest text-center focus:outline-none focus:text-amber-400"
              >
                Health {sortField === 'health_score' && (sortAsc ? '▲' : '▼')}
              </th>
              <th className="py-2.5 text-right text-[9px] font-bold uppercase tracking-widest">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {paginated.map((row, idx) => {
              const clampedScore = getEffectiveHealthScore(row);

              const scoreBg =
                clampedScore >= 80
                  ? 'bg-emerald-900/20 text-emerald-400 border border-emerald-500/20'
                  : clampedScore >= 60
                  ? 'bg-amber-900/20 text-amber-400 border border-amber-500/20'
                  : 'bg-rose-900/20 text-rose-400 border border-rose-500/20';

              const zoDisplayName = getZoDisplayName
                ? getZoDisplayName(row.zo_name || row.zo_user_id || row.zone)
                : row.zo_name || row.zo_user_id || row.zone || 'N/A';

              return (
                <tr key={idx} className="hover:bg-white/5 transition-colors">
                  <td
                    onClick={() => handleNavigate(row)}
                    className="py-3.5 font-extrabold text-sky-400 hover:underline cursor-pointer font-mono"
                  >
                    {row.work_order_no}
                  </td>
                  <td className="py-3.5 text-slate-300 font-bold uppercase">{zoDisplayName}</td>
                  <td className="py-3.5 text-slate-400">{row.department}</td>
                  <td className="py-3.5 text-center font-mono text-slate-300">{formatINR(row.work_order_value)}</td>
                  <td className="py-3.5 text-center font-mono text-emerald-400">
                    {formatINR(row.approved_requisitions_amount)}
                  </td>
                  <td className="py-3.5 text-center">
                    <span className="font-extrabold text-slate-200">{row.physical_progress}%</span>
                  </td>
                  <td className="py-3.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[9px] font-extrabold ${scoreBg}`}>{clampedScore}</span>
                  </td>
                  <td className="py-3.5 text-right">
                    <span
                      className={`px-2.5 py-0.5 rounded text-[8px] font-black uppercase tracking-wider ${
                        row.health_status === 'Critical'
                          ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          : row.health_status === 'Warning'
                          ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      }`}
                    >
                      {row.health_status || 'Healthy'}
                    </span>
                  </td>
                </tr>
              );
            })}
            {paginated.length === 0 && (
              <tr>
                <td colSpan="8" className="py-8 text-center text-slate-500 font-bold uppercase tracking-widest">
                  No work orders match current filters
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-6 pt-4 border-t border-white/5 select-none">
          <span className="text-[10px] text-slate-500 font-bold uppercase">
            Page {page} of {totalPages} ({sorted.length} records)
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >
              Prev
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 rounded-xl border border-white/10 hover:bg-white/5 disabled:opacity-40 disabled:cursor-not-allowed text-[10px] font-bold uppercase tracking-wider text-slate-300 transition cursor-pointer"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default WorkOrderTelemetryTable;
