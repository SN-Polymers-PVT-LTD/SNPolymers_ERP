import React from 'react';
import { Badge, Button, Pagination } from '../ui';

const stamp = value => {
  if (!value) return '—';
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Kolkata',
      dateStyle: 'medium',
      timeStyle: 'medium',
      hour12: false
    }).format(new Date(value));
  } catch {
    return String(value);
  }
};

function getActionColor(action = '') {
  const norm = action.toUpperCase();
  if (norm.includes('SUBMIT')) return 'blue';
  if (norm.includes('RETURN') || norm.includes('REJECT')) return 'red';
  if (norm.includes('LOCK') || norm.includes('APPROVE') || norm.includes('REVIEW')) return 'emerald';
  if (norm.includes('LEAVE')) return 'amber';
  return 'slate';
}

function getInitials(name = '') {
  if (!name) return '—';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function SheetAuditTimeline({
  events = [],
  pagination,
  loading = false,
  error = null,
  onRetry,
  emptyMessage = 'No history for this sheet.'
}) {
  if (loading) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        <p role="status">Loading history…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-xs text-red-400 flex items-center justify-between">
        <p role="alert">{typeof error === 'string' ? error : error?.response?.data?.message || 'Unable to load history.'}</p>
        {onRetry && (
          <Button size="xs" variant="secondary" onClick={onRetry}>
            Retry History
          </Button>
        )}
      </div>
    );
  }

  if (!events.length) {
    return (
      <div className="p-6 text-center text-xs text-slate-400">
        <p>{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative pl-6 border-l-2 border-white/10 space-y-4 my-2">
        {events.map(event => {
          const actionColor = getActionColor(event.action);
          const initials = getInitials(event.user_name);
          const formattedStamp = stamp(event.timestamp);

          return (
            <div key={event.id} className="relative group">
              {/* Timeline Node Dot */}
              <div
                className={`absolute -left-[31px] top-1.5 h-3.5 w-3.5 rounded-full border-2 border-slate-900 ${
                  actionColor === 'blue'
                    ? 'bg-blue-400'
                    : actionColor === 'red'
                    ? 'bg-red-400'
                    : actionColor === 'emerald'
                    ? 'bg-emerald-400'
                    : actionColor === 'amber'
                    ? 'bg-amber-400'
                    : 'bg-slate-400'
                }`}
              />

              {/* Event Content Tile */}
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 hover:border-white/10 transition space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={actionColor} showDot={false}>
                      {event.action}
                    </Badge>
                    {/* Retains exact match pattern: SHEET_SUBMITTED · Factory Operator */}
                    <span className="text-xs font-semibold text-slate-200">
                      {event.action} · {event.user_name}
                    </span>
                  </div>
                  <time dateTime={event.timestamp} title={event.timestamp} className="text-[11px] font-mono text-slate-400">
                    {formattedStamp} IST
                  </time>
                </div>

                {[...new Set(['return_remarks','review_remarks','decision_remarks','remarks']
                  .filter(key => event.new_value?.[key] && (event.new_value[key] !== event.old_value?.[key]
                    || {SHEET_RETURNED:'return_remarks',SHEET_HO_REVIEWED:'review_remarks',SHEET_LOCKED:'review_remarks',LEAVE_APPROVED:'decision_remarks',LEAVE_REJECTED:'decision_remarks'}[event.action] === key))
                  .map(key => event.new_value[key]))].map(remark => <blockquote key={remark} className="text-xs text-slate-300 whitespace-pre-wrap border-l-2 border-amber-500/40 pl-3">{remark}</blockquote>)}
                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span className="w-5 h-5 rounded-full bg-white/10 text-[10px] font-bold text-slate-200 flex items-center justify-center shrink-0">
                    {initials}
                  </span>
                  <span className="font-medium text-slate-200">{event.user_name}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {pagination && pagination.totalPages > 1 && (
        <Pagination
          currentPage={pagination.currentPage}
          totalPages={pagination.totalPages}
          onPageChange={pagination.onPageChange}
          showLabel
          totalRecords={pagination.totalItems}
        />
      )}
    </div>
  );
}
