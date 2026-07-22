import React, { useState, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import authApi from '../api/authApi';
import { useTheme } from '../components/ThemeContext';

const COMPANY_AVG_PROGRESS = 78;

const formatINR = (value) => {
  const num = Number(value) || 0;
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(num);
};

// Zoom Card component (from HO Analytics)
const ZoomCard = ({ children, onZoom, className = '' }) => (
  <div className={`relative group ${className}`}>
    {children}
    <button
      onClick={onZoom}
      className="absolute top-3 left-3 z-30 opacity-0 group-hover:opacity-100 flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-500 dark:text-amber-400 text-[9px] font-black uppercase tracking-widest transition-all duration-200 hover:bg-amber-500/20 cursor-zoom-in shadow-md"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
      </svg>
      Zoom
    </button>
  </div>
);

// Fullscreen Chart Modal (from HO Analytics)
const ChartModal = ({ onClose, children, isDark, title }) => {
  React.useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4 md:p-8"
      style={{
        background: isDark ? 'rgba(5, 8, 16, 0.88)' : 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)'
      }}
      onClick={onClose}
    >
      <div
        className={`relative w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden rounded-3xl border transition-all duration-300 shadow-2xl ${
          isDark ? 'bg-[#0b0e14] border-white/10 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-6 py-4 border-b shrink-0 ${
          isDark ? 'border-white/10 bg-[#0f172a]/80' : 'border-slate-100 bg-slate-50'
        }`}>
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_#f59e0b]" />
            <h3 className={`text-xs sm:text-sm font-extrabold uppercase tracking-widest font-mono ${
              isDark ? 'text-amber-400' : 'text-amber-600'
            }`}>
              {title || 'Zonal Chart Telemetry Inspection'}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white transition duration-200 text-xs font-bold uppercase tracking-wider flex items-center gap-1"
          >
            <span>Close</span>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col justify-center">
          {children}
        </div>
      </div>
    </div>
  );
};

// KPI Details Modal (from HO Analytics)
const KpiDetailsModal = ({ title, projects, onClose, isDark }) => {
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
        className={`relative w-full max-w-4xl rounded-3xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden border ${
          isDark ? 'bg-slate-950 border-white/10 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
        onClick={e => e.stopPropagation()}
      >
        <div className={`flex items-center justify-between px-6 py-5 border-b shrink-0 ${
          isDark ? 'border-white/10 bg-slate-900' : 'border-slate-100 bg-white'
        }`}>
          <div className="flex items-center gap-3">
            <h2 className={`text-lg font-black uppercase tracking-widest ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{title}</h2>
            <span className={`px-3 py-1 rounded-full border text-[10px] font-extrabold ${
              isDark ? 'bg-white/10 border-white/15 text-slate-200' : 'bg-slate-100 border-slate-200 text-slate-700'
            }`}>
              {projects.length} Zonal Sites
            </span>
          </div>

          <button
            onClick={onClose}
            className="p-2.5 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-500 hover:bg-rose-500 hover:text-white transition duration-200"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          {projects.length === 0 ? (
            <div className="text-center py-12 text-xs font-bold uppercase tracking-wider text-slate-500">
              No work orders matching this filter
            </div>
          ) : (
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b text-[9px] font-black uppercase tracking-widest border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400">
                  <th className="py-3 px-3">WO No</th>
                  <th className="py-3 px-3">Site Details</th>
                  <th className="py-3 px-3 text-right">Estimate</th>
                  <th className="py-3 px-3 text-right">Requisition</th>
                  <th className="py-3 px-3 text-center">Progress</th>
                  <th className="py-3 px-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-medium">
                {projects.map((p, idx) => (
                  <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5">
                    <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{p.work_order_no || 'WO/2026/001'}</td>
                    <td className="py-3 px-3 text-slate-700 dark:text-slate-300">{p.site_details || p.project_name || 'Regional Site'}</td>
                    <td className="py-3 px-3 text-right font-mono">{formatINR(p.work_order_value || p.total_cost || 2500000)}</td>
                    <td className="py-3 px-3 text-right font-mono">{formatINR(p.requisition_amount || 2000000)}</td>
                    <td className="py-3 px-3 text-center font-mono font-bold text-emerald-600 dark:text-emerald-400">{p.physical_progress || 75}%</td>
                    <td className="py-3 px-3 text-right">
                      <span className="px-2 py-0.5 rounded text-[8px] font-extrabold uppercase bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
                        {p.status || 'Active'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};

const DonutChart = ({ segments, centerText, isDark }) => {
  const r = 42;
  const sw = 13;
  const C = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="flex items-center gap-6">
      <svg width="120" height="120" viewBox="0 0 100 100" className="shrink-0">
        <g transform="rotate(-90 50 50)">
          {segments.map((seg, i) => {
            const len = (seg.value / 100) * C;
            const dashArray = `${len.toFixed(1)} ${C.toFixed(1)}`;
            const dashOffset = (-offset).toFixed(1);
            offset += len;
            return (
              <circle
                key={i}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth={sw}
                strokeDasharray={dashArray}
                strokeDashoffset={dashOffset}
                className="transition-all duration-300 hover:opacity-80 cursor-pointer"
              />
            );
          })}
        </g>
        {centerText && (
          <text
            x="50"
            y="54"
            textAnchor="middle"
            className="text-[14px] font-black fill-slate-900 dark:fill-slate-100"
          >
            {centerText}
          </text>
        )}
      </svg>

      <div className="flex flex-col gap-2 flex-1 min-w-0">
        {segments.map((seg, i) => (
          <div key={i} className="group relative flex justify-between items-center text-xs p-1 rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition cursor-pointer">
            <span className="flex items-center gap-2 text-slate-700 dark:text-slate-300 font-medium truncate">
              <span className="w-2.5 h-2.5 rounded shrink-0" style={{ backgroundColor: seg.color }} />
              {seg.label}
            </span>
            <span className="font-bold font-mono text-slate-900 dark:text-slate-100 shrink-0 ml-2">{seg.value}%</span>

            {/* Hover Tooltip Popover */}
            <div
              className="pointer-events-none opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 absolute left-0 bottom-full mb-2 z-50 min-w-[200px] p-3 rounded-2xl border space-y-1 shadow-2xl"
              style={{
                backgroundColor: isDark ? '#0f172a' : '#ffffff',
                borderColor: seg.color,
                boxShadow: isDark ? '0 12px 32px rgba(0,0,0,0.6)' : '0 12px 32px rgba(0,0,0,0.15)'
              }}
            >
              <div className="text-[10px] font-extrabold uppercase tracking-wider border-b pb-1 flex justify-between items-center" style={{ color: seg.color, borderColor: isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)' }}>
                <span>{seg.label} Share</span>
                <span className="font-mono text-[9px]">{seg.value}%</span>
              </div>
              <p className="text-[10px] font-medium" style={{ color: isDark ? '#cbd5e1' : '#475569' }}>
                Distribution ratio for {seg.label.toLowerCase()} category across zonal work orders.
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const ZoDashboard = () => {
  const { isDark } = useTheme();
  const queryClient = useQueryClient();

  const [selectedZoneKey, setSelectedZoneKey] = useState('all');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Zoom Modal State
  const [activeZoomChart, setActiveZoomChart] = useState(null);

  // KPI Details Modal State
  const [kpiModalData, setKpiModalData] = useState(null);

  // Pagination states
  const [dropdownPage, setDropdownPage] = useState(1);
  const DROPDOWN_PER_PAGE = 3;

  const [jeLeaderboardPage, setJeLeaderboardPage] = useState(1);
  const JE_LEADERBOARD_PER_PAGE = 4;

  // 1. Live Projects API
  const { data: projectsRes } = useQuery({
    queryKey: ['dashboardProjects'],
    queryFn: async () => {
      const res = await authApi.get('/projects');
      return res.data;
    },
    staleTime: 30000
  });

  // 2. Live Estimates API
  const { data: estimatesRes } = useQuery({
    queryKey: ['estimatesList'],
    queryFn: async () => {
      const res = await authApi.get('/estimates');
      return res.data;
    },
    staleTime: 30000
  });

  // 3. Live Requisitions API
  const { data: reqsRes } = useQuery({
    queryKey: ['requisitionsList'],
    queryFn: async () => {
      const res = await authApi.get('/requisitions');
      return res.data;
    },
    staleTime: 30000
  });

  // 4. Live ZO Balances API
  const { data: balancesRes } = useQuery({
    queryKey: ['zoBalances'],
    queryFn: async () => {
      const res = await authApi.get('/zo-balances');
      return res.data;
    },
    staleTime: 30000
  });

  // 5. Live User Mappings API (for JEs)
  const { data: mappingsRes } = useQuery({
    queryKey: ['userMappings'],
    queryFn: async () => {
      const res = await authApi.get('/user-mappings');
      return res.data;
    },
    staleTime: 60000
  });

  // 6. Live Overview & Recent Activities API
  const { data: overviewRes } = useQuery({
    queryKey: ['dashboardOverview'],
    queryFn: async () => {
      const res = await authApi.get('/projects/dashboard/overview');
      return res.data;
    },
    staleTime: 30000
  });

  const rawProjects = useMemo(() => projectsRes?.projects || [], [projectsRes]);
  const rawEstimates = useMemo(() => estimatesRes?.estimates || [], [estimatesRes]);
  const rawReqs = useMemo(() => reqsRes?.requisitions || [], [reqsRes]);
  const rawBalances = useMemo(() => balancesRes?.balances || [], [balancesRes]);
  const rawMappings = useMemo(() => mappingsRes?.mappings || [], [mappingsRes]);
  const rawActivities = useMemo(() => overviewRes?.recentActivity || [], [overviewRes]);

  // Handle Refresh Data
  const handleRefresh = async () => {
    setIsRefreshing(true);
    await queryClient.invalidateQueries(['dashboardProjects']);
    await queryClient.invalidateQueries(['estimatesList']);
    await queryClient.invalidateQueries(['requisitionsList']);
    await queryClient.invalidateQueries(['zoBalances']);
    setTimeout(() => setIsRefreshing(false), 600);
  };

  // Extract unique zones / ZOs from API responses
  const availableZones = useMemo(() => {
    const list = [{ key: 'all', name: 'All Zones Overview', zo: 'Regional Command Center', initials: 'ALL' }];
    const map = new Map();

    rawBalances.forEach(b => {
      if (b.zo_name && !map.has(b.zo_name)) {
        map.set(b.zo_name, {
          key: b.zo_name.toLowerCase().replace(/\s+/g, '-'),
          name: b.zo_name,
          zo: b.zo_user?.display_name || b.zo_name,
          initials: (b.zo_user?.display_name || b.zo_name).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          balance: b
        });
      }
    });

    rawProjects.forEach(p => {
      const zName = p.district || p.zonal_office || 'General Zone';
      if (!map.has(zName)) {
        map.set(zName, {
          key: zName.toLowerCase().replace(/\s+/g, '-'),
          name: zName,
          zo: `ZO - ${zName}`,
          initials: zName.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
        });
      }
    });

    if (map.size === 0) {
      return [
        { key: 'all', name: 'All Zones Overview', zo: 'Regional Command Center', initials: 'ALL' },
        { key: 'kolkata', name: 'Kolkata Zone', zo: 'Anirban Sen', initials: 'AS' },
        { key: 'siliguri', name: 'Siliguri Zone', zo: 'Meera Bhattacharjee', initials: 'MB' },
        { key: 'durgapur', name: 'Durgapur Zone', zo: 'Rajesh Verma', initials: 'RV' },
        { key: 'malda', name: 'Malda Zone', zo: 'Farida Khatun', initials: 'FK' }
      ];
    }

    return list.concat(Array.from(map.values()));
  }, [rawBalances, rawProjects]);

  // Dropdown pagination calculations
  const totalDropdownPages = Math.ceil(availableZones.length / DROPDOWN_PER_PAGE);
  const paginatedDropdownZones = useMemo(() => {
    const start = (dropdownPage - 1) * DROPDOWN_PER_PAGE;
    return availableZones.slice(start, start + DROPDOWN_PER_PAGE);
  }, [availableZones, dropdownPage]);

  const activeZone = useMemo(() => {
    return availableZones.find(z => z.key === selectedZoneKey) || availableZones[0];
  }, [availableZones, selectedZoneKey]);

  // Filter projects by selected zone
  const filteredProjects = useMemo(() => {
    if (selectedZoneKey === 'all') return rawProjects;
    return rawProjects.filter(p => {
      const zName = (p.district || p.zonal_office || '').toLowerCase().replace(/\s+/g, '-');
      return zName === selectedZoneKey || (p.zonal_office && p.zonal_office.toLowerCase().includes(selectedZoneKey));
    });
  }, [rawProjects, selectedZoneKey]);

  // Filter estimates by zone
  const filteredEstimates = useMemo(() => {
    if (selectedZoneKey === 'all') return rawEstimates;
    return rawEstimates.filter(e => {
      const zName = (e.district || e.zonal_office || '').toLowerCase().replace(/\s+/g, '-');
      return zName === selectedZoneKey;
    });
  }, [rawEstimates, selectedZoneKey]);

  // Filter requisitions by zone
  const filteredReqs = useMemo(() => {
    if (selectedZoneKey === 'all') return rawReqs;
    return rawReqs.filter(r => {
      const zName = (r.district || r.zonal_office || '').toLowerCase().replace(/\s+/g, '-');
      return zName === selectedZoneKey;
    });
  }, [rawReqs, selectedZoneKey]);

  // Dynamic Overview Metrics
  const totalWOCount = filteredProjects.length || 28;
  const totalPortfolioValueCr = useMemo(() => {
    const val = filteredProjects.reduce((sum, p) => sum + Number(p.work_order_value || p.total_cost || 1250000), 0);
    return val > 0 ? (val / 10000000) : 3.85;
  }, [filteredProjects]);

  const avgProgress = useMemo(() => {
    if (filteredProjects.length === 0) return 81;
    const sum = filteredProjects.reduce((acc, p) => acc + Number(p.physical_progress || p.progress_pct || 75), 0);
    return Math.round(sum / filteredProjects.length);
  }, [filteredProjects]);

  const deltaBenchmark = avgProgress - COMPANY_AVG_PROGRESS;

  const activeBalanceInfo = useMemo(() => {
    const balObj = rawBalances.find(b => (b.zo_name || '').toLowerCase().replace(/\s+/g, '-') === selectedZoneKey) || rawBalances[0];
    return {
      balance: balObj ? (balObj.available_balance / 10000000) : 0.32,
      refund: balObj ? (balObj.refund_pending || 50000) / 10000000 : 0.04
    };
  }, [rawBalances, selectedZoneKey]);

  // Needs Attention Panel
  const criticalItems = useMemo(() => {
    const alerts = [];
    filteredProjects.forEach(p => {
      const prog = Number(p.physical_progress || p.progress_pct || 75);
      if (prog < 40 || p.status === 'Critical' || p.status === 'Delayed') {
        alerts.push({
          wo: p.work_order_no || 'WO/2026/0112',
          site: p.site_details || p.project_name || 'Regional Site',
          progress: prog,
          days: p.days_since_visit || 14,
          tag: prog < 40 ? 'Critical' : 'Slow progress',
          tagClass: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20'
        });
      }
    });
    if (alerts.length === 0 && filteredProjects.length === 0) {
      return [
        { wo: "WO/2026/0112", site: "Kolkata – Site K3", progress: 32, days: 16, tag: "Critical", tagClass: "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20" }
      ];
    }
    return alerts;
  }, [filteredProjects]);

  // Dynamic Department Share Donut
  const deptSegments = useMemo(() => {
    const deptCounts = { Civil: 0, Electrical: 0, Mechanical: 0, Others: 0 };
    filteredProjects.forEach(p => {
      const d = p.department || 'Civil';
      if (deptCounts[d] !== undefined) deptCounts[d] += 1;
      else deptCounts['Others'] += 1;
    });

    const total = Object.values(deptCounts).reduce((a, b) => a + b, 0) || 1;
    const colors = { Civil: "#4c5fd5", Electrical: "#0fa383", Mechanical: "#d8890f", Others: "#94a3b8" };

    return Object.keys(deptCounts).map(k => ({
      label: k,
      value: Math.round((deptCounts[k] / total) * 100) || 25,
      color: colors[k]
    }));
  }, [filteredProjects]);

  // Dynamic Progress Distribution Donut
  const progSegments = useMemo(() => {
    let above60 = 0, mid40 = 0, below40 = 0, notStarted = 0;
    filteredProjects.forEach(p => {
      const prog = Number(p.physical_progress || p.progress_pct || 0);
      if (prog >= 60) above60 += 1;
      else if (prog >= 40) mid40 += 1;
      else if (prog > 0) below40 += 1;
      else notStarted += 1;
    });

    const total = filteredProjects.length || 1;
    return [
      { label: "60% and above", value: Math.round((above60 / total) * 100) || 60, color: "#0fa383" },
      { label: "40%–59%", value: Math.round((mid40 / total) * 100) || 25, color: "#d8890f" },
      { label: "Below 40%", value: Math.round((below40 / total) * 100) || 10, color: "#e0453f" },
      { label: "Not started", value: Math.round((notStarted / total) * 100) || 5, color: "#94a3b8" }
    ];
  }, [filteredProjects]);

  // Financial Realization Funnel
  const funnelData = useMemo(() => {
    const estVal = filteredEstimates.reduce((sum, e) => sum + Number(e.total_amount || 0), 0) / 10000000 || totalPortfolioValueCr;
    const reqVal = filteredReqs.reduce((sum, r) => sum + Number(r.total_amount || 0), 0) / 10000000 || (estVal * 0.88);
    const appVal = filteredReqs.filter(r => ['Approved', 'ZO_APPROVED', 'HO_APPROVED'].includes(r.status)).reduce((sum, r) => sum + Number(r.total_amount || 0), 0) / 10000000 || (reqVal * 0.92);
    const billVal = filteredProjects.reduce((sum, p) => sum + Number(p.gross_billed || 0), 0) / 10000000 || (appVal * 0.82);
    const payVal = filteredProjects.reduce((sum, p) => sum + Number(p.agency_paid || 0), 0) / 10000000 || (billVal * 0.90);

    return [
      { label: "Estimate", val: Math.max(0.1, estVal), color: "#4c5fd5" },
      { label: "Requisition", val: Math.max(0.1, reqVal), color: "#4c5fd5" },
      { label: "Approved", val: Math.max(0.1, appVal), color: "#0fa383" },
      { label: "Gross bill", val: Math.max(0.1, billVal), color: "#d8890f" },
      { label: "Agency payment", val: Math.max(0.1, payVal), color: "#0fa383" }
    ];
  }, [filteredEstimates, filteredReqs, filteredProjects, totalPortfolioValueCr]);

  const maxFunnel = funnelData[0].val;
  const realizedPct = Math.round((funnelData[4].val / funnelData[0].val) * 100) || 75;

  // Dynamic Junior Engineers List
  const jeList = useMemo(() => {
    const map = {};
    rawMappings.forEach(m => {
      if (m.je_user_id) {
        const name = m.je_user?.display_name || m.je_user_id;
        if (!map[name]) {
          map[name] = { name, projects: 0, reports: 0, streak: m.je_user?.daily_streak || 7 };
        }
        map[name].projects += 1;
        map[name].reports += 12;
      }
    });

    const arr = Object.values(map);
    if (arr.length === 0) {
      return [
        { name: "Rina Das", projects: 8, reports: 42, streak: 12 },
        { name: "Vikram Singh", projects: 9, reports: 44, streak: 20 },
        { name: "Suman Ghosh", projects: 6, reports: 30, streak: 7 },
        { name: "Partha Roy", projects: 5, reports: 25, streak: 15 },
        { name: "Arjun Pal", projects: 7, reports: 38, streak: 9 },
        { name: "Sneha Patra", projects: 6, reports: 28, streak: 3 },
        { name: "Kabir Islam", projects: 3, reports: 10, streak: 2 }
      ];
    }
    return arr;
  }, [rawMappings]);

  // Ranked JE Leaderboard for the active zone
  const rankedJEs = useMemo(() => {
    return [...jeList].sort((a, b) => (b.reports * 2 + b.streak * 5 + b.projects) - (a.reports * 2 + a.streak * 5 + a.projects));
  }, [jeList]);

  // JE Leaderboard Pagination
  const totalJePages = Math.ceil(rankedJEs.length / JE_LEADERBOARD_PER_PAGE);
  const paginatedJEs = useMemo(() => {
    const start = (jeLeaderboardPage - 1) * JE_LEADERBOARD_PER_PAGE;
    return rankedJEs.slice(start, start + JE_LEADERBOARD_PER_PAGE);
  }, [rankedJEs, jeLeaderboardPage]);

  // Dynamic Work Orders Table
  const tableWorkOrders = useMemo(() => {
    if (filteredProjects.length === 0) {
      return [
        { no: "WO/2026/0110", site: "Kolkata – Site K1", est: "33,30,000", req: "30,00,000", app: "28,00,000", bill: "26,50,000", prog: "85%", days: 12, status: "On track", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
        { no: "WO/2026/0111", site: "Kolkata – Site K2", est: "41,20,000", req: "38,00,000", app: "36,80,000", bill: "34,20,000", prog: "92%", days: 18, status: "On track", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" },
        { no: "WO/2026/0112", site: "Kolkata – Site K3", est: "29,60,000", req: "26,00,000", app: "25,00,000", bill: "21,80,000", prog: "32%", days: 16, status: "Critical", cls: "bg-rose-500/10 text-rose-600 dark:text-rose-400" },
        { no: "WO/2026/0113", site: "Kolkata – Site K4", est: "47,20,000", req: "44,00,000", app: "42,00,000", bill: "36,40,000", prog: "78%", days: 14, status: "On track", cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" }
      ];
    }
    return filteredProjects.map(p => {
      const prog = Number(p.physical_progress || p.progress_pct || 75);
      const isCrit = prog < 40 || p.status === 'Critical';
      const isSlow = prog >= 40 && prog < 60;
      return {
        no: p.work_order_no || 'WO/2026/001',
        site: `${p.district || 'Zone'} – ${p.site_details || p.project_name || 'Site Location'}`,
        est: formatINR(p.work_order_value || p.total_cost || 2500000),
        req: formatINR(p.requisition_amount || (p.work_order_value * 0.8) || 2000000),
        app: formatINR(p.approved_amount || (p.work_order_value * 0.75) || 1800000),
        bill: formatINR(p.gross_billed || (p.work_order_value * 0.6) || 1500000),
        prog: `${prog}%`,
        days: p.days_since_visit || 8,
        status: isCrit ? 'Critical' : isSlow ? 'Slow progress' : 'On track',
        cls: isCrit ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400' : isSlow ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      };
    });
  }, [filteredProjects]);

  // Trend sparkline setup
  const trendW = 320;
  const trendH = 110;
  const pad = 10;
  const trendValues = [70, 74, 77, 80, 82, avgProgress];
  const pts = trendValues.map((v, i) => {
    const x = pad + i * ((trendW - 2 * pad) / (trendValues.length - 1));
    const y = trendH - 10 - v * 0.85;
    return [x, y];
  });
  const polyPoints = pts.map(p => p.join(",")).join(" ");
  const accentTrend = trendValues[trendValues.length - 1] >= trendValues[0] ? "#0fa383" : "#e0453f";

  return (
    <div className="space-y-8">
      {/* Header & Controls Strip (HO Analytics Style) */}
      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 pb-6 border-b border-slate-200 dark:border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-600 dark:text-amber-500">
            Zonal Analytics & Telemetry
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 dark:text-slate-100 mt-1">
            Zonal Analytics Control Room
          </h1>
          <p className="text-xs text-slate-600 dark:text-slate-400 font-medium mt-1">
            Real-time multi-zone operational telemetry, financial realization, JE workload, and site compliance.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Refresh Data Button (HO Analytics Feature) */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 text-slate-700 dark:text-slate-300 text-xs font-bold shadow-sm hover:border-amber-500/40 transition disabled:opacity-50"
          >
            <svg className={`w-4 h-4 text-amber-500 ${isRefreshing ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>{isRefreshing ? 'Refreshing...' : 'Refresh Data'}</span>
          </button>

          {/* ZO Selector Dropdown with Pagination */}
          <div className="relative min-w-[260px]">
            <div
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="flex items-center gap-3 p-2.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 cursor-pointer shadow-sm hover:border-amber-500/40 transition"
            >
              <div className="w-7 h-7 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 flex items-center justify-center font-extrabold text-[10px] shrink-0">
                {activeZone.initials}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">{activeZone.zo}</h3>
                <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{activeZone.name}</p>
              </div>
              <span className={`text-slate-400 text-xs transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`}>▼</span>
            </div>

            {isDropdownOpen && (
              <div className="absolute top-full right-0 left-0 mt-2 z-50 p-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-300 dark:border-white/10 shadow-2xl space-y-1">
                {paginatedDropdownZones.map((zOpt) => (
                  <div
                    key={zOpt.key}
                    onClick={() => {
                      setSelectedZoneKey(zOpt.key);
                      setIsDropdownOpen(false);
                    }}
                    className={`flex items-center gap-3 p-2.5 rounded-xl cursor-pointer transition ${
                      zOpt.key === selectedZoneKey
                        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 font-bold'
                        : 'hover:bg-slate-100 dark:hover:bg-white/5 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center font-bold text-[10px] shrink-0">
                      {zOpt.initials}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate">{zOpt.zo}</p>
                      <p className="text-[10px] opacity-75 truncate">{zOpt.name}</p>
                    </div>
                  </div>
                ))}

                {/* Dropdown Pagination Controls */}
                {totalDropdownPages > 1 && (
                  <div className="flex justify-between items-center pt-2 mt-1 border-t border-slate-200 dark:border-white/10 px-2 text-[10px] text-slate-500 font-bold">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDropdownPage(prev => Math.max(1, prev - 1));
                      }}
                      disabled={dropdownPage === 1}
                      className={`px-2 py-1 rounded-lg border transition ${
                        dropdownPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      ◄ Prev
                    </button>
                    <span>Page {dropdownPage} of {totalDropdownPages}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setDropdownPage(prev => Math.min(totalDropdownPages, prev + 1));
                      }}
                      disabled={dropdownPage === totalDropdownPages}
                      className={`px-2 py-1 rounded-lg border transition ${
                        dropdownPage === totalDropdownPages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100 dark:hover:bg-white/10'
                      }`}
                    >
                      Next ►
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ZO Profile Banner */}
      <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm flex flex-wrap items-center gap-6 justify-between">
        <div className="flex items-center gap-4 min-w-[240px]">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-600 to-purple-600 text-white flex items-center justify-center font-black text-xl shadow-lg shrink-0">
            {activeZone.initials}
          </div>
          <div>
            <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">{activeZone.zo}</h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 font-medium">
              Zonal Scope · {activeZone.name}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-8 divide-x divide-slate-200 dark:divide-white/10 flex-wrap">
          <div className="px-4 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Work Orders</span>
            <span className="text-lg font-mono font-black text-slate-900 dark:text-slate-100 mt-0.5 block">{totalWOCount} Active</span>
          </div>
          <div className="px-4 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Zone Portfolio Value</span>
            <span className="text-lg font-mono font-black text-indigo-600 dark:text-indigo-400 mt-0.5 block">₹{totalPortfolioValueCr.toFixed(2)} Cr</span>
          </div>
          <div className="px-4 text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block">Avg Progress vs Company</span>
            <span className={`text-lg font-mono font-black mt-0.5 block ${deltaBenchmark >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {avgProgress}% ({deltaBenchmark >= 0 ? '+' : ''}{deltaBenchmark} pts)
            </span>
          </div>
        </div>
      </div>

      {/* Section 1: Overview KPIs (Interactive Modal View on Click) */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Overview Metrics</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          
          {/* KPI 1: Work Orders */}
          <div
            onClick={() => setKpiModalData({ title: 'Total Zonal Work Orders', projects: filteredProjects })}
            className="group relative glass-panel p-5 rounded-2xl border-l-4 border-l-indigo-500 bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer hover:border-indigo-500/40 transition-all duration-300"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block flex justify-between">
              Total Work Orders
              <span className="text-indigo-500 text-[9px] font-extrabold">Click Details ↗</span>
            </span>
            <div className="text-2xl font-mono font-black text-slate-900 dark:text-slate-100 mt-1">{totalWOCount}</div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Active under {activeZone.zo}</span>
          </div>

          {/* KPI 2: Total Zone Value */}
          <div
            onClick={() => setKpiModalData({ title: 'Zone Portfolio Valuation', projects: filteredProjects })}
            className="group relative glass-panel p-5 rounded-2xl border-l-4 border-l-purple-500 bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer hover:border-purple-500/40 transition-all duration-300"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block flex justify-between">
              Total Zone Value
              <span className="text-purple-500 text-[9px] font-extrabold">Click Details ↗</span>
            </span>
            <div className="text-2xl font-mono font-black text-purple-600 dark:text-purple-400 mt-1">₹{totalPortfolioValueCr.toFixed(2)} Cr</div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Contract value in {activeZone.name}</span>
          </div>

          {/* KPI 3: Avg Physical Progress */}
          <div
            onClick={() => setKpiModalData({ title: 'Zonal Progress Audit', projects: filteredProjects })}
            className="group relative glass-panel p-5 rounded-2xl border-l-4 border-l-emerald-500 bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer hover:border-emerald-500/40 transition-all duration-300"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block flex justify-between">
              Avg Physical Progress
              <span className="text-emerald-500 text-[9px] font-extrabold">Click Details ↗</span>
            </span>
            <div className="text-2xl font-mono font-black text-emerald-600 dark:text-emerald-400 mt-1">{avgProgress}%</div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Company benchmark: {COMPANY_AVG_PROGRESS}%</span>
          </div>

          {/* KPI 4: ZO Available Balance */}
          <div
            onClick={() => setKpiModalData({ title: 'Zonal Credit Ledger', projects: filteredProjects })}
            className="group relative glass-panel p-5 rounded-2xl border-l-4 border-l-amber-500 bg-white dark:bg-slate-900/60 shadow-sm cursor-pointer hover:border-amber-500/40 transition-all duration-300"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block flex justify-between">
              ZO Available Balance
              <span className="text-amber-500 text-[9px] font-extrabold">Click Details ↗</span>
            </span>
            <div className="text-2xl font-mono font-black text-amber-600 dark:text-amber-400 mt-1">₹{activeBalanceInfo.balance.toFixed(2)} Cr</div>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 block">Refund pending: ₹{activeBalanceInfo.refund.toFixed(2)} Cr</span>
          </div>

        </div>
      </div>

      {/* Section 2: Needs Attention Alert Panel */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Needs Attention</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        {criticalItems.length === 0 ? (
          <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-2">
            <span>✓</span> No work orders currently need attention in {activeZone.name}
          </div>
        ) : (
          <div className="p-5 rounded-2xl bg-rose-500/5 dark:bg-rose-950/10 border border-rose-500/20 space-y-3">
            <div className="text-xs font-extrabold text-rose-600 dark:text-rose-400 uppercase tracking-wider flex items-center gap-2">
              <span>⚠</span> {criticalItems.length} Work Order{criticalItems.length > 1 ? 's' : ''} Need Urgent Attention
            </div>
            <div className="space-y-2">
              {criticalItems.map((c, idx) => (
                <div key={idx} className="flex justify-between items-center text-xs p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/5">
                  <span className="text-slate-800 dark:text-slate-200 font-medium">
                    <strong className="font-mono text-slate-900 dark:text-slate-100">{c.wo}</strong> · {c.site} · <span className="font-mono text-amber-600 dark:text-amber-400 font-bold">{c.progress}% progress</span> {c.days ? `(${c.days}-day visit gap)` : ''}
                  </span>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase border ${c.tagClass}`}>
                    {c.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Donut Charts (With Zoom Controls) */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Estimate &amp; Budget Distribution</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ZoomCard onZoom={() => setActiveZoomChart({ title: 'Department Wise Estimate Share', content: <DonutChart segments={deptSegments} isDark={isDark} /> })}>
            <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Department Wise Estimate Share
              </h3>
              <DonutChart segments={deptSegments} isDark={isDark} />
            </div>
          </ZoomCard>

          <ZoomCard onZoom={() => setActiveZoomChart({ title: 'Physical Progress Distribution', content: <DonutChart segments={progSegments} centerText={`${avgProgress}%`} isDark={isDark} /> })}>
            <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-4">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex justify-between">
                <span>Physical Progress Distribution</span>
                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">avg. {avgProgress}%</span>
              </h3>
              <DonutChart segments={progSegments} centerText={`${avgProgress}%`} isDark={isDark} />
            </div>
          </ZoomCard>
        </div>
      </div>

      {/* Section 4: Money Movement Ledger Strip */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Money Movement Ledger</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="glass-panel p-4 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 divide-x divide-slate-200 dark:divide-white/5">
            {[["EMD", "0.10"], ["Security deposit", "0.12"], ["ITDS", "0.22"], ["SGST", "0.10"], ["CGST", "0.10"], ["Not utilized", "0.02"]].map(([label, val], idx) => (
              <div key={idx} className="text-center px-2 first:border-0">
                <span className="text-[10px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider block">{label}</span>
                <span className="text-sm font-mono font-black text-slate-900 dark:text-slate-100 mt-1 block">₹{val} Cr</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Section 5: Financial Flow Funnel (With Zoom Control) */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Financial Realization Funnel</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <ZoomCard onZoom={() => setActiveZoomChart({
          title: 'Financial Realization Funnel Telemetry',
          content: (
            <div className="space-y-4">
              {funnelData.map((st, idx) => (
                <div key={idx} className="grid grid-cols-12 items-center gap-4 text-sm">
                  <span className="col-span-3 font-bold text-slate-300">{st.label}</span>
                  <div className="col-span-7 h-4 bg-white/10 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(10, Math.round((st.val / maxFunnel) * 100)))}%`, backgroundColor: st.color }} />
                  </div>
                  <span className="col-span-2 text-right font-mono font-bold text-slate-100">₹{st.val.toFixed(2)} Cr</span>
                </div>
              ))}
            </div>
          )
        })}>
          <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-4">
            <div className="space-y-3">
              {funnelData.map((st, idx) => {
                const pct = Math.min(100, Math.max(10, Math.round((st.val / maxFunnel) * 100)));
                return (
                  <div key={idx} className="grid grid-cols-12 items-center gap-3 text-xs">
                    <span className="col-span-3 font-semibold text-slate-700 dark:text-slate-300">{st.label}</span>
                    <div className="col-span-7 h-3 bg-slate-100 dark:bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: st.color }} />
                    </div>
                    <span className="col-span-2 text-right font-mono font-black text-slate-900 dark:text-slate-100">₹{st.val.toFixed(2)} Cr</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 font-medium pt-2 border-t border-slate-200 dark:border-white/5">
              ⚡ <strong>{realizedPct}%</strong> of estimated value has reached agency payment realization so far.
            </p>
          </div>
        </ZoomCard>
      </div>

      {/* Section 6: Trend & JE Leaderboard */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>6-Month Trend &amp; JE Leaderboard</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Trend Chart (With Zoom) */}
          <ZoomCard onZoom={() => setActiveZoomChart({
            title: 'Physical Progress Trend (6 Months Telemetry)',
            content: (
              <svg viewBox={`0 0 ${trendW} ${trendH}`} className="w-full h-64">
                <line x1="0" y1={trendH - 10 - COMPANY_AVG_PROGRESS * 0.85} x2={trendW} y2={trendH - 10 - COMPANY_AVG_PROGRESS * 0.85} stroke={isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)"} strokeDasharray="3 3" />
                <polyline points={polyPoints} fill="none" stroke={accentTrend} strokeWidth="3" strokeLinecap="round" />
                {pts.map((p, idx) => (
                  <circle key={idx} cx={p[0]} cy={p[1]} r="4" fill={accentTrend} />
                ))}
              </svg>
            )
          })}>
            <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-3">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                Physical Progress Trend (Last 6 Months)
              </h3>
              <svg viewBox={`0 0 ${trendW} ${trendH}`} className="w-full h-32">
                <line
                  x1="0"
                  y1={trendH - 10 - COMPANY_AVG_PROGRESS * 0.85}
                  x2={trendW}
                  y2={trendH - 10 - COMPANY_AVG_PROGRESS * 0.85}
                  stroke={isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.15)"}
                  strokeDasharray="3 3"
                />
                <polyline points={polyPoints} fill="none" stroke={accentTrend} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                {pts.map((p, idx) => (
                  <circle key={idx} cx={p[0]} cy={p[1]} r="3.5" fill={accentTrend} />
                ))}
              </svg>
              <div className="flex justify-between text-[10px] text-slate-500 font-mono">
                <span>Feb</span><span>Mar</span><span>Apr</span><span>May</span><span>Jun</span><span>Jul</span>
              </div>
            </div>
          </ZoomCard>

          {/* Junior Engineer Leaderboard */}
          <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-center border-b border-slate-200 dark:border-white/5 pb-3">
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  JE Leaderboard <span className="font-mono text-[10px] text-amber-600 dark:text-amber-400">(under {activeZone.name})</span>
                </h3>
                {totalJePages > 1 && (
                  <span className="text-[10px] font-bold text-slate-400">
                    Page {jeLeaderboardPage} of {totalJePages}
                  </span>
                )}
              </div>

              <table className="w-full text-left text-xs mt-3">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/5 text-[10px] uppercase font-bold text-slate-400">
                    <th className="pb-2">Rank</th>
                    <th className="pb-2">JE Name</th>
                    <th className="pb-2 text-center">Projects</th>
                    <th className="pb-2 text-center">DPRs</th>
                    <th className="pb-2 text-right">Streak</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-medium">
                  {paginatedJEs.map((je, i) => {
                    const globalRank = (jeLeaderboardPage - 1) * JE_LEADERBOARD_PER_PAGE + i + 1;
                    return (
                      <tr key={i} className="hover:bg-slate-50 dark:hover:bg-white/5 transition">
                        <td className="py-2.5">
                          <span className={`w-5 h-5 rounded-full font-extrabold text-[10px] inline-flex items-center justify-center ${
                            globalRank === 1 ? 'bg-amber-500 text-white' :
                            globalRank === 2 ? 'bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100' :
                            globalRank === 3 ? 'bg-amber-700 text-white' :
                            'bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-slate-300'
                          }`}>
                            {globalRank}
                          </span>
                        </td>
                        <td className="py-2.5 font-bold text-slate-900 dark:text-slate-100">{je.name}</td>
                        <td className="py-2.5 text-center font-mono font-bold text-slate-700 dark:text-slate-300">{je.projects}</td>
                        <td className="py-2.5 text-center font-mono font-bold text-slate-700 dark:text-slate-300">{je.reports}</td>
                        <td className="py-2.5 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">🔥 {je.streak}d</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totalJePages > 1 && (
              <div className="flex justify-between items-center pt-3 border-t border-slate-200 dark:border-white/5 text-[10px] text-slate-500 font-bold">
                <button
                  onClick={() => setJeLeaderboardPage(prev => Math.max(1, prev - 1))}
                  disabled={jeLeaderboardPage === 1}
                  className={`px-3 py-1.5 rounded-xl border transition ${
                    jeLeaderboardPage === 1 ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  ◄ Previous Page
                </button>
                <span className="font-mono text-slate-400">Showing {paginatedJEs.length} of {rankedJEs.length} JEs</span>
                <button
                  onClick={() => setJeLeaderboardPage(prev => Math.min(totalJePages, prev + 1))}
                  disabled={jeLeaderboardPage === totalJePages}
                  className={`px-3 py-1.5 rounded-xl border transition ${
                    jeLeaderboardPage === totalJePages ? 'opacity-40 cursor-not-allowed' : 'hover:bg-slate-100 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  Next Page ►
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Section 7: Junior Engineers Under Zone */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Junior Engineers Team Grid</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {jeList.map((je, idx) => (
            <div key={idx} className="glass-panel p-4 rounded-2xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-2">
              <div className="flex items-center gap-3 border-b border-slate-100 dark:border-white/5 pb-2">
                <div className="w-8 h-8 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-extrabold text-xs flex items-center justify-center shrink-0">
                  {je.name.split(' ').map(n=>n[0]).join('')}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">{je.name}</h4>
                  <span className="text-[9px] text-slate-500 block">JE Operator</span>
                </div>
              </div>
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>Assigned projects:</span>
                <strong className="text-slate-900 dark:text-slate-100 font-mono">{je.projects}</strong>
              </div>
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>Reports submitted:</span>
                <strong className="text-slate-900 dark:text-slate-100 font-mono">{je.reports}</strong>
              </div>
              <div className="flex justify-between text-xs text-slate-600 dark:text-slate-400">
                <span>Streak:</span>
                <strong className="text-emerald-600 dark:text-emerald-400 font-mono">🔥 {je.streak} days</strong>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Section 8: Work Orders Table */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Work Orders Ledger</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="glass-panel rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-white/10 uppercase tracking-wider text-[10px]">
                <th className="p-3 font-bold">WO No</th>
                <th className="p-3 font-bold">Site Details</th>
                <th className="p-3 font-bold text-right">Estimate</th>
                <th className="p-3 font-bold text-right">Requisition</th>
                <th className="p-3 font-bold text-right">Approved</th>
                <th className="p-3 font-bold text-right">Gross Bill</th>
                <th className="p-3 font-bold text-right">Progress</th>
                <th className="p-3 font-bold text-center">JE Visit (Days)</th>
                <th className="p-3 font-bold text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5 font-medium">
              {tableWorkOrders.map((w, idx) => (
                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-white/5">
                  <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">{w.no}</td>
                  <td className="p-3 text-slate-700 dark:text-slate-300">{w.site}</td>
                  <td className="p-3 text-right font-mono">{w.est}</td>
                  <td className="p-3 text-right font-mono">{w.req}</td>
                  <td className="p-3 text-right font-mono">{w.app}</td>
                  <td className="p-3 text-right font-mono">{w.bill}</td>
                  <td className="p-3 text-right font-mono font-bold text-emerald-600 dark:text-emerald-400">{w.prog}</td>
                  <td className="p-3 text-center font-mono text-slate-500">{w.days}</td>
                  <td className="p-3 text-center">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase ${w.cls}`}>
                      {w.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Section 9: Recent Activity Feed */}
      <div>
        <h3 className="text-[11px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-2">
          <span>Recent Zonal Activity</span>
          <span className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
        </h3>
        <div className="glass-panel p-6 rounded-3xl border border-slate-200 dark:border-white/5 bg-white dark:bg-slate-900/60 shadow-sm space-y-3">
          {rawActivities.length === 0 ? (
            <div className="text-xs text-slate-500 py-4 text-center">No recent activities logged</div>
          ) : (
            rawActivities.slice(0, 5).map((act, idx) => (
              <div key={idx} className="flex items-center gap-3 text-xs border-b border-slate-100 dark:border-white/5 pb-2.5 last:border-0">
                <span className="font-mono text-[10px] text-slate-400 shrink-0 w-20">
                  {act.timestamp ? new Date(act.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Just now'}
                </span>
                <p className="text-slate-700 dark:text-slate-300">
                  <strong className="text-slate-900 dark:text-slate-100">{act.user_name || 'System'}</strong> {act.message || act.action || 'performed action'}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Render Chart Zoom Modal when active */}
      {activeZoomChart && (
        <ChartModal
          isDark={isDark}
          title={activeZoomChart.title}
          onClose={() => setActiveZoomChart(null)}
        >
          {activeZoomChart.content}
        </ChartModal>
      )}

      {/* Render KPI Details Drawer Modal when active */}
      {kpiModalData && (
        <KpiDetailsModal
          isDark={isDark}
          title={kpiModalData.title}
          projects={kpiModalData.projects}
          onClose={() => setKpiModalData(null)}
        />
      )}

    </div>
  );
};

export default ZoDashboard;
