import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Table, TableHeader, TableBody, TableRow, TableCell, Pagination } from '../../components/ui';
import { getFactoryRevisions, createFactoryRevision, getEffectiveFactoryMasters } from '../../api/hrFactoryMastersApi';
import { CATEGORIES } from '../admin/employeeConstants';

const factoryCategories = CATEGORIES.filter(category => !['HO Staff', 'Projects Department Employees'].includes(category));
const wageCategories = ['SNP Casual Factory Labour', 'Local Daily-Wage Workers'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
function defaults(category) {
  const local = category === 'Local Daily-Wage Workers';
  const casual = category === 'SNP Casual Factory Labour';
  return {
    effective_from: '', daily_wage: local ? '350' : '400', standard_duty_hours: local ? '12' : '8',
    ot_enabled: true, ot_method: local ? 'Derived from daily wage' : casual ? 'Fixed Hourly' : 'Salary-derived hourly',
    ot_rate: casual ? '50' : '', ot_multiplier: casual ? '' : '1',
    holiday_pay_enabled: !local, holiday_multiplier: local ? '' : '1.5',
    management_stoppage_treatment: local ? 'Not Applicable' : casual ? 'Full daily wage' : 'No salary deduction',
    short_hours_treatment: '', comp_off_rule: local || casual ? '' : 'Next-day CO: no deduction',
    double_duty_multiplier: local ? '2' : ''
  };
}

export default function FactoryMasters() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('tab') === 'rules' ? 'rules' : 'wages';
  const categories = kind === 'wages' ? wageCategories : factoryCategories;
  const rawCategory = params.get('category');
  const category = categories.includes(rawCategory) ? rawCategory : categories[0];
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today();
  const { user } = useAuth();
  const canWrite = ['admin', 'factory_manager'].includes(user?.role);
  const client = useQueryClient();
  const [formKey, setFormKey] = useState(0);
  const [success, setSuccess] = useState('');
  const change = (values) => {
    setSuccess('');
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(values)) next.set(key, String(value));
      if (!Object.hasOwn(values, 'page')) next.delete('page');
      return next;
    });
  };
  const query = useQuery({ queryKey: ['hr-factory-revisions', kind, category, asOf, page],
    queryFn: async () => (await getFactoryRevisions(kind, { employee_category: category, as_of: asOf, page, limit: 20 })).data });
  const effective = useQuery({ queryKey: ['hr-factory-effective', category, asOf],
    queryFn: async () => (await getEffectiveFactoryMasters({ employee_category: category, date: asOf })).data });
  const save = useMutation({ mutationFn: body => createFactoryRevision(kind, body), onSuccess: () => {
    client.invalidateQueries({ queryKey: ['hr-factory-revisions'] });
    client.invalidateQueries({ queryKey: ['hr-factory-effective'] });
    setFormKey(value => value + 1); setSuccess('Revision saved. Existing revisions are preserved.');
  } });
  const title = kind === 'wages' ? 'Factory Labour Wage Master' : 'Factory Attendance & Pay Rule Master';
  return <div className="space-y-6">
    <h1 className="text-2xl font-bold">{title}</h1>
    <div className="flex gap-3">
      <Button disabled={save.isPending} variant={kind === 'wages' ? 'primary' : 'secondary'} onClick={() => { save.reset(); change({ tab: 'wages', category: wageCategories[0] }); }}>Wage Master</Button>
      <Button disabled={save.isPending} variant={kind === 'rules' ? 'primary' : 'secondary'} onClick={() => { save.reset(); change({ tab: 'rules', category: factoryCategories[0] }); }}>Pay Rule Master</Button>
    </div>
    <div className="grid md:grid-cols-2 gap-4">
      <Select disabled={save.isPending} label="Employee Category" value={category} options={categories.map(value => ({ value, label: value }))} onChange={event => { save.reset(); change({ category: event.target.value }); }} />
      <Input disabled={save.isPending} label="Applicable On" type="date" value={asOf} onChange={event => event.target.value && change({ date: event.target.value })} />
    </div>
    {effective.isPending ? <p role="status">Loading applicable configuration…</p> : effective.isError ? <p role="alert">Unable to load applicable configuration. <Button onClick={() => effective.refetch()}>Retry</Button></p> :
      <div className="p-4 rounded-xl bg-white/5 text-sm space-y-2">
        <p>Applicable wage: {effective.data?.wage_revision ? `₹${effective.data.wage_revision.daily_wage} from ${effective.data.wage_revision.effective_from}` : wageCategories.includes(category) ? 'Not configured' : 'Existing Permanent Employee Pay Structure'}</p>
        <p>Applicable rule: {effective.data?.rule_revision ? `${effective.data.rule_revision.standard_duty_hours} standard hours from ${effective.data.rule_revision.effective_from}` : 'Not configured'}</p>
        {kind === 'wages' && effective.data?.rule_revision && <p>OT method: {effective.data.rule_revision.ot_method}; {effective.data.rule_revision.ot_rate !== null ? `₹${effective.data.rule_revision.ot_rate}/hour` : `${effective.data.rule_revision.ot_multiplier}×`}; Double duty: {effective.data.rule_revision.double_duty_multiplier ?? 'Not applicable'}. Maintained in Pay Rule Master.</p>}
      </div>}
    {canWrite && <RevisionForm key={`${kind}:${category}:${formKey}`} kind={kind} category={category} pending={save.isPending} onSave={body => { setSuccess(''); save.mutate(body); }} />}
    {save.isError && <p role="alert">{save.error.response?.data?.message || 'Unable to save revision.'}</p>}
    {success && <p role="status">{success}</p>}
    <h2 className="text-lg font-bold">Revision History</h2>
    {query.isPending ? <p role="status">Loading revisions…</p> : query.isError ? <p role="alert">Unable to load revisions. <Button onClick={() => query.refetch()}>Retry</Button></p> : <>
      {!query.data?.revisions?.length ? <p>No revisions for this category.</p> : <Table className="min-w-[1000px]">
        <TableHeader><TableRow>{['Effective From', kind === 'wages' ? 'Daily Wage (₹)' : 'Standard Hours', 'Status', ...(kind === 'rules' ? ['OT', 'Holiday', 'Double Duty', 'Management Stoppage', 'Short Hours', 'Comp Off'] : []), 'Revision'].map(label => <TableCell key={label} isHeader>{label}</TableCell>)}</TableRow></TableHeader>
        <TableBody>{query.data.revisions.map(row => <TableRow key={row.id}>
          <TableCell>{row.effective_from}</TableCell><TableCell>{kind === 'wages' ? row.daily_wage : row.standard_duty_hours}</TableCell><TableCell>{row.display_status}</TableCell>
          {kind === 'rules' && <><TableCell>{row.ot_enabled ? `${row.ot_method}: ${row.ot_rate ?? row.ot_multiplier}` : 'Disabled'}</TableCell><TableCell>{row.holiday_pay_enabled ? `${row.holiday_multiplier}×` : 'Not enabled'}</TableCell><TableCell>{row.double_duty_multiplier ?? 'N/A'}</TableCell><TableCell>{row.management_stoppage_treatment}</TableCell><TableCell>{row.short_hours_treatment ?? 'Not configured'}</TableCell><TableCell>{row.comp_off_rule ?? 'N/A'}</TableCell></>}
          <TableCell>{row.revision_number}</TableCell>
        </TableRow>)}</TableBody>
      </Table>}
      <Pagination currentPage={page} totalPages={query.data?.pagination?.totalPages} onPageChange={value => change({ page: value })} showLabel totalRecords={query.data?.pagination?.totalItems} />
    </>}
  </div>;
}

function RevisionForm({ kind, category, onSave, pending }) {
  const [form, setForm] = useState(() => defaults(category));
  const local = category === 'Local Daily-Wage Workers';
  const wage = wageCategories.includes(category);
  const field = name => ({ value: form[name], onChange: event => setForm(prev => ({ ...prev, [name]: event.target.value })) });
  const numeric = name => form[name] === '' ? null : Number(form[name]);
  const submit = event => {
    event.preventDefault();
    const body = { employee_category: category, effective_from: form.effective_from };
    if (kind === 'wages') body.daily_wage = Number(form.daily_wage);
    else Object.assign(body, { standard_duty_hours: Number(form.standard_duty_hours), ot_enabled: form.ot_enabled, ot_method: form.ot_method,
      ot_rate: form.ot_method === 'Fixed Hourly' ? numeric('ot_rate') : null,
      ot_multiplier: form.ot_method === 'Fixed Hourly' ? null : numeric('ot_multiplier'),
      holiday_pay_enabled: !local && form.holiday_pay_enabled, holiday_multiplier: !local && form.holiday_pay_enabled ? numeric('holiday_multiplier') : null,
      management_stoppage_treatment: form.management_stoppage_treatment.trim(), short_hours_treatment: form.short_hours_treatment.trim() || null,
      comp_off_rule: form.comp_off_rule.trim() || null, double_duty_multiplier: local ? numeric('double_duty_multiplier') : null });
    onSave(body);
  };
  return <form onSubmit={submit} className="p-5 rounded-xl border border-white/10 space-y-4">
    <h2 className="font-bold">New Revision</h2>
    <p className="text-sm text-slate-400">Starting references are editable. Select the effective date before saving.</p>
    <fieldset disabled={pending} className="grid md:grid-cols-2 gap-4">
      <Input label="Effective From" type="date" required {...field('effective_from')} />
      {kind === 'wages' ? <Input label="Daily Wage (₹)" type="number" min="0" step="0.01" required {...field('daily_wage')} /> : <>
        <Input label="Standard Duty Hours" type="number" min="0.0001" step="0.0001" required {...field('standard_duty_hours')} />
        <Select label="OT Enabled" value={String(form.ot_enabled)} onChange={event => setForm(prev => ({ ...prev, ot_enabled: event.target.value === 'true' }))} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
        <Select label="OT Method" value={form.ot_method} onChange={event => setForm(prev => ({ ...prev, ot_method: event.target.value, ot_rate: event.target.value === 'Fixed Hourly' ? '50' : '', ot_multiplier: event.target.value === 'Fixed Hourly' ? '' : '1' }))} options={['Fixed Hourly', wage ? 'Derived from daily wage' : 'Salary-derived hourly'].map(value => ({ value, label: value }))} />
        {form.ot_method === 'Fixed Hourly' ? <Input label="OT Hourly Rate (₹)" type="number" min="0" step="0.01" required {...field('ot_rate')} /> : <Input label="OT Multiplier" type="number" min="0.0001" step="0.0001" required {...field('ot_multiplier')} />}
        {!local && <><Select label="Holiday Pay Enabled" value={String(form.holiday_pay_enabled)} onChange={event => setForm(prev => ({ ...prev, holiday_pay_enabled: event.target.value === 'true' }))} options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />
          {form.holiday_pay_enabled && <Input label="Holiday Multiplier" type="number" min="0.0001" step="0.0001" required {...field('holiday_multiplier')} />}</>}
        {local && <><p>Holiday-work pay is not applicable to local workers.</p><Input label="Double Duty Multiplier" type="number" min="0.0001" step="0.0001" required {...field('double_duty_multiplier')} /></>}
        <Input label="Management Stoppage Treatment" required maxLength={500} {...field('management_stoppage_treatment')} />
        <Input label="Short Hours Treatment" maxLength={500} {...field('short_hours_treatment')} />
        <Input label="Comp Off Rule" maxLength={500} {...field('comp_off_rule')} />
      </>}
    </fieldset>
    <Button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save Revision'}</Button>
  </form>;
}
