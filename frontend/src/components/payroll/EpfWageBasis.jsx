import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Select } from '../ui';
import { confirmEpfWageBasis, getEpfWageBases, recordEpfWageBasis } from '../../api/payrollProfilesApi';

const errorMessage = error => error.response?.data?.message || error.message;
const blank = { pay_structure_id: '', effective_from: '', regular_wages: '', reason: '', confirmed_allowances: false };

export default function EpfWageBasis({ employeeId }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blank);
  const client = useQueryClient();
  const key = ['epf-wage-bases', employeeId];
  const query = useQuery({
    queryKey: key, enabled: open,
    queryFn: async () => (await getEpfWageBases(employeeId)).data.result,
  });
  const save = useMutation({
    mutationFn: async pending => (await (pending ? confirmEpfWageBasis(employeeId, {
      pay_structure_id: pending.pay_structure_id, effective_from: pending.effective_from,
    }) : recordEpfWageBasis(employeeId, form))).data.result,
    onSuccess: result => {
      client.setQueryData(key, result);
      setForm(blank);
      for (const queryKey of ['payroll-review-queue', 'payroll-employee-review', 'payroll-preview-run', 'payroll-selected-run']) {
        client.invalidateQueries({ queryKey: [queryKey] });
      }
    },
  });
  const change = (name, value) => {
    save.reset();
    setForm(current => ({ ...current, [name]: value }));
  };
  return <details className="rounded-2xl border border-slate-300/50 p-4 dark:border-white/10" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer font-semibold">EPF regular wages</summary>
    {open && <div className="mt-3 space-y-3">
      {query.isPending ? <p role="status">Loading salary revisions…</p> : query.isError
        ? <div role="alert">{errorMessage(query.error)} <Button onClick={() => query.refetch()}>Retry</Button></div>
        : query.data.salary_revisions.length ? <>
          <p className="text-sm">Set this once per salary revision. Payroll uses it from the selected month and picks up overtime automatically.</p>
          <ul className="space-y-1 text-sm">
            {query.data.wage_bases.map(basis => <li key={`${basis.pay_structure_id}:${basis.effective_from}`}>
              From {basis.effective_from} · ₹{basis.regular_wages} regular wages · {basis.reason}
              {basis.pending_accounts_confirmation && <div className="my-2 flex flex-wrap items-center gap-2">
                <span>Pending Accounts confirmation. Check that any remaining gross is excluded pay counted in the EPF 50% test.</span>
                <Button size="sm" variant="yellow" disabled={save.isPending} onClick={() => save.mutate(basis)}>Confirm wage basis</Button>
              </div>}
            </li>)}
          </ul>
          <details><summary className="cursor-pointer text-sm">Set up an existing salary revision</summary>
          <fieldset className="grid gap-3 sm:grid-cols-2" disabled={save.isPending}>
            <Select label="Salary revision" value={form.pay_structure_id}
              options={[{ value: '', label: 'Choose an enrolled salary revision' }, ...query.data.salary_revisions.map(revision => ({
                value: revision.id, label: `Revision ${revision.revision} · ₹${revision.gross} monthly gross`,
              }))]}
              onChange={event => change('pay_structure_id', event.target.value)} />
            <Input label="Monthly regular wages (₹)" inputMode="decimal" value={form.regular_wages} onChange={event => change('regular_wages', event.target.value)} />
            <Input label="Applies from" type="month" min="2025-12" value={form.effective_from.slice(0, 7)}
              onChange={event => change('effective_from', event.target.value ? `${event.target.value}-01` : '')} />
            <Input label="Reason or approval reference" maxLength={2000} value={form.reason} onChange={event => change('reason', event.target.value)} />
            <label className="flex items-start gap-2 text-sm sm:col-span-2">
              <input type="checkbox" checked={form.confirmed_allowances} onChange={event => change('confirmed_allowances', event.target.checked)} />
              I confirm the remaining recurring pay is excluded remuneration included in the EPF 50% test.
            </label>
          </fieldset>
          <Button variant="yellow" loading={save.isPending}
            disabled={!form.pay_structure_id || !form.effective_from || !form.regular_wages.trim() || !form.reason.trim() || !form.confirmed_allowances}
            onClick={() => save.mutate()}>Save EPF regular wages</Button>
          </details>
          {save.isSuccess && <p role="status">Saved. Open the draft payroll to review the updated EPF deduction.</p>}
          {save.isError && <p role="alert">{errorMessage(save.error)}</p>}
        </> : <p>No EPF-enrolled salary revisions are available.</p>}
    </div>}
  </details>;
}
