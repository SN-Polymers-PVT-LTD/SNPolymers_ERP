import React, { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Button, Badge, Modal } from '../../components/ui';
import { CATEGORIES } from '../admin/employeeConstants';
import { getAttendanceCalendar } from '../../api/hrAttendanceApi';
import { getKolkataCurrentMonth } from '../../utils/dateUtils';

const factoryCategories = CATEGORIES.filter(c =>
  !['HO Staff', 'Projects Department Employees'].includes(c)
);

const CODE_CONFIG = {
  'P': { label: 'Present', variant: 'emerald', bg: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  'A': { label: 'Absent', variant: 'red', bg: 'bg-red-500/15 text-red-400 border-red-500/30' },
  'ML': { label: 'Medical Leave', variant: 'purple', bg: 'bg-purple-500/15 text-purple-400 border-purple-500/30' },
  'PL': { label: 'Paid Leave', variant: 'indigo', bg: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
  'UL': { label: 'Unpaid Leave', variant: 'amber', bg: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  'CO': { label: 'Compensatory Off', variant: 'blue', bg: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
  'MI': { label: 'Management Issue', variant: 'orange', bg: 'bg-orange-500/15 text-orange-400 border-orange-500/30' }
};

function formatKol(isoString) {
  if (!isoString) return '-';
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric', month: 'short', day: '2-digit',
      second: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    }).format(d);
  } catch {
    return isoString;
  }
}

export default function MonthlyAttendanceCalendar() {
  const [search, setSearch] = useSearchParams();

  const selectedCategory = search.get('employee_category') || factoryCategories[0];
  const selectedMonth = search.get('month') || getKolkataCurrentMonth();
  const selectedEmpId = search.get('employee_id') || '';

  const [selectedDayDetail, setSelectedDayDetail] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');

  const params = useMemo(() => ({
    employee_category: selectedCategory,
    month: selectedMonth,
    ...(selectedEmpId ? { employee_id: selectedEmpId } : {})
  }), [selectedCategory, selectedMonth, selectedEmpId]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['hr-attendance-calendar', params],
    queryFn: () => getAttendanceCalendar(params).then(r => r.data),
    staleTime: 60000
  });

  const updateFilters = (k, v) => {
    const next = new URLSearchParams(search);
    if (k === 'employee_category') next.delete('employee_id');
    if (v) next.set(k, v);
    else next.delete(k);
    setSearch(next);
  };

  const daysInMonth = data?.days_in_month || 31;
  const dayNumbers = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  // Group records by employee_id -> day -> record
  const recordsByEmpAndDay = useMemo(() => {
    const map = new Map();
    if (!data?.records) return map;
    for (const rec of data.records) {
      if (!map.has(rec.employee_id)) {
        map.set(rec.employee_id, new Map());
      }
      const dayNum = parseInt(rec.date.split('-')[2], 10);
      map.get(rec.employee_id).set(dayNum, rec);
    }
    return map;
  }, [data]);

  // Sheets by day number
  const sheetsByDay = useMemo(() => {
    const map = new Map();
    if (!data?.sheets) return map;
    for (const s of data.sheets) {
      const dayNum = parseInt(s.attendance_date.split('-')[2], 10);
      map.set(dayNum, s);
    }
    return map;
  }, [data]);

  // Filter employees
  const filteredEmployees = useMemo(() => {
    if (!data?.employees) return [];
    const employees = selectedEmpId ? data.employees.filter(e => e.id === selectedEmpId) : data.employees;
    if (!searchTerm.trim()) return employees;
    const term = searchTerm.toLowerCase();
    return employees.filter(e =>
      (e.employee_name && e.employee_name.toLowerCase().includes(term)) ||
      (e.employee_code && e.employee_code.toLowerCase().includes(term))
    );
  }, [data, searchTerm, selectedEmpId]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-white/5 pb-5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500">Factory Operations</span>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-100 mt-1">
            Monthly Attendance Calendar
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Review stored attendance and open daily sheets for corrections. Submitted and locked sheets remain read-only.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/factory-attendance">
            <Button variant="secondary" className="text-xs">
              Daily Attendance Sheet &rarr;
            </Button>
          </Link>
          <Button variant="secondary" onClick={() => refetch()} className="text-xs">
            🔄 Refresh
          </Button>
        </div>
      </div>

      {/* Filter Controls Bar */}
      <div className="p-4 bg-slate-900/60 border border-white/10 rounded-2xl backdrop-blur-sm grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 items-end">
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">Factory Category</label>
          <Select
            value={selectedCategory}
            onChange={(e) => updateFilters('employee_category', e.target.value)}
          >
            {factoryCategories.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">Month</label>
          <Input
            type="month"
            value={selectedMonth}
            onChange={(e) => updateFilters('month', e.target.value)}
          />
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">Filter by Specific Employee</label>
          <Select
            value={selectedEmpId}
            onChange={(e) => updateFilters('employee_id', e.target.value)}
          >
            <option value="">All Category Employees</option>
            {(data?.employees || []).map(e => (
              <option key={e.id} value={e.id}>
                {e.employee_code} - {e.employee_name} {e.active_status !== 'Active' ? `(${e.active_status})` : ''}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-xs font-bold text-slate-300 mb-1.5">Search Grid</label>
          <Input
            type="text"
            placeholder="Search code or name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Codes Legend & Fact Summary */}
      <div className="p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mr-1">Fact Codes:</span>
          {Object.entries(CODE_CONFIG).map(([code, cfg]) => (
            <span
              key={code}
              className={`px-2 py-0.5 rounded text-[11px] font-bold border ${cfg.bg}`}
              title={cfg.label}
            >
              {code} = {cfg.label}
            </span>
          ))}
          <span className="text-slate-500 text-[11px] ml-2">· = No finalized attendance yet; — = No employee row</span>
        </div>
        <div className="text-xs text-slate-400">
          Finalized Sheets: <span className="font-extrabold text-slate-200">{data?.sheets?.length || 0}</span> / {daysInMonth} days &bull; Roster Count: <span className="font-extrabold text-slate-200">{filteredEmployees.length}</span>
        </div>
      </div>

      {/* Main Calendar Grid */}
      <div className="bg-slate-900/60 border border-white/10 rounded-2xl overflow-hidden backdrop-blur-sm">
        {isLoading ? (
          <div className="p-16 text-center text-slate-400 animate-pulse">
            <p className="text-sm font-medium">Loading monthly attendance grid...</p>
          </div>
        ) : error ? (
          <div className="p-12 text-center text-red-400">
            <p className="text-sm font-bold">Failed to load attendance calendar.</p>
            <p className="text-xs text-slate-400 mt-1">{error.message || 'Check network connection or roles.'}</p>
          </div>
        ) : filteredEmployees.length === 0 ? (
          <div className="p-16 text-center text-slate-500 text-xs">
            No employees found for {selectedCategory} in {selectedMonth}.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-white/5 border-b border-white/10 text-slate-400 text-[10px] tracking-wider uppercase">
                  <th className="sticky left-0 bg-slate-900 z-10 py-3 px-3 min-w-[200px] border-r border-white/10">
                    Employee
                  </th>
                  {dayNumbers.map(d => {
                    const sheet = sheetsByDay.get(d);
                    const hasSheet = Boolean(sheet);
                    return (
                      <th
                        key={d}
                        className={`py-2 px-1 text-center font-bold min-w-[34px] border-r border-white/5 ${
                          hasSheet ? 'text-amber-400 bg-amber-500/5' : 'text-slate-500'
                        }`}
                        title={hasSheet ? 'Finalized Locked Sheet' : 'No finalized attendance yet'}
                      >
                        {d}
                        {hasSheet && (
                          <span className="block text-[9px] text-amber-500/80" aria-label="Locked">
                            L
                          </span>
                        )}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {filteredEmployees.map(emp => {
                  const empDays = recordsByEmpAndDay.get(emp.id) || new Map();

                  return (
                    <tr key={emp.id} className="hover:bg-white/[0.02] transition-colors">
                      <td className="sticky left-0 bg-slate-900 z-10 py-2.5 px-3 border-r border-white/10 whitespace-nowrap">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[11px] font-bold text-amber-400/90">{emp.employee_code}</span>
                          <span className="font-semibold text-slate-200">{emp.employee_name}</span>
                          {emp.active_status !== 'Active' && (
                            <span className="text-[9px] px-1 rounded bg-red-500/10 text-red-400 border border-red-500/20">
                              {emp.active_status}
                            </span>
                          )}
                        </div>
                      </td>

                      {dayNumbers.map(d => {
                        const rec = empDays.get(d);
                        const hasSheet = sheetsByDay.has(d);

                        if (!rec) {
                          return (
                            <td
                              key={d}
                              className="py-1 px-1 text-center text-slate-700 border-r border-white/5 select-none"
                              title={hasSheet ? 'No row for employee' : 'No finalized attendance yet'}
                            >
                              {hasSheet ? '—' : '·'}
                            </td>
                          );
                        }

                        const cfg = CODE_CONFIG[rec.code] || { bg: 'bg-slate-700/30 text-slate-400' };

                        return (
                          <td key={d} className="p-0.5 text-center border-r border-white/5">
                            <button
                              type="button"
                              onClick={() => setSelectedDayDetail(rec)}
                              className={`w-full h-7 rounded text-[11px] font-extrabold flex items-center justify-center transition-transform hover:scale-110 focus:outline-none focus:ring-1 focus:ring-amber-400 border ${cfg.bg}`}
                              title={`${rec.date} • ${rec.employee_name}: ${rec.attendance_status} (${rec.code}) • ${rec.sheet_status}`}
                            >
                              {rec.code}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Day Attendance Inspection Modal */}
      {selectedDayDetail && (
        <Modal
          isOpen={true}
          onClose={() => setSelectedDayDetail(null)}
          title={`Attendance Fact Detail: ${selectedDayDetail.date}`}
          subtitle={`${selectedDayDetail.employee_code} - ${selectedDayDetail.employee_name}`}
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Duty Date</span>
                <p className="text-slate-100 font-extrabold text-sm mt-0.5">{selectedDayDetail.date}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Status Code</span>
                <div className="mt-0.5">
                  <Badge variant={CODE_CONFIG[selectedDayDetail.code]?.variant || 'slate'} showDot>
                    {selectedDayDetail.code} - {selectedDayDetail.attendance_status}
                  </Badge>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Actual Hours</span>
                <p className="text-slate-100 font-bold text-sm mt-0.5">{selectedDayDetail.actual_hours}h</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">OT Hours</span>
                <p className="text-slate-100 font-bold text-sm mt-0.5">{selectedDayDetail.ot_hours}h</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Duty Type</span>
                <p className="text-slate-100 font-semibold mt-0.5">{selectedDayDetail.duty_type || 'Standard'}</p>
              </div>
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Holiday Pay</span>
                <p className="text-slate-100 font-semibold mt-0.5">
                  {selectedDayDetail.holiday_pay_eligible ? 'Eligible' : 'No'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 p-3 bg-white/5 rounded-xl border border-white/10">
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Entry Timestamp (IST)</span>
                <p className="text-slate-200 font-mono mt-0.5">{formatKol(selectedDayDetail.entry_timestamp)}</p>
              </div>
              <div>
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Exit Timestamp (IST)</span>
                <p className="text-slate-200 font-mono mt-0.5">{formatKol(selectedDayDetail.exit_timestamp)}</p>
              </div>
            </div>

            {selectedDayDetail.remarks && (
              <div className="p-3 bg-white/5 rounded-xl border border-white/10">
                <span className="text-[10px] text-slate-400 uppercase font-bold tracking-wider">Stored Remarks</span>
                <p className="text-slate-200 mt-0.5">{selectedDayDetail.remarks}</p>
              </div>
            )}

            <div className="pt-2 flex items-center justify-between border-t border-white/10">
              <span className="text-[11px] text-slate-400">
                Sheet Status: <strong>{selectedDayDetail.sheet_status}</strong>
              </span>
              <div className="flex gap-2">
                <Link
                  to={`/factory-attendance?date=${selectedDayDetail.date}&category=${encodeURIComponent(selectedCategory)}`}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition-colors"
                >
                  Open Daily Sheet &rarr;
                </Link>
                <Button variant="secondary" onClick={() => setSelectedDayDetail(null)} className="text-xs">
                  Close
                </Button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
