import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Badge, Table, TableHeader, TableBody, TableRow, TableCell, Modal, PremiumSuccessModal } from '../../components/ui';
import { FACTORY_CATEGORIES, getCategoryLabel, getDepartmentsForCategory, getFactoryDepartment } from '../admin/employeeConstants';
import { loadAttendanceSheet, populateAttendanceSheet, saveAttendanceRows, saveFactoryLeave, submitAttendanceSheet, getAttendanceHistory } from '../../api/hrAttendanceApi';
import SheetAuditTimeline from '../../components/hr/SheetAuditTimeline';

const categories = FACTORY_CATEGORIES;
const localCategory = 'Local Daily-Wage Workers';
const statuses = ['Present','Absent','Medical Leave','Paid Leave','Unpaid Leave','Compensatory Off','Management Issue'];
const options = values => values.map(value => ({ value, label: value }));
const categoryOptions = values => values.map(value => ({ value, label: getCategoryLabel(value) }));
const errorText = error => error?.response?.data?.message || 'Unable to complete attendance operation.';
// Times are explicitly India factory time (Asia/Kolkata).
// Entry date is locked to the attendance date. Exit date defaults to attendance date, or next day for overnight shifts.
const businessDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);

function getNextDay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().split('T')[0];
}

function getKolkataParts(timestamp) {
  if (!timestamp) return null;
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(timestamp)) return null;
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return null;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).formatToParts(d).map(p => [p.type, p.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`
  };
}

function extractTime(timestamp) {
  if (!timestamp) return '';
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(timestamp)) return timestamp.slice(0, 5);
  const parts = getKolkataParts(timestamp);
  if (parts) return parts.time;
  if (timestamp.includes('T')) {
    return timestamp.split('T')[1].slice(0, 5);
  }
  return timestamp.slice(0, 5);
}

function isExitNextDay(exitTimestamp, sheetDate) {
  if (!exitTimestamp || !sheetDate) return false;
  const parts = getKolkataParts(exitTimestamp);
  if (parts) return parts.date > sheetDate;
  if (exitTimestamp.includes('T')) {
    return exitTimestamp.split('T')[0] > sheetDate;
  }
  return false;
}

function buildTimestamp(timeStr, targetDate) {
  if (!timeStr) return null;
  const time = extractTime(timeStr);
  if (!time) return null;
  const fullTime = time.length === 5 ? `${time}:00` : time;
  return `${targetDate}T${fullTime}+05:30`;
}

export default function DailyAttendance() {
  const [params, setParams] = useSearchParams();
  const category = categories.includes(params.get('category')) ? params.get('category') : categories[0];
  const department = getFactoryDepartment(category, params.get('department'));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : businessDate(new Date());
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const change = values => {
    setDirty(false);
    setParams(prev => {
      const next = new URLSearchParams(prev);
      Object.entries(values).forEach(([k, v]) => next.set(k, v));
      return next;
    });
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="border-b border-white/5 pb-4">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
          Factory Operations · Attendance Roster
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">Daily Attendance</h1>
        <p className="text-xs text-slate-400 font-medium mt-1">
          Record daily factory attendance, manage shift exceptions, and submit category rosters to Head Office.
        </p>
      </div>

      {/* Filter Toolbar Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 space-y-3">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Select
            label="Employee Category"
            value={category}
            disabled={dirty || busy}
            options={categoryOptions(categories)}
            onChange={e => change({ category: e.target.value })}
          />
          <Select
            label="Factory"
            value={department}
            disabled={dirty || busy}
            options={options(getDepartmentsForCategory(category))}
            onChange={e => change({ department: e.target.value })}
          />
          <Input
            label="Attendance Date"

            type="date"
            value={date}
            disabled={dirty || busy}
            onChange={e => e.target.value && change({ date: e.target.value })}
          />
        </div>
        {dirty && (
          <div className="flex items-center gap-2 p-2.5 rounded-xl border border-amber-500/20 bg-amber-500/5 text-amber-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Save or discard changes before switching date/category.
          </div>
        )}
      </div>

      <AttendanceSheet key={`${category}:${department}:${date}`} category={category} department={department} date={date} onDirty={setDirty} onBusy={setBusy} />
    </div>
  );
}

function AttendanceSheet({ category, department, date, onDirty, onBusy }) {
  const client = useQueryClient();
  const { user } = useAuth();
  const canWrite = ['factory_manager', 'admin'].includes(user?.role);
  const key = ['hr-attendance', category, department, date];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await loadAttendanceSheet({ employee_category: category, department, date })).data,
    refetchOnWindowFocus: false
  });
  const [patches, setPatches] = useState({});
  const [leaveEmployee, setLeaveEmployee] = useState(null);
  const [submittedModalOpen, setSubmittedModalOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');
  const triggerButtonRef = useRef(null);
  const leaveWasOpen = useRef(false);

  const sheet = query.data?.sheet;
  const editable = canWrite && ['Draft', 'Returned for Correction'].includes(sheet?.status);
  const local = category === localCategory;
  const storedRows = new Map((query.data?.rows || []).map(row => [row.employee_id, row]));
  const rows = (query.data?.rows || []).map(row => ({ ...row, ...patches[row.employee_id] }));
  const dirty = Object.keys(patches).length > 0;
  const standardHours = [...new Set(rows.map(row => row.rule?.standard_duty_hours).filter(value => value != null))];

  // Counters
  const totalRoster = rows.length;
  const markedCount = rows.filter(r => Boolean(r.attendance_status)).length;
  const completeCount = rows.filter(r => {
    if (!r.attendance_status) return false;
    if (['Present', 'Management Issue'].includes(r.attendance_status)) {
      if (r.attendance_status === 'Management Issue' && !r.entry_timestamp && !r.exit_timestamp) {
        return true;
      }
      const hasTimestamps = Boolean(r.entry_timestamp && r.exit_timestamp);
      const hasDuty = !local || Boolean(r.duty_type);
      return hasTimestamps && hasDuty;
    }
    if (['Medical Leave', 'Paid Leave', 'Unpaid Leave'].includes(r.attendance_status)) {
      return Boolean(r.leave_request_id);
    }
    return true; // Absent, Compensatory Off have no timestamps
  }).length;
  const totalSavedOtHours = rows.reduce((sum, r) => sum + (Number(storedRows.get(r.employee_id)?.ot_hours) || 0), 0);

  const mutation = useMutation({
    mutationFn: async ({ action, body }) => {
      if (action === 'populate') return populateAttendanceSheet({ employee_category: category, department, date });
      if (action === 'save') return saveAttendanceRows(sheet.id, Object.entries(patches).map(([employee_id, patch]) => ({ employee_id, ...patch })));
      if (action === 'leave') return saveFactoryLeave(sheet.id, body);
      return submitAttendanceSheet(sheet.id);
    },
    onSuccess: async (_data, { action }) => {
      if (action === 'leave') {
        setPatches({});
        onDirty(false);
        setLeaveEmployee(null);
      } else {
        setPatches({});
        onDirty(false);
      }
      if (action === 'submit') {
        setSubmittedModalOpen(true);
      }
      await client.invalidateQueries({ queryKey: key });
      client.invalidateQueries({ queryKey: ['hr-attendance-history', sheet?.id] });
      setMessage(action === 'submit' ? 'Submitted to HO.' : action === 'leave' ? 'Leave and attendance row saved.' : action === 'populate' ? 'Attendance sheet/roster refreshed.' : 'Draft saved.');
    }
  });

  const pending = mutation.isPending;
  const blocked = pending || Boolean(leaveEmployee);
  useEffect(() => {
    if (leaveEmployee) leaveWasOpen.current=true;
    else if (!pending && leaveWasOpen.current) {leaveWasOpen.current=false;triggerButtonRef.current?.focus();}
  },[leaveEmployee,pending]);
  useEffect(() => { onBusy(blocked); return () => onBusy(false); }, [blocked, onBusy]);

  const change = (row, patch) => {
    setMessage('');
    setSaveError('');
    mutation.reset();
    setPatches(prev => ({ ...prev, [row.employee_id]: { ...prev[row.employee_id], ...patch } }));
    onDirty(true);
  };

  const handleEntryTimeChange = (row, rawValue) => {
    if (!rawValue) {
      change(row, { entry_timestamp: null });
      return;
    }
    const timeStr = extractTime(rawValue);
    const iso = buildTimestamp(timeStr, date);
    const patch = { entry_timestamp: iso };
    if (row.exit_timestamp) {
      const exitTime = extractTime(row.exit_timestamp);
      if (exitTime && exitTime < timeStr && !isExitNextDay(row.exit_timestamp, date)) {
        patch.exit_timestamp = buildTimestamp(exitTime, getNextDay(date));
      }
    }
    change(row, patch);
  };

  const handleExitTimeChange = (row, rawValue) => {
    if (!rawValue) {
      change(row, { exit_timestamp: null });
      return;
    }
    const timeStr = extractTime(rawValue);
    const entryTime = extractTime(row.entry_timestamp);
    // Auto-detect overnight shift if exit time is earlier than entry time (e.g. entry 20:00, exit 05:00)
    let explicitNext = isExitNextDay(row.exit_timestamp, date);
    if (entryTime && timeStr < entryTime) {
      explicitNext = true;
    }
    const targetDate = explicitNext ? getNextDay(date) : date;
    const iso = buildTimestamp(timeStr, targetDate);
    change(row, { exit_timestamp: iso });
  };

  const toggleExitNextDay = (row) => {
    if (!row.exit_timestamp) return;
    const currentlyNext = isExitNextDay(row.exit_timestamp, date);
    const timeStr = extractTime(row.exit_timestamp);
    const newDate = currentlyNext ? date : getNextDay(date);
    const iso = buildTimestamp(timeStr, newDate);
    change(row, { exit_timestamp: iso });
  };

  const statusChange = (row, value) => {
    const working = ['Present', 'Management Issue'].includes(value);
    change(row, {
      attendance_status: value || null,
      leave_request_id: null,
      holiday_pay_eligible: false,
      ...(!working ? { entry_timestamp: null, exit_timestamp: null, duty_type: null } : { duty_type: local ? row.duty_type : null })
    });
  };

  const attach = row => {
    const l = row.available_leave;
    change(row, {
      leave_request_id: l.id,
      attendance_status: l.leave_type === 'Medical Leave'
        ? 'Medical Leave'
        : l.approval_status === 'Approved'
          ? l.pay_treatment === 'Paid' ? 'Paid Leave' : 'Unpaid Leave'
          : l.leave_type === 'Paid Leave' ? 'Paid Leave' : 'Unpaid Leave',
      entry_timestamp: null,
      exit_timestamp: null,
      duty_type: null,
      holiday_pay_eligible: false
    });
  };

  if (query.isPending) return <p role="status" className="text-sm text-slate-400">Loading attendance…</p>;
  if (query.isError) return (
    <div role="alert" className="p-4 rounded-xl border border-red-500/20 bg-red-500/5 text-red-400 text-sm flex items-center justify-between">
      <span>Unable to load attendance.</span>
      <Button size="sm" onClick={() => query.refetch()}>Retry</Button>
    </div>
  );

  const statusBadgeVariant = {
    'Draft': 'amber',
    'Submitted': 'blue',
    'Returned for Correction': 'red',
    'Locked': 'emerald'
  }[sheet?.status] || 'slate';

  return (
    <div className="space-y-6">
      {/* Information guidelines */}
      <div className="text-xs text-slate-400 space-y-1">
        <p>All times use India time (Asia/Kolkata). Attendance date is the duty start date. Use "+1 Day" on exit for overnight or 24-hour duty.</p>
        {local && <p>FM classifies Single/Double Duty. Double Duty has zero OT. Local leave is always Unpaid; holiday eligibility does not apply.</p>}
      </div>

      {/* Sheet Summary Card */}
      {sheet?.department === null && <p className="text-xs text-amber-400">Legacy sheet: factory was not recorded. This original roster is retained for this date.</p>}
      {sheet ? (
        <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
            <div className="flex items-center gap-2.5">
              <span className="text-xs text-slate-400 font-semibold">Sheet status:</span>
              <Badge variant={statusBadgeVariant} pulseDot={sheet.status === 'Draft'}>
                {sheet.status}
              </Badge>
              <span className="text-xs text-slate-500 font-mono">· Submissions: {sheet.submission_count}</span>
            </div>
            <div className="text-xs text-slate-400 font-mono">
              Standard Duty Hours on saved rows: <span className="text-slate-200 font-bold">{standardHours.length ? standardHours.join(', ') : 'Not configured'}</span>
            </div>
          </div>

          {/* Metric KPI Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Roster</span>
              <span data-testid="metric-total-roster" className="text-lg font-bold font-mono text-slate-100">{totalRoster}</span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Marked</span>
              <span data-testid="metric-marked-count" className="text-lg font-bold font-mono text-slate-100">{markedCount} <span className="text-xs text-slate-500 font-normal">/ {totalRoster}</span></span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Entry Complete</span>
              <span data-testid="metric-complete-count" className="text-lg font-bold font-mono text-emerald-400">{completeCount} <span className="text-xs text-slate-500 font-normal">/ {totalRoster}</span></span>
            </div>
            <div className="p-3 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Saved OT Hours</span>
              <span data-testid="metric-saved-ot" className="text-lg font-bold font-mono text-slate-100">{totalSavedOtHours.toFixed(2)} hrs</span>
              {dirty && <span className="block text-[10px] text-amber-400 font-bold mt-0.5">● Save to recalculate hours</span>}
            </div>
          </div>

          {/* Return remarks alert card */}
          {sheet.return_remarks && (
            <div className="p-4 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 space-y-1">
              <div className="flex items-center gap-2 font-bold text-xs uppercase tracking-wider">
                <svg className="w-4 h-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                Action Required: Returned by Head Office for Correction
              </div>
              <p className="text-sm font-semibold">Last return remarks: {sheet.return_remarks}</p>
            </div>
          )}

          {sheet.review_remarks && (
            <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-slate-300">
              <span className="font-bold text-slate-400 uppercase tracking-wider block mb-0.5">HO remarks:</span>
              <p>{sheet.review_remarks}</p>
            </div>
          )}

          {!editable && (
            <p className="text-xs text-slate-400">
              This sheet is read-only.{sheet.status === 'Submitted' ? ' HO must return it before correction.' : ''}
            </p>
          )}
        </div>
      ) : (
        <div className="p-5 rounded-2xl border border-white/5 bg-white/2 text-slate-400 text-sm">
          No sheet exists for this date/category.
        </div>
      )}

      {/* Sticky Workspace Action Toolbar */}
      {canWrite && (!sheet || editable) && (
        <div className="p-3.5 rounded-2xl border border-white/10 bg-slate-900/95 backdrop-blur-md sticky top-2 z-20 flex flex-wrap items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-2 flex-wrap">
            <Button disabled={blocked || dirty} onClick={() => mutation.mutate({ action: 'populate' })}>
              {sheet ? 'Refresh Roster' : 'Create Attendance Sheet'}
            </Button>
            {editable && (
              <Button
                variant="secondary"
                disabled={blocked || !rows.some(r => !r.attendance_status)}
                onClick={() => rows.filter(r => !r.attendance_status).forEach(r => change(r, { attendance_status: 'Present', ...(local ? { duty_type: 'Single Duty' } : {}) }))}
              >
                Mark All Present
              </Button>
            )}
          </div>

          {editable && (
            <div className="flex items-center gap-2 flex-wrap ml-auto">
              {dirty && (
                <span className="text-xs font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-1 rounded-full mr-1">
                  ● Unsaved edits
                </span>
              )}
              <Button
                variant="secondary"
                disabled={blocked || !dirty}
                onClick={() => { setPatches({}); onDirty(false); mutation.reset(); setSaveError(''); setMessage('Changes discarded.'); }}
              >
                Discard Changes
              </Button>
              <Button
                disabled={blocked || !dirty}
                onClick={() => {
                  setSaveError('');
                  setMessage('');
                  mutation.reset();
                  const invalidCo = rows.filter(r => r.attendance_status === 'Compensatory Off' && !r.yesterday_24h_duty);
                  if (invalidCo.length > 0) {
                    const names = invalidCo.map(r => r.employee?.employee_name || r.employee?.employee_code || r.employee_id).join(', ');
                    const yDate = invalidCo[0].yesterday_date || 'the previous day';
                    setSaveError(`Cannot save: Compensatory Off for ${names} requires a approved 24-hour duty on ${yDate}.`);
                    return;
                  }
                  mutation.mutate({ action: 'save' });
                }}
              >
                Save Draft
              </Button>
              <Button
                className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                disabled={blocked || dirty || !rows.length}
                onClick={() => mutation.mutate({ action: 'submit' })}
              >
                {sheet.status === 'Returned for Correction' ? 'Resubmit to HO' : 'Submit to HO'}
              </Button>
            </div>
          )}
        </div>
      )}

      {editable && (
        <p className="text-xs text-slate-400">
          Mark All Present marks unmarked rows only. Enter times and save before submission or recording leave. Saved Actual/OT Hours come from the server.
        </p>
      )}

      {/* Inline Feedback Alerts */}
      {mutation.isError && !leaveEmployee && (
        <div role="alert" className="p-3.5 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold">
          {errorText(mutation.error)}
        </div>
      )}
      {saveError && (
        <div role="alert" className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs font-bold flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span>{saveError}</span>
          </div>
          <button type="button" onClick={() => setSaveError('')} className="text-amber-400 hover:text-amber-200 text-base font-bold ml-2">×</button>
        </div>
      )}
      {message && (
        <div role="status" className="p-3.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-400 text-xs font-bold">
          {message}
        </div>
      )}

      {sheet && !rows.length && (
        <p className="text-sm text-slate-400">No eligible employees. Employees must be Active and joined on or before this date.</p>
      )}

      {/* Main Attendance Table with Sticky Opaque Employee Column */}
      {!!rows.length && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">Scroll the table horizontally to view duty, leave and remarks.</p>
          <div className="overflow-x-auto relative rounded-2xl border border-white/10">
            <Table className="min-w-[1650px]">
              <TableHeader>
                <TableRow>
                  <TableCell isHeader className="sticky left-0 z-20 sticky-col-opaque min-w-[220px]">
                    Employee
                  </TableCell>
                  <TableCell isHeader>Attendance Status</TableCell>
                  <TableCell isHeader>Entry Time</TableCell>
                  <TableCell isHeader>Exit Time</TableCell>
                  <TableCell isHeader>Actual Hours</TableCell>
                  <TableCell isHeader>OT Hours</TableCell>
                  {local ? <TableCell isHeader>Duty Type</TableCell> : <TableCell isHeader>Holiday Eligible</TableCell>}
                  <TableCell isHeader>Leave / Exception</TableCell>
                  <TableCell isHeader>Remarks</TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(row => {
                  const stored = storedRows.get(row.employee_id) || {};
                  const leave = row.leave_request_id === stored.leave?.id
                    ? stored.leave
                    : row.leave_request_id === stored.available_leave?.id
                      ? stored.available_leave
                      : null;
                  const working = ['Present', 'Management Issue'].includes(row.attendance_status);
                  const label = row.employee?.employee_name || row.employee_id;
                  const rowDirty = Boolean(patches[row.employee_id]);
                  const hasInvalidCo = row.attendance_status === 'Compensatory Off' && !row.yesterday_24h_duty;

                  return (
                    <TableRow key={row.id} className={hasInvalidCo ? 'bg-amber-500/5' : ''}>
                      {/* Sticky Opaque Employee Column */}
                      <TableCell className="sticky left-0 z-10 sticky-col-opaque min-w-[220px]">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 font-mono text-xs flex items-center justify-center font-extrabold shrink-0">
                            {(row.employee?.employee_name || 'U')[0].toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-slate-100 text-sm block truncate">{label}</span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className="font-mono text-[10px] text-slate-400">{row.employee?.employee_code}</span>
                            </div>
                          </div>
                        </div>
                      </TableCell>

                      <TableCell>
                        <Select
                          className="min-w-[180px]"
                          aria-label={`Status for ${label}`}
                          disabled={!editable || blocked}
                          value={row.attendance_status || ''}
                          options={[{ value: '', label: 'Unmarked' }, ...options(statuses.filter(s => !local || s !== 'Paid Leave'))]}
                          onChange={e => statusChange(row, e.target.value)}
                        />
                        {row.attendance_status === 'Compensatory Off' && (
                          <div className="mt-1">
                            {row.yesterday_24h_duty ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-md">
                                <svg className="w-3 h-3 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                Approved 24h duty on {row.yesterday_date} (CO eligible)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md" role="alert">
                                <svg className="w-3 h-3 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                No approved 24h duty on {row.yesterday_date || 'yesterday'} ({Number(row.yesterday_actual_hours || 0).toFixed(1)} hrs)
                              </span>
                            )}
                          </div>
                        )}
                      </TableCell>

                      {/* Entry Time */}
                      <TableCell>
                        <div className="min-w-[120px]">
                          <Input
                            className="min-w-[110px] font-mono text-xs"
                            aria-label={`Entry for ${label}`}
                            type="time"
                            step="60"
                            disabled={!editable || blocked || !working}
                            value={extractTime(row.entry_timestamp)}
                            onChange={e => handleEntryTimeChange(row, e.target.value)}
                          />
                        </div>
                      </TableCell>

                      {/* Exit Time with +1 Day Toggle */}
                      <TableCell>
                        <div className="flex items-center gap-1.5 min-w-[190px]">
                          <Input
                            className="min-w-[110px] font-mono text-xs"
                            aria-label={`Exit for ${label}`}
                            type="time"
                            step="60"
                            disabled={!editable || blocked || !working}
                            value={extractTime(row.exit_timestamp)}
                            onChange={e => handleExitTimeChange(row, e.target.value)}
                          />
                          <button
                            type="button"
                            aria-label={`Next day exit for ${label}`}
                            disabled={!editable || blocked || !working || !row.exit_timestamp}
                            onClick={() => toggleExitNextDay(row)}
                            className={`px-2 py-1.5 text-[11px] font-bold rounded-lg transition border flex items-center gap-1 ${
                              isExitNextDay(row.exit_timestamp, date)
                                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                                : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200 hover:bg-white/10'
                            } disabled:opacity-40 disabled:cursor-not-allowed shrink-0`}
                            title={isExitNextDay(row.exit_timestamp, date) ? 'Exit on next day (overnight shift)' : 'Click to toggle next day exit (+1 day)'}
                          >
                            <span>+1 Day</span>
                            {isExitNextDay(row.exit_timestamp, date) && (
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                            )}
                          </button>
                        </div>
                      </TableCell>

                      <TableCell>
                        <span className="font-mono text-xs text-slate-200">
                          {Number(stored.actual_hours || 0).toFixed(2)}
                        </span>
                      </TableCell>

                      <TableCell>
                        <div className="font-mono text-xs">
                          <span className={Number(stored.ot_hours) > 0 ? 'text-amber-400 font-bold' : 'text-slate-200'}>
                            {Number(stored.ot_hours || 0).toFixed(2)}
                          </span>
                          {rowDirty && <span className="block text-[10px] text-amber-400 font-sans">Save to refresh hours</span>}
                        </div>
                      </TableCell>

                      <TableCell>
                        {local ? (
                          <Select
                            className="min-w-[180px]"
                            aria-label={`Duty for ${label}`}
                            disabled={!editable || blocked || !working}
                            value={row.duty_type || ''}
                            options={[{ value: '', label: 'Select duty' }, ...options(['Single Duty', 'Double Duty'])]}
                            onChange={e => change(row, { duty_type: e.target.value || null })}
                          />
                        ) : (
                          <input
                            aria-label={`Holiday for ${label}`}
                            type="checkbox"
                            className="w-4 h-4 rounded accent-amber-500 cursor-pointer"
                            disabled={!editable || blocked || row.attendance_status !== 'Present' || !row.rule?.holiday_pay_enabled}
                            checked={Boolean(row.holiday_pay_eligible)}
                            onChange={e => change(row, { holiday_pay_eligible: e.target.checked })}
                          />
                        )}
                      </TableCell>

                      <TableCell>
                        {leave && (
                          <div className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-xs space-y-1 mb-2 min-w-[200px]">
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-amber-400">{leave.leave_type}</span>
                              <Badge variant={leave.approval_status === 'Approved' ? 'emerald' : leave.approval_status === 'Rejected' ? 'red' : 'amber'}>
                                {leave.approval_status}
                              </Badge>
                            </div>
                            <p className="font-mono text-[10px] text-slate-400">{leave.from_date} – {leave.to_date}</p>
                            <p className="text-slate-300 text-[11px]">Pay: <span className="font-semibold">{leave.pay_treatment}</span></p>
                            {leave.reason && <p className="text-slate-400 italic truncate max-w-[220px]" title={leave.reason}>"{leave.reason}"</p>}
                            {leave.decision_remarks && <p className="text-amber-400 text-[10px]">HO Note: {leave.decision_remarks}</p>}
                          </div>
                        )}
                        {editable && (
                          <div className="flex flex-wrap gap-2">
                            {leave?.approval_status !== 'Approved' && leave?.request_source !== 'SELF_SERVICE' && (
                              <Button
                                size="sm"
                                disabled={blocked || dirty}
                                onClick={e => {
                                  mutation.reset();
                                  triggerButtonRef.current = e.currentTarget;
                                  setLeaveEmployee({ ...row, leave });
                                }}
                              >
                                {leave?.approval_status === 'Pending' ? 'Edit Leave' : 'Record Leave'}
                              </Button>
                            )}
                            {!row.leave_request_id && row.available_leave && (
                              <Button size="sm" disabled={blocked || dirty} onClick={() => attach(row)}>
                                Use Existing Leave
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>

                      <TableCell>
                        <Input
                          className="min-w-[180px] text-xs"
                          aria-label={`Remarks for ${label}`}
                          maxLength={2000}
                          disabled={!editable || blocked}
                          value={row.remarks || ''}
                          onChange={e => change(row, { remarks: e.target.value || null })}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Leave Modal Dialog with Full Focus Trapping & Dismissal Protection */}
      {leaveEmployee && editable && (
        <LeaveModal
          key={leaveEmployee.employee_id}
          row={leaveEmployee}
          date={date}
          local={local}
          pending={pending}
          error={mutation.isError ? mutation.error : null}
          onClose={() => setLeaveEmployee(null)}
          onSave={body => mutation.mutate({ action: 'leave', body })}
        />
      )}

      {/* Premium Submission Confirmation Modal */}
      <PremiumSuccessModal
        isOpen={submittedModalOpen}
        onClose={() => setSubmittedModalOpen(false)}
        eyebrow="Roster Submission Confirmed"
        title="Submitted to Head Office"
        message={`Daily attendance roster for ${getCategoryLabel(category)} on ${date} has been locked and submitted for HO review.`}
        details={[
          { label: 'Category', value: getCategoryLabel(category) },
          { label: 'Factory', value: sheet?.department || 'Legacy combined roster' },
          { label: 'Attendance Date', value: date },
          { label: 'Total Roster', value: `${totalRoster} employees` },
          { label: 'Total Marked', value: `${markedCount} of ${totalRoster}` },
          { label: 'Saved OT Hours', value: `${totalSavedOtHours.toFixed(2)} hrs` },
          { label: 'Status', value: 'Submitted', pill: true }
        ]}
        ctaLabel="Done"
      />

      {sheet && <SheetHistory id={sheet.id} />}
    </div>
  );
}

function LeaveModal({ row, date, local, pending, error, onSave, onClose }) {
  const leave = row.leave?.approval_status === 'Pending' ? row.leave : null;
  const initialForm = useMemo(() => ({
    employee_id: row.employee_id,
    leave_id: leave?.id || null,
    from_date: leave?.from_date || date,
    to_date: leave?.to_date || date,
    leave_type: leave?.leave_type || (local ? 'Leave / Not Working' : 'Medical Leave'),
    reason: leave?.reason || '',
    pay_treatment: local ? 'Unpaid' : leave?.pay_treatment || 'Pending'
  }), [row.employee_id, leave, date, local]);

  const [form, setForm] = useState(initialForm);
  const modalRef = useRef(null);

  const isFormDirty = form.from_date !== initialForm.from_date ||
    form.to_date !== initialForm.to_date ||
    form.leave_type !== initialForm.leave_type ||
    form.reason !== initialForm.reason ||
    form.pay_treatment !== initialForm.pay_treatment;

  // Safe dismiss handler: blocks during save mutation, protects unsaved edits
  const handleRequestClose = useCallback((force = false) => {
    if (pending) return; // Completely blocked during saving
    if (!force && isFormDirty) {
      if (!window.confirm('Discard unsaved leave entry?')) return;
    }
    onClose();
  }, [pending, isFormDirty, onClose]);

  // Focus trap inside the modal dialog
  useEffect(() => {
    const handleKeyDown = e => {
      if (e.key === 'Tab' && modalRef.current) {
        const focusableElements = [...modalRef.current.querySelectorAll('input, select, textarea, button')]
          .filter(element => !element.matches(':disabled'));
        if (pending) { e.preventDefault(); return; }
        if (!focusableElements.length) return;
        const first = focusableElements[0];
        const last = focusableElements[focusableElements.length - 1];

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleRequestClose,pending]);

  const field = name => ({
    value: form[name],
    onChange: e => setForm(prev => ({ ...prev, [name]: e.target.value }))
  });

  return (
    <Modal isOpen onClose={() => handleRequestClose(false)} closeDisabled={pending} closeLabel="Close dialog"
      dialogRef={modalRef} role="dialog" aria-modal="true" aria-labelledby="factory-leave-modal-title"
      titleId="factory-leave-modal-title" title={`Factory Leave — ${row.employee?.employee_name}`}
      subtitle="Factory Leave Management">
        <p className="text-xs text-slate-400 mb-4">
          Saving records this range request and links this attendance row together. Its duty timestamps will be cleared.
        </p>

        {error && (
          <div role="alert" className="p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-bold mb-4">
            {errorText(error)}
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); onSave(form); }} className="space-y-4">
          <fieldset disabled={pending} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="From Date" type="date" autoFocus required {...field('from_date')} />
            <Input label="To Date" type="date" required min={form.from_date} {...field('to_date')} />
            <Select
              label="Leave Type"
              options={options(['Medical Leave', ...(!local ? ['Paid Leave'] : []), 'Unpaid Leave', 'Leave / Not Working'])}
              {...field('leave_type')}
            />
            <Select
              label="Pay Treatment"
              disabled={local}
              options={options(local ? ['Unpaid'] : ['Pending', 'Paid', 'Unpaid'])}
              {...field('pay_treatment')}
            />
            <div className="sm:col-span-2">
              <Input label="Leave Reason" required maxLength={2000} {...field('reason')} />
            </div>
          </fieldset>

          <div className="flex gap-3 justify-end pt-3 border-t border-white/5">
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => handleRequestClose(true)}
            >
              Cancel Leave Entry
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Save Leave'}
            </Button>
          </div>
        </form>
    </Modal>
  );
}

function SheetHistory({ id }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ['hr-attendance-history', id, page],
    queryFn: async () => (await getAttendanceHistory(id, { page, limit: 20 })).data,
    enabled: open
  });

  return (
    <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm uppercase tracking-wider text-slate-200">Sheet Audit History</h3>
          <p className="text-xs text-slate-400">Chronological trail of roster population, saves, leaves, returns and submissions.</p>
        </div>
        <Button variant="secondary" onClick={() => setOpen(v => !v)}>
          {open ? 'Hide History' : 'Show History'}
        </Button>
      </div>

      {open && (
        <SheetAuditTimeline
          events={query.data?.history || []}
          pagination={{
            currentPage: page,
            totalPages: query.data?.pagination?.totalPages || 1,
            totalItems: query.data?.pagination?.totalItems || 0,
            onPageChange: setPage
          }}
          loading={query.isPending}
          error={query.isError ? query.error : null}
          onRetry={() => query.refetch()}
          emptyMessage="No history for this sheet."
        />
      )}
    </div>
  );
}
