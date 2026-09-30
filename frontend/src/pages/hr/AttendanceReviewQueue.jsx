import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Input, Select, Button, Badge, Table, TableHeader, TableBody, TableRow, TableCell, Pagination } from '../../components/ui';
import { CATEGORIES } from '../admin/employeeConstants';
import { getAttendanceReviewQueue } from '../../api/hrAttendanceApi';

const categories = CATEGORIES.filter(c => !['HO Staff', 'Projects Department Employees'].includes(c));
const states = ['Submitted', 'Returned for Correction', 'Locked'];
const columns = [
  ['attendance_date', 'Date'],
  ['employee_category', 'Category'],
  ['roster', 'Roster'],
  ['present', 'Present'],
  ['absent', 'Absent'],
  ['leave_medical', 'Leave / Medical'],
  ['comp_off', 'Comp Off'],
  ['management_issue', 'Management Issue'],
  ['holiday_pay_eligible', 'Holiday Pay Eligible'],
  ['total_ot_hours', 'Total OT Hours'],
  ['submitted_by_name', 'Submitted By'],
  ['status', 'HO Review Status'],
  ['ho_remarks', 'HO Remarks']
];

function statusVariant(status) {
  if (status === 'Locked') return 'emerald';
  if (status === 'Returned for Correction') return 'red';
  if (status === 'Submitted') return 'amber';
  return 'slate';
}

export default function AttendanceReviewQueue() {
  const [search, setSearch] = useSearchParams();
  const page = Math.min(100000, Math.max(1, Number(search.get('page')) || 1));
  const filters = {
    page,
    limit: 20,
    status: states.includes(search.get('status')) ? search.get('status') : 'Submitted',
    ...Object.fromEntries(['from_date', 'to_date', 'employee_category'].filter(k => search.get(k)).map(k => [k, search.get(k)]))
  };
  if (search.get('status') === 'All') delete filters.status;

  const query = useQuery({
    queryKey: ['attendance-review-queue', filters],
    queryFn: () => getAttendanceReviewQueue(filters).then(r => r.data)
  });

  function change(key, value) {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete('page');
    setSearch(next);
  }

  return (
    <main className="space-y-6 pb-12 text-slate-200">
      {/* Page Title & Context */}
      <div className="border-b border-white/5 pb-4">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
          Head Office Operations · Attendance Review
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
          Attendance Review Queue
        </h1>
        <p className="text-xs text-slate-400 font-medium mt-1">
          Audit, approve, or return factory attendance rosters submitted by Factory Managers. Successful review locks attendance automatically.
        </p>
      </div>

      {/* Filter Toolbar Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Input
            type="date"
            label="From Date"
            value={filters.from_date || ''}
            onChange={e => change('from_date', e.target.value)}
          />
          <Input
            type="date"
            label="To Date"
            value={filters.to_date || ''}
            onChange={e => change('to_date', e.target.value)}
          />
          <Select
            label="Employee Category"
            value={filters.employee_category || ''}
            options={[{ value: '', label: 'All Categories' }, ...categories.map(value => ({ value, label: value }))]}
            onChange={e => change('employee_category', e.target.value)}
          />
          <Select
            label="Review Status"
            value={filters.status || 'All'}
            options={['All', ...states].map(value => ({ value, label: value }))}
            onChange={e => change('status', e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between pt-3 border-t border-white/5">
          <span className="text-xs text-slate-400 font-medium">
            {query.data?.pagination?.totalItems !== undefined
              ? `${query.data.pagination.totalItems} sheets found`
              : 'Filter sheets by date, category or status'}
          </span>
          <Button onClick={() => query.refetch()} disabled={query.isFetching} size="sm" variant="secondary">
            Refresh
          </Button>
        </div>
      </div>

      {query.isPending && (
        <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center">
          <p role="status" className="text-xs text-slate-400">Loading attendance review queue…</p>
        </div>
      )}

      {query.isError && (
        <div className="glass-panel p-5 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-semibold">
          <p role="alert">{query.error?.response?.data?.message || 'Unable to load attendance review queue.'}</p>
        </div>
      )}

      {query.data && !query.isError && (
        <>
          {!query.data.sheets.length ? (
            <div className="glass-panel p-10 rounded-2xl border border-white/10 text-center">
              <p className="text-sm text-slate-400">No sheets match these filters.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="min-w-[1500px]">
                    <TableHeader>
                      <TableRow>
                        {columns.map(([key, label]) => (
                          <TableCell isHeader key={key}>{label}</TableCell>
                        ))}
                        <TableCell isHeader>Action</TableCell>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {query.data.sheets.map(s => (
                        <TableRow key={s.id}>
                          {columns.map(([key]) => {
                            if (key === 'status') {
                              return (
                                <TableCell key={key}>
                                  <Badge variant={statusVariant(s.status)}>
                                    {s.status}
                                  </Badge>
                                </TableCell>
                              );
                            }
                            if (key === 'attendance_date') {
                              return (
                                <TableCell key={key} className="font-mono font-semibold text-slate-200">
                                  {s[key]}
                                </TableCell>
                              );
                            }
                            if (key === 'total_ot_hours') {
                              return (
                                <TableCell key={key} className="font-mono font-semibold text-amber-400">
                                  {Number(s[key]).toFixed(2)}
                                </TableCell>
                              );
                            }
                            return (
                              <TableCell key={key} className="text-xs">
                                {s[key] ?? '—'}
                              </TableCell>
                            );
                          })}
                          <TableCell>
                            <Link
                              className="inline-flex items-center justify-center font-bold uppercase tracking-wider text-[11px] px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-slate-100 transition whitespace-nowrap"
                              to={`/factory-attendance/review/${s.id}`}
                            >
                              Open Sheet
                            </Link>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              <Pagination
                currentPage={page}
                totalPages={query.data.pagination.totalPages}
                onPageChange={value => {
                  const next = new URLSearchParams(search);
                  next.set('page', String(value));
                  setSearch(next);
                }}
              />
            </div>
          )}
        </>
      )}
    </main>
  );
}
