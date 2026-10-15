import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Input, Select, Button } from '../ui';
import { getIndianBanks, upsertBeneficiary } from '../../api/acctRequisitionsApi';

const blank = { beneficiary_name: '', account_number: '', ifsc: '', beneficiary_bank_id: '' };
const fields = record => Object.fromEntries(Object.keys(blank).map(key => [key, record?.[key] || '']));

export default function EmployeeBeneficiary({ value, record, onChange, onReady }) {
  const client = useQueryClient();
  const [saved, setSaved] = useState(record);
  const [draft, setDraft] = useState(() => fields(record));
  const [dirty, setDirty] = useState(false);
  const banks = useQuery({ queryKey: ['employee-beneficiary-banks'], queryFn: async () => (await getIndianBanks()).data.indianBanks });
  const save = useMutation({
    mutationFn: () => upsertBeneficiary(draft),
    onSuccess: r => {
      setSaved(r.data.beneficiary);
      onChange(r.data.beneficiary.id);
      setDraft(fields(r.data.beneficiary));
      setDirty(false);
      onReady(true);
      client.invalidateQueries({ queryKey: ['employee-beneficiaries'] });
    },
    onError: () => onReady(false),
  });
  const edit = (key, next) => {
    setDraft(previous => ({ ...previous, [key]: next }));
    setDirty(true);
    onReady(false);
    save.reset();
  };
  const discard = () => {
    setDraft(fields(saved));
    setDirty(false);
    onReady(true);
    save.reset();
  };
  const bankOptions = (banks.data || []).filter(bank => bank.is_active || bank.id === saved?.beneficiary_bank_id)
    .map(bank => ({ value: bank.id, label: `${bank.bank_name}${bank.is_active ? '' : ' (inactive)'}` }));
  if (saved?.beneficiary_bank_id && !bankOptions.some(bank => bank.value === saved.beneficiary_bank_id)) {
    bankOptions.push({ value: saved.beneficiary_bank_id, label: saved.beneficiary_bank_name || 'Previously saved bank' });
  }
  const valid = draft.beneficiary_name.trim() && /^\d{9,18}$/.test(draft.account_number)
    && /^[A-Z]{4}0[A-Z0-9]{6}$/.test(draft.ifsc) && draft.beneficiary_bank_id;

  return <section aria-label="Employee beneficiary" className="rounded-2xl border border-slate-200/70 dark:border-white/10 bg-white/50 dark:bg-white/5 p-5 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-bold text-slate-900 dark:text-white">Beneficiary details <span className="text-xs font-normal text-slate-500">(optional)</span></h3>
      {value && <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Beneficiary linked</span>}
    </div>
    <p className="text-xs text-slate-500 dark:text-slate-400">Enter the employee’s bank details and save the beneficiary before saving the employee.</p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Input label="Beneficiary name" value={draft.beneficiary_name} disabled={save.isPending} placeholder="Name on bank account" onChange={e => edit('beneficiary_name', e.target.value)} />
      <Input label="Account number" value={draft.account_number} inputMode="numeric" maxLength={18} disabled={save.isPending} placeholder="9–18 digit account number" onChange={e => edit('account_number', e.target.value)} />
      <Input label="IFSC" value={draft.ifsc} maxLength={11} disabled={save.isPending} placeholder="e.g. SBIN0001234" onChange={e => edit('ifsc', e.target.value.toUpperCase())} />
      {banks.isPending ? <p role="status" className="text-xs self-center">Loading banks…</p> : banks.isError ? <div role="alert" className="text-xs text-red-600 dark:text-red-300">Unable to load banks. <Button type="button" onClick={() => banks.refetch()}>Retry banks</Button></div> : <Select label="Bank" value={draft.beneficiary_bank_id} disabled={save.isPending} options={[{ value: '', label: 'Select bank' }, ...bankOptions]} onChange={e => edit('beneficiary_bank_id', e.target.value)} />}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" disabled={save.isPending || !dirty || !valid || banks.isError || banks.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving beneficiary…' : 'Save beneficiary'}</Button>
      {dirty && <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={discard}>Discard changes</Button>}
      {value && <Button type="button" size="sm" variant="ghost" disabled={save.isPending} onClick={() => { onChange(null); setSaved(null); setDraft(blank); setDirty(false); onReady(true); save.reset(); }}>Remove beneficiary link</Button>}
    </div>
    {dirty && <p className="text-xs text-amber-700 dark:text-amber-300">Save or discard beneficiary changes before saving the employee.</p>}
    {save.isSuccess && !dirty && <p role="status" className="text-xs text-emerald-700 dark:text-emerald-300">Beneficiary saved. Save the employee to apply the link.</p>}
    {save.error && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{save.error.response?.data?.message || save.error.message}</p>}
  </section>;
}
