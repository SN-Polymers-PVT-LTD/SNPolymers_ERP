import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { useTheme } from '../../ThemeContext';
import { buildDonutSlices } from '../utils/donutGeometry';
import { ChartInfoTooltip } from '../ui/ChartInfoTooltip';
import { fmtCr, formatINR } from '../utils/formatters';

const DEFAULT_COLORS = ['#3B82F6', '#10B981', '#8B5CF6', '#F97316', '#64748B', '#EF4444', '#14B8A6', '#EC4899', '#F59E0B'];

export const DepartmentWiseEstimateChart = ({ items = [], projects = [] }) => {
  const { isDark } = useTheme();
  const [hoveredDept, setHoveredDept] = useState(null);
  const [popoverPos, setPopoverPos] = useState({ x: 0, y: 0 });

  const normalizedItems = useMemo(() => {
    if (items && Array.isArray(items) && items.length > 0) {
      const total = items.reduce((a, i) => a + Number(i.amount || 0), 0) || 1;
      return items.map((item, idx) => ({
        department: item.department || item.name || 'General',
        amount: Number(item.amount || 0),
        count: item.count !== undefined ? Number(item.count) : undefined,
        percentage: item.percentage !== undefined ? Number(item.percentage) : Number(((Number(item.amount || 0) / total) * 100).toFixed(1)),
        color: item.color || DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
      }));
    }

    const pList = projects || [];
    const map = {};
    const countMap = {};
    pList.forEach((p) => {
      const d = p.department || 'General';
      map[d] = (map[d] || 0) + Number(p.work_order_value || 0);
      countMap[d] = (countMap[d] || 0) + 1;
    });

    const total = Object.values(map).reduce((a, v) => a + v, 0) || 1;
    return Object.entries(map).map(([dept, amount], idx) => ({
      department: dept,
      amount,
      count: countMap[dept],
      percentage: Number(((amount / total) * 100).toFixed(1)),
      color: DEFAULT_COLORS[idx % DEFAULT_COLORS.length],
    }));
  }, [items, projects]);

  const totalAmount = useMemo(() => {
    return normalizedItems.reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
  }, [normalizedItems]);

  const donutSlices = useMemo(() => {
    return buildDonutSlices(normalizedItems, 85, 55, 100);
  }, [normalizedItems]);

  const handleMouseEnter = (e, item) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const popoverHeight = 100;
    const popoverWidth = 240;

    let yPos = rect.top - popoverHeight - 10;
    if (yPos < 20) {
      yPos = Math.min(window.innerHeight - popoverHeight - 20, rect.bottom + 10);
    }
    let xPos = Math.min(window.innerWidth - popoverWidth - 20, Math.max(20, rect.left - 20));

    setPopoverPos({ x: xPos, y: yPos });
    setHoveredDept(item);
  };

  const handleMouseMove = (e) => {
    if (hoveredDept) {
      const popoverHeight = 100;
      const popoverWidth = 240;

      let yPos = e.clientY - popoverHeight - 15;
      if (yPos < 20) {
        yPos = Math.min(window.innerHeight - popoverHeight - 20, e.clientY + 20);
      }
      let xPos = Math.min(window.innerWidth - popoverWidth - 20, Math.max(20, e.clientX - 50));

      setPopoverPos({ x: xPos, y: yPos });
    }
  };

  return (
    <div className="chart-panel h-full flex flex-col justify-between p-4 sm:p-5 relative" onMouseMove={handleMouseMove}>
      <div className="flex justify-between items-start mb-3 shrink-0">
        <div>
          <h3
            className="chart-title text-base sm:text-lg font-extrabold tracking-tight"
            style={{ color: isDark ? '#60A5FA' : '#1E3A8A' }}
          >
            Department Wise Work Order Value
          </h3>
          <p className="chart-subtitle text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Breakdown of work order values across operational departments
          </p>
        </div>
        <ChartInfoTooltip
          description="Distribution of total work order value allocated across operational departments."
          formula="Dept Share % = (Sum of Work Order Values in Dept / Total Portfolio WO Value) × 100"
        />
      </div>

      <div className="flex flex-col items-center justify-center gap-4 my-auto py-2">
        {/* Donut Graphic with Center Text */}
        <div className="relative w-44 h-44 sm:w-48 sm:h-48 shrink-0 mx-auto flex items-center justify-center">
          <svg viewBox="0 0 200 200" className="w-full h-full drop-shadow-md">
            {donutSlices.map((slice, idx) => (
              <g
                key={idx}
                className="transition-all duration-300 hover:opacity-90 cursor-pointer group"
                onMouseEnter={(e) => handleMouseEnter(e, slice)}
                onMouseLeave={() => setHoveredDept(null)}
              >
                <path
                  d={slice.pathData}
                  fill={slice.color}
                  stroke={isDark ? '#0f172a' : '#ffffff'}
                  strokeWidth="2.5"
                  style={{
                    transform: hoveredDept?.department === slice.department ? 'scale(1.04)' : 'scale(1)',
                    transformOrigin: '100px 100px',
                  }}
                />
              </g>
            ))}
          </svg>

          {/* Center Label inside donut */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center p-4">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total WO Value
            </span>
            <span className="text-sm sm:text-base font-extrabold tracking-tight text-slate-900 dark:text-slate-100 font-mono mt-0.5">
              {fmtCr(totalAmount)}
            </span>
          </div>
        </div>

        {/* 2-Column Grid Legend Index */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 w-full pt-2 border-t border-slate-200 dark:border-white/5">
          {normalizedItems.map((item, idx) => (
            <div
              key={idx}
              className={`flex items-center justify-between gap-2 text-xs py-1.5 px-2.5 rounded-xl cursor-pointer transition-all ${
                hoveredDept?.department === item.department
                  ? 'bg-amber-500/15 border border-amber-500/30 scale-[1.02]'
                  : 'hover:bg-slate-500/10 border border-transparent'
              }`}
              onMouseEnter={(e) => handleMouseEnter(e, item)}
              onMouseLeave={() => setHoveredDept(null)}
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: item.color }} />
                <span
                  className={`font-bold text-xs truncate ${isDark ? 'text-slate-200' : 'text-slate-800'}`}
                  title={item.department}
                >
                  {item.department}
                </span>
              </div>
              <span className="text-slate-400 font-mono text-[10px] font-bold shrink-0">
                {item.percentage}%
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Dynamic Hover Popover via React Portal */}
      {hoveredDept &&
        ReactDOM.createPortal(
          <div
            className="fixed z-[99999] rounded-2xl shadow-2xl p-3.5 min-w-[220px] pointer-events-none transition-all duration-150 backdrop-blur-md"
            style={{
              top: popoverPos.y,
              left: popoverPos.x,
              backgroundColor: isDark ? 'rgba(15, 23, 42, 0.98)' : 'rgba(255, 255, 255, 0.98)',
              border: `1.5px solid ${hoveredDept.color}`,
              boxShadow: `0 20px 35px -5px rgba(0, 0, 0, 0.7), 0 8px 16px -6px ${hoveredDept.color}60`,
            }}
          >
            <div className="flex items-center gap-2 mb-1.5 border-b border-slate-200 dark:border-slate-700/60 pb-1.5">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: hoveredDept.color }} />
              <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100 uppercase tracking-wider">
                {hoveredDept.department}
              </span>
            </div>

            <div className="flex items-baseline justify-between gap-3 mt-1">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Work Order Value:
              </span>
              <span className="font-black text-sm font-mono text-amber-400">
                {fmtCr(hoveredDept.amount)}
              </span>
            </div>
            {hoveredDept.count !== undefined && (
              <div className="flex items-baseline justify-between gap-3 mt-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Total Work Orders:
                </span>
                <span className="font-bold text-xs font-mono text-sky-400">
                  {hoveredDept.count} {hoveredDept.count === 1 ? 'Work Order' : 'Work Orders'}
                </span>
              </div>
            )}
            <div className="flex items-baseline justify-between gap-3 mt-0.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Share of WO Value:
              </span>
              <span className={`font-bold text-xs font-mono ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>
                {hoveredDept.percentage}%
              </span>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};

export default DepartmentWiseEstimateChart;
