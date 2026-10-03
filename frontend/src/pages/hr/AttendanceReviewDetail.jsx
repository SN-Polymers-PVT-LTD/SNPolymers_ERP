import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select, Badge, Table, TableHeader, TableBody, TableRow, TableCell } from '../../components/ui';
import { getAttendanceReviewDetail, decideFactoryLeave, returnAttendanceSheet, reviewAttendanceSheet, getAttendanceHistory } from '../../api/hrAttendanceApi';
import SheetAuditTimeline from '../../components/hr/SheetAuditTimeline';

const errorText = e => e?.response?.data?.message || 'Unable to complete review operation.';
const stamp = value => value ? new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(new Date(value)) : '—';

function statusVariant(status) {
  if (status === 'Locked') return 'emerald';
  if (status === 'Returned for Correction') return 'red';
  if (status === 'Submitted') return 'amber';
  return 'slate';
}

function LeaveDecision({ sheetId, leave, employee, local, disabled, onDecide, actors }) {
  const [pay, setPay] = useState(local ? 'Unpaid' : '');
  const [remarks, setRemarks] = useState('');

  return (
    <section className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 space-y-4" aria-label={`Leave for ${employee.employee_name}`}>
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">Employee Leave Request</span>
          <h3 className="text-sm font-bold text-slate-100 mt-0.5">{employee.employee_code} — {employee.employee_name}</h3>
        </div>
        <Badge variant={leave.approval_status === 'Approved' ? 'emerald' : leave.approval_status === 'Rejected' ? 'red' : 'amber'}>
          {leave.approval_status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
        <div className="p-3 rounded-xl bg-white/5 border border-white/5">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Leave Period</span>
          <span className="text-xs font-mono font-semibold text-slate-200 block mt-1">{leave.from_date} → {leave.to_date}</span>
          <span className="text-[10px] text-slate-400 block mt-0.5">{leave.leave_type} · {leave.approval_status}</span>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/5">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Pay Treatment</span>
          <span className="text-xs font-semibold text-slate-200 block mt-1">Pay Treatment: {leave.pay_treatment}</span>
        </div>
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 sm:col-span-2">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Reason</span>
          <span className="text-xs text-slate-300 block mt-1">Reason: {leave.reason || 'None provided'}</span>
        </div>
      </div>

      {leave.decision_remarks && (
        <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-xs">
          <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Decision Remarks</span>
          <p className="text-xs text-slate-200 mt-0.5">Decision Remarks: {leave.decision_remarks}</p>
        </div>
      )}

      <p className="text-[10px] text-slate-400 font-mono">
        Recorded By: {actors?.[leave.created_by] || leave.created_by || '—'} · Decision By: {actors?.[leave.decided_by] || leave.decided_by || '—'}
      </p>

      {leave.approval_status === 'Pending' && (
        <div className="pt-3 border-t border-white/5 space-y-4">
          <p className="text-xs text-slate-400">
            Decide leave with this submitted sheet. A changed attendance treatment returns affected sheets for FM correction.
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            <Select
              label={`Pay Treatment for ${employee.employee_name}`}
              value={pay}
              disabled={disabled || local}
              options={[
                ...(!local ? [{ value: '', label: 'Select treatment…' }] : []),
                { value: 'Paid', label: 'Paid' },
                { value: 'Unpaid', label: 'Unpaid' }
              ]}
              onChange={e => setPay(e.target.value)}
            />
            <Input
              label={`Decision Remarks for ${employee.employee_name}`}
              maxLength={2000}
              value={remarks}
              disabled={disabled}
              placeholder="Mandatory if rejecting"
              onChange={e => setRemarks(e.target.value)}
            />
          </div>
          {local && <p className="text-xs text-slate-400">Local Daily-Wage leave is always Unpaid.</p>}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="success"
              size="sm"
              disabled={disabled || !pay}
              onClick={() => onDecide(sheetId, leave.id, { decision: 'Approved', pay_treatment: pay, remarks: remarks.trim() })}
            >
              Approve Leave for {employee.employee_name}
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={disabled || !remarks.trim()}
              onClick={() => onDecide(sheetId, leave.id, { decision: 'Rejected', pay_treatment: 'Unpaid', remarks: remarks.trim() })}
            >
              Reject Leave for {employee.employee_name}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

export default function AttendanceReviewDetail() {
  const { sheetId } = useParams();
  const client = useQueryClient();
  const [remarks, setRemarks] = useState('');
  const [notice, setNotice] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historyPage, setHistoryPage] = useState(1);

  const query = useQuery({
    queryKey: ['attendance-review-detail', sheetId],
    queryFn: () => getAttendanceReviewDetail(sheetId).then(r => r.data)
  });

  const history = useQuery({
    queryKey: ['attendance-review-history', sheetId, historyPage],
    enabled: showHistory,
    queryFn: () => getAttendanceHistory(sheetId, { page: historyPage, limit: 20 }).then(r => r.data)
  });

  const mutation = useMutation({
    mutationFn: async action => {
      if (action.kind === 'leave') return decideFactoryLeave(sheetId, action.leaveId, action.body);
      if (action.kind === 'return') return returnAttendanceSheet(sheetId, remarks.trim());
      return reviewAttendanceSheet(sheetId, remarks.trim());
    },
    onSuccess: async (_r, action) => {
      setNotice(action.kind === 'review' ? 'Attendance reviewed and locked.' : action.kind === 'return' ? 'Sheet returned to Factory Manager for correction.' : 'Leave decided. Attendance facts are unchanged; affected sheets are returned when correction is required.');
      setRemarks('');
      await Promise.all([
        client.invalidateQueries({ queryKey: ['attendance-review-detail'] }),
        client.invalidateQueries({ queryKey: ['attendance-review-queue'] }),
        client.invalidateQueries({ queryKey: ['attendance-review-history'] }),
        client.invalidateQueries({ queryKey: ['attendance'] })
      ]);
    }
  });

  const busy = mutation.isPending || query.isFetching;
  const data = query.data;
  const submitted = data?.sheet.status === 'Submitted';

  return (
    <main className="space-y-6 pb-12 text-slate-200">
      {/* Header & Back link */}
      <div>
        <Link
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-amber-400 transition mb-3"
          to="/factory-attendance/review"
        >
          ← Back to Attendance Review Queue
        </Link>
        <div className="border-b border-white/5 pb-4">
          <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
            Head Office Operations · Attendance Review
          </span>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
            Attendance Review Detail
          </h1>
          <p className="text-xs text-slate-400 font-medium mt-1">
            Review roster timestamps, verify shift exceptions, resolve pending leaves, and approve or return attendance to the Factory Manager.
          </p>
        </div>
      </div>

      {query.isPending && (
        <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center">
          <p role="status" className="text-xs text-slate-400">Loading attendance sheet…</p>
        </div>
      )}

      {query.isError && (
        <div className="glass-panel p-5 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-semibold">
          <p role="alert">{errorText(query.error)}</p>
        </div>
      )}

      {mutation.isError && (
        <div className="glass-panel p-5 rounded-2xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-semibold">
          <p role="alert">{errorText(mutation.error)}</p>
        </div>
      )}

      {notice && (
        <div className="glass-panel p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
          <p role="status">{notice}</p>
        </div>
      )}

      {data && !query.isError && (
        <>
          {/* Metadata Card */}
          <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
                  Submitted Roster Verification
                </span>
                <h2 className="text-xl font-extrabold text-slate-100 mt-0.5">
                  {data.sheet.attendance_date} · {data.sheet.employee_category}
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-100">Status: {data.sheet.status}</span>
                <Badge variant={statusVariant(data.sheet.status)}>
                  {data.sheet.status}
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Submission Round</span>
                <span className="text-sm font-bold font-mono text-slate-100">Round {data.sheet.submission_count}</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Submitted By</span>
                <span className="text-sm font-bold text-slate-200 truncate block">
                  {data.actors?.[data.sheet.submitted_by] || data.sheet.submitted_by || '—'}
                </span>
                <span className="text-[10px] text-slate-400 block font-mono mt-0.5">{stamp(data.sheet.submitted_at)}</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Headcount</span>
                <span className="text-sm font-bold font-mono text-slate-100">{data.rows.length}</span>
              </div>
              <div className="p-3 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Total Saved OT</span>
                <span className="text-sm font-bold font-mono text-amber-400">
                  {data.rows.reduce((sum, r) => sum + (Number(r.ot_hours) || 0), 0).toFixed(2)} hrs
                </span>
              </div>
            </div>

            {data.sheet.return_remarks && (
              <div className="p-3.5 rounded-xl border border-red-500/20 bg-red-500/10 text-xs">
                <span className="font-bold text-red-400 block mb-1">Return Remarks:</span>
                <p className="text-slate-200">{data.sheet.return_remarks}</p>
              </div>
            )}

            {data.sheet.review_remarks && (
              <div className="p-3.5 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-xs">
                <span className="font-bold text-emerald-400 block mb-1">HO Remarks:</span>
                <p className="text-slate-200">{data.sheet.review_remarks}</p>
              </div>
            )}

            {data.sheet.status === 'Locked' && (
              <p className="text-xs text-slate-400">
                Reviewed {stamp(data.sheet.reviewed_at)} · Locked {stamp(data.sheet.locked_at)}. Attendance is immutable.
              </p>
            )}
            {data.sheet.status === 'Returned for Correction' && (
              <p className="text-xs text-amber-400">
                Factory Manager must correct and resubmit this sheet.
              </p>
            )}
          </div>

          {/* Roster Table Card */}
          <div className="space-y-2">
            <p className="text-xs text-slate-400">
              Stored attendance facts · India time (IST) · Hours calculated by the database. Scroll horizontally to view all exceptions.
            </p>
            <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
              <div className="overflow-x-auto">
                <Table className="min-w-[1400px]">
                  <TableHeader>
                    <TableRow>
                      {[
                        'Employee',
                        'Attendance',
                        'Entry Timestamp',
                        'Exit Timestamp',
                        'Actual Hours',
                        'OT Hours',
                        'Local Duty Type',
                        'Holiday Pay Eligible',
                        'Remarks / Exceptions',
                        'Leave Status / Pay'
                      ].map(label => (
                        <TableCell isHeader key={label}>{label}</TableCell>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.rows.map(row => (
                      <TableRow key={row.id}>
                        <TableCell className="font-medium text-slate-200">
                          {row.employee.employee_code} — {row.employee.employee_name}
                        </TableCell>
                        <TableCell>
                          <Badge variant={row.attendance_status === 'Present' ? 'emerald' : row.attendance_status === 'Absent' ? 'red' : 'amber'}>
                            {row.attendance_status || 'Unmarked'}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-slate-300">{stamp(row.entry_timestamp)}</TableCell>
                        <TableCell className="font-mono text-xs text-slate-300">{stamp(row.exit_timestamp)}</TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-slate-200">
                          {Number(row.actual_hours).toFixed(2)}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-semibold text-amber-400">
                          {Number(row.ot_hours).toFixed(2)}
                        </TableCell>
                        <TableCell className="text-xs font-mono">{row.duty_type || '—'}</TableCell>
                        <TableCell className="text-xs">{row.holiday_pay_eligible ? 'Yes' : 'No'}</TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate" title={row.remarks}>
                          {row.remarks || '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.leave ? `${row.leave.approval_status} / ${row.leave.pay_treatment}` : '—'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {/* Linked Leave Requests Section */}
          <div className="space-y-4 pt-4">
            <div className="border-b border-white/5 pb-2">
              <h2 className="text-lg font-bold text-slate-100">Linked Leave Requests</h2>
              <p className="text-xs text-slate-400">Decide all pending factory leave requests submitted with this roster before locking.</p>
            </div>

            {!data.rows.some(r => r.leave) && (
              <div className="glass-panel p-6 rounded-2xl border border-white/10 text-center">
                <p className="text-xs text-slate-400">No linked leave requests.</p>
              </div>
            )}

            {data.rows.filter(r => r.leave).map(row => (
              <LeaveDecision
                key={`${row.leave.id}-${row.leave.approval_status}`}
                sheetId={sheetId}
                leave={row.leave}
                employee={row.employee}
                actors={data.actors}
                local={data.sheet.employee_category === 'Local Daily-Wage Workers'}
                disabled={busy || !submitted}
                onDecide={(_id, leaveId, body) => mutation.mutate({ kind: 'leave', leaveId, body })}
              />
            ))}
          </div>

          {/* Final Decision Section */}
          {submitted && (
            <section className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 space-y-4">
              <div className="border-b border-white/5 pb-2">
                <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
                  Final Decision
                </span>
                <h3 className="text-base font-bold text-slate-100 mt-0.5">Audit Sign-Off & Review Actions</h3>
              </div>

              {data.review.blocking_reason && (
                <div className="p-3.5 rounded-xl border border-amber-500/20 bg-amber-500/10">
                  <p role="status" className="text-xs font-semibold text-amber-400">
                    {data.review.blocking_reason}
                  </p>
                </div>
              )}

              <Input
                label="HO Remarks"
                maxLength={2000}
                value={remarks}
                disabled={busy}
                placeholder="Remarks are required to return a sheet for correction"
                onChange={e => setRemarks(e.target.value)}
              />
              <p className="text-xs text-slate-400">
                Remarks are required to return a sheet. Review &amp; Lock freezes all attendance and exceptions in one transaction.
              </p>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button
                  variant="danger"
                  disabled={busy || !remarks.trim()}
                  onClick={() => mutation.mutate({ kind: 'return' })}
                >
                  Return for Correction
                </Button>
                <Button
                  variant="success"
                  disabled={busy || !data.review.can_review}
                  onClick={() => mutation.mutate({ kind: 'review' })}
                >
                  Review &amp; Lock
                </Button>
              </div>
            </section>
          )}

          {/* History Section */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowHistory(v => !v)}
            >
              {showHistory ? 'Hide History' : 'Show History'}
            </Button>

            {showHistory && (
              <section aria-label="Sheet History" className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
                <div className="border-b border-white/5 pb-2">
                  <h3 className="text-sm font-bold text-slate-100">Audit History Log</h3>
                </div>
                <SheetAuditTimeline
                  events={history.data?.history || []}
                  pagination={{
                    currentPage: historyPage,
                    totalPages: history.data?.pagination?.totalPages || 1,
                    totalItems: history.data?.pagination?.totalItems || 0,
                    onPageChange: setHistoryPage
                  }}
                  loading={history.isPending}
                  error={history.isError ? history.error : null}
                  onRetry={() => history.refetch()}
                  emptyMessage="No history events."
                />
              </section>
            )}
          </div>
        </>
      )}
    </main>
  );
}
