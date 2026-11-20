import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Pagination } from '../ui';
import { getEmployeeAdjustments, createEmployeeAdjustment, actOnAdjustment } from '../../api/payrollLedgerApi';

const blank = () => ({
  kind: 'ADVANCE',
  amount: '',
  effective_date: '',
  evidence_reference: '',
  installment: '',
  recovery_start_month: ''
});

const message = (e) => e?.response?.data?.message || e.message;

export default function EmployeeAdjustments({ employeeId, user, employeeSelf = false }) {
  const client = useQueryClient();
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState(blank);
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(null);
  const [plan, setPlan] = useState({ installment: '', recovery_start_month: '' });

  const query = useQuery({
    queryKey: ['payroll-adjustments', user.id, employeeId, page],
    queryFn: async () => (await getEmployeeAdjustments(employeeId, { page, limit: 20 })).data.result
  });

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['payroll-adjustments'] });
    client.invalidateQueries({ queryKey: ['payroll-employee-review'] });
  };

  const save = useMutation({
    mutationFn: () =>
      createEmployeeAdjustment(employeeId, {
        ...draft,
        target_row_id: null,
        original_period_from: null,
        original_period_to: null
      }),
    onSuccess: () => {
      setDraft(blank());
      refresh();
    }
  });

  const action = useMutation({
    mutationFn: ({ row, kind }) =>
      actOnAdjustment(row.id, {
        action: kind,
        expected_version: row.version,
        reason: reason.trim(),
        data: kind === 'revise_plan' ? plan : {}
      }),
    onSuccess: () => {
      setEditing(null);
      setReason('');
      refresh();
    }
  });

  const busy = save.isPending || action.isPending;

  return (
    <details className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 text-xs space-y-3 transition-colors duration-200 group">
      <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between select-none">
        <span className="flex items-center gap-2">
          <svg className="w-4 h-4 text-indigo-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a4 4 0 00-8 0v2M5 9h14l-1 11H6L5 9z" />
          </svg>
          Employee adjustments and issued advances
        </span>
        <span className="text-[10px] text-slate-500 group-open:rotate-180 transition-transform">▼</span>
      </summary>

      <div className="pt-2 space-y-3 text-slate-600 dark:text-slate-300">
        <p className="text-slate-600 dark:text-slate-400">
          HO approves each entry independently. Advances are recorded after external issuance; approved monthly recoveries apply only when salary locking succeeds. No money transfer is initiated here.
        </p>

        {query.isPending ? (
          <p role="status" className="text-slate-400 italic">Loading adjustments…</p>
        ) : query.isError ? (
          <p role="alert" className="text-rose-500 font-medium">
            {message(query.error)} <Button onClick={() => query.refetch()}>Retry adjustments</Button>
          </p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-slate-500 text-xs font-mono">
              <p>{query.data.rows.filter(row => row.kind === 'ADVANCE').length} advances on this page.</p>
            </div>
            {query.data.rows.filter(row => row.kind === 'ADVANCE').map(row => (
              <div key={row.id} className="p-3.5 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 space-y-2">
                <p className="font-medium text-slate-800 dark:text-slate-200">
                  {row.kind} · {row.amount} · {row.status} · {row.effective_date}
                  {row.kind === 'ADVANCE' && ` · Monthly recovery ${row.installment} · Outstanding ${row.outstanding_balance ?? 'not available'}`}
                </p>

                {user.role === 'ho' && !employeeSelf && row.created_by !== user.id && ['DRAFT', 'APPROVED', 'PAUSED'].includes(row.status) && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {(row.status === 'DRAFT'
                      ? row.kind === 'ADVANCE' ? ['approve', 'reject'] : ['reject']
                      : row.kind === 'ADVANCE'
                      ? [row.status === 'PAUSED' ? 'resume' : 'pause']
                      : []
                    ).map(kind => (
                      <Button
                        key={kind}
                        disabled={busy || !reason.trim()}
                        onClick={() => action.mutate({ row, kind })}
                      >
                        {kind} {row.kind}
                      </Button>
                    ))}
                  </div>
                )}

                {['accounts', 'admin'].includes(user.role) && row.kind === 'ADVANCE' && ['APPROVED', 'PAUSED'].includes(row.status) && (
                  <Button
                    disabled={busy}
                    onClick={() => {
                      setEditing(row);
                      setPlan({ installment: row.installment, recovery_start_month: row.recovery_start_month });
                    }}
                  >
                    Propose revised recovery plan
                  </Button>
                )}

                <details className="text-[10px] text-slate-500 group">
                  <summary className="cursor-pointer hover:text-slate-400 select-none">
                    Entry evidence and approval history
                  </summary>
                  <pre className="text-xs whitespace-pre-wrap font-mono text-slate-400 bg-black/40 p-2.5 rounded-lg overflow-x-auto border border-white/5 mt-1">
                    {JSON.stringify(row.history, null, 2)}
                  </pre>
                </details>
              </div>
            ))}
            <Pagination
              currentPage={page}
              totalPages={Math.ceil(query.data.total / 20)}
              onPageChange={setPage}
            />
          </div>
        )}

        <Input
          label="Adjustment approval / plan reason"
          value={reason}
          maxLength={2000}
          onChange={e => setReason(e.target.value)}
        />

        {editing && (
          <form
            onSubmit={e => {
              e.preventDefault();
              action.mutate({ row: editing, kind: 'revise_plan' });
            }}
            className="p-3.5 rounded-xl bg-amber-500/5 border border-amber-500/20 space-y-3"
          >
            <Input
              label="Revised monthly recovery"
              required
              inputMode="decimal"
              value={plan.installment}
              onChange={e => setPlan(p => ({ ...p, installment: e.target.value }))}
            />
            <Input
              label="Revised recovery start month"
              type="date"
              required
              value={plan.recovery_start_month}
              onChange={e => setPlan(p => ({ ...p, recovery_start_month: e.target.value }))}
            />
            <p className="text-amber-600 dark:text-amber-400">
              Revision suspends recovery until HO independently approves the new plan.
            </p>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy || !reason.trim()}>
                Submit revised plan
              </Button>
              <Button onClick={() => setEditing(null)} disabled={busy} variant="secondary">
                Cancel plan edit
              </Button>
            </div>
          </form>
        )}

        {['accounts', 'admin'].includes(user.role) && !employeeSelf && (
        <form
          className="space-y-3 p-3.5 rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200 dark:border-white/5"
          onSubmit={e => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <h3 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Record a salary advance
          </h3>
          {['amount', 'effective_date', 'evidence_reference', 'installment', 'recovery_start_month'].map(key => (
            <Input
              key={key}
              label={`Adjustment ${key.replaceAll('_', ' ')}`}
              required
              type={key.includes('date') || key.includes('month') || key.startsWith('original_period') ? 'date' : 'text'}
              value={draft[key]}
              onChange={e => setDraft(d => ({ ...d, [key]: e.target.value }))}
            />
          ))}
          <Button type="submit" disabled={busy}>
            Record for HO approval
          </Button>
        </form>
        )}

        {[save.error, action.error].filter(Boolean).map((e, i) => (
          <p role="alert" key={i} className="text-rose-500 font-medium text-xs">
            {message(e)}
          </p>
        ))}
        {save.isSuccess && (
          <p role="status" className="text-emerald-500 font-medium text-xs">
            Entry recorded. HO approval is required before application.
          </p>
        )}
      </div>
    </details>
  );
}
