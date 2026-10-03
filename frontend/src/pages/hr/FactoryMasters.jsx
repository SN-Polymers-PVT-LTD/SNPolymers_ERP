import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Badge, Table, TableHeader, TableBody, TableRow, TableCell, Pagination } from '../../components/ui';
import { getFactoryRevisions, createFactoryRevision, getEffectiveFactoryMasters } from '../../api/hrFactoryMastersApi';
import { CATEGORIES } from '../admin/employeeConstants';

const factoryCategories = CATEGORIES.filter(category => !['HO Staff', 'Projects Department Employees'].includes(category));
const wageCategories = ['SNP Casual Factory Labour', 'Local Daily-Wage Workers'];
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function defaults(category) {
  const local = category === 'Local Daily-Wage Workers';
  const casual = category === 'SNP Casual Factory Labour';
  return {
    effective_from: '',
    daily_wage: local ? '350' : '400',
    standard_duty_hours: local ? '12' : '8',
    ot_enabled: true,
    ot_method: local ? 'Derived from daily wage' : casual ? 'Fixed Hourly' : 'Salary-derived hourly',
    ot_rate: casual ? '50' : '',
    ot_multiplier: casual ? '' : '1',
    holiday_pay_enabled: !local,
    holiday_multiplier: local ? '' : '1.5',
    management_stoppage_treatment: local ? 'Not Applicable' : casual ? 'Full daily wage' : 'No salary deduction',
    short_hours_treatment: '',
    comp_off_rule: local || casual ? '' : 'Next-day CO: no deduction',
    double_duty_multiplier: local ? '2' : ''
  };
}

function revisionStatusVariant(status) {
  if (status === 'Active') return 'emerald';
  if (status === 'Scheduled') return 'blue';
  return 'slate';
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

  const query = useQuery({
    queryKey: ['hr-factory-revisions', kind, category, asOf, page],
    queryFn: async () => (await getFactoryRevisions(kind, { employee_category: category, as_of: asOf, page, limit: 20 })).data
  });

  const effective = useQuery({
    queryKey: ['hr-factory-effective', category, asOf],
    queryFn: async () => (await getEffectiveFactoryMasters({ employee_category: category, date: asOf })).data
  });

  const save = useMutation({
    mutationFn: body => createFactoryRevision(kind, body),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['hr-factory-revisions'] });
      client.invalidateQueries({ queryKey: ['hr-factory-effective'] });
      setFormKey(value => value + 1);
      setSuccess('Revision saved.');
    }
  });

  const title = kind === 'wages' ? 'Factory Labour Wage Master' : 'Factory Attendance & Pay Rule Master';

  return (
    <div className="space-y-6 pb-12">
      {/* Page Title & Breadcrumb */}
      <div className="border-b border-white/5 pb-4">
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
          Factory Operations · Policy Master
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
          {title}
        </h1>
        <p className="text-xs text-slate-400 font-medium mt-1">
          Manage daily wage benchmarks, standard working hours, and duty pay rules for factory labour.
        </p>
      </div>

      {/* Pill Tabs */}
      <div className="flex items-center gap-2 p-1.5 rounded-2xl bg-white/5 border border-white/10 w-fit">
        <Button
          disabled={save.isPending}
          variant={kind === 'wages' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => { save.reset(); change({ tab: 'wages', category: wageCategories[0] }); }}
        >
          Daily Wage Master
        </Button>
        <Button
          disabled={save.isPending}
          variant={kind === 'rules' ? 'primary' : 'secondary'}
          size="sm"
          onClick={() => { save.reset(); change({ tab: 'rules', category: factoryCategories[0] }); }}
        >
          Attendance & Pay Rules
        </Button>
      </div>

      {/* Filter Toolbar Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60">
        <div className="grid md:grid-cols-2 gap-4">
          <Select
            disabled={save.isPending}
            label="Employee Category"
            value={category}
            options={categories.map(value => ({ value, label: value }))}
            onChange={event => { save.reset(); change({ category: event.target.value }); }}
          />
          <Input
            disabled={save.isPending}
            label="Applicable On"
            type="date"
            value={asOf}
            onChange={event => event.target.value && change({ date: event.target.value })}
          />
        </div>
      </div>

      {/* Applicable Policy Snapshot Card */}
      {effective.isPending ? (
        <div className="glass-panel p-5 rounded-2xl border border-white/10 text-center py-8">
          <p role="status" className="text-xs text-slate-400 font-medium">Loading applicable configuration…</p>
        </div>
      ) : effective.isError ? (
        <div className="glass-panel p-5 rounded-2xl border border-red-500/20 bg-red-500/5 text-center py-6 space-y-2">
          <p role="alert" className="text-xs text-red-400 font-medium">
            Unable to load applicable configuration.{' '}
            <Button size="xs" variant="secondary" onClick={() => effective.refetch()}>Retry</Button>
          </p>
        </div>
      ) : (
        <div className="glass-panel p-5 rounded-2xl border border-white/10 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-white/5">
            <div>
              <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
                Effective Policy Snapshot
              </span>
              <h3 className="text-sm font-bold text-slate-100 mt-0.5">
                Applicable on selected date: <span className="font-mono text-amber-400">{asOf}</span>
              </h3>
            </div>
            <Badge variant="blue" showDot={false}>{category}</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Applicable Wage</span>
              <span className="text-sm font-bold font-mono text-slate-100">
                {effective.data?.wage_revision
                  ? `₹${effective.data.wage_revision.daily_wage} from ${effective.data.wage_revision.effective_from}`
                  : wageCategories.includes(category)
                    ? 'Not configured'
                    : 'Existing Permanent Employee Pay Structure'}
              </span>
            </div>

            <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Standard Duty Hours</span>
              <span className="text-sm font-bold font-mono text-slate-100">
                {effective.data?.rule_revision
                  ? `${effective.data.rule_revision.standard_duty_hours} standard hours from ${effective.data.rule_revision.effective_from}`
                  : 'Not configured'}
              </span>
            </div>

            {effective.data?.rule_revision && (
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Overtime Policy</span>
                <span className="text-sm font-bold font-mono text-slate-100">
                  {effective.data.rule_revision.ot_enabled
                    ? `${effective.data.rule_revision.ot_method}: ${effective.data.rule_revision.ot_rate !== null ? `₹${effective.data.rule_revision.ot_rate}/hour` : `${effective.data.rule_revision.ot_multiplier}×`}`
                    : 'Disabled'}
                </span>
              </div>
            )}

            {effective.data?.rule_revision && (
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Double Duty Multiplier</span>
                <span className="text-sm font-bold font-mono text-slate-100">
                  {effective.data.rule_revision.double_duty_multiplier !== null
                    ? `${effective.data.rule_revision.double_duty_multiplier}×`
                    : 'Not applicable'}
                </span>
              </div>
            )}

            {effective.data?.rule_revision && (
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Holiday Pay Rule</span>
                <span className="text-sm font-bold font-mono text-slate-100">
                  {effective.data.rule_revision.holiday_pay_enabled
                    ? `${effective.data.rule_revision.holiday_multiplier}×`
                    : 'Not enabled'}
                </span>
              </div>
            )}

            {effective.data?.rule_revision && (
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
                <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Management Stoppage</span>
                <span className="text-xs font-semibold text-slate-200">
                  {effective.data.rule_revision.management_stoppage_treatment || 'Not configured'}
                </span>
              </div>
            )}
          </div>

          {kind === 'wages' && effective.data?.rule_revision && (
            <p className="text-xs text-slate-400 pt-1 border-t border-white/5">
              OT method: {effective.data.rule_revision.ot_method}; {effective.data.rule_revision.ot_rate !== null ? `₹${effective.data.rule_revision.ot_rate}/hour` : `${effective.data.rule_revision.ot_multiplier}×`}; Double duty: {effective.data.rule_revision.double_duty_multiplier ?? 'Not applicable'}. Maintained in Pay Rule Master.
            </p>
          )}
        </div>
      )}

      {/* Revision Form */}
      {canWrite && (
        <RevisionForm
          key={`${kind}:${category}:${formKey}`}
          kind={kind}
          category={category}
          pending={save.isPending}
          onSave={body => { setSuccess(''); save.mutate(body); }}
        />
      )}

      {save.isError && (
        <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/10 text-red-400 text-xs font-semibold">
          <p role="alert">{save.error.response?.data?.message || 'Unable to save revision.'}</p>
        </div>
      )}

      {success && (
        <div className="p-4 rounded-xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400 text-xs font-semibold">
          <p role="status">{success}</p>
        </div>
      )}

      {/* Revision History Section */}
      <div className="space-y-4 pt-4">
        <div className="border-b border-white/5 pb-2">
          <h2 className="text-lg font-bold text-slate-100">Revision History</h2>
          <p className="text-xs text-slate-400">Audit log of all historical and scheduled policy versions for this category.</p>
        </div>

        {query.isPending ? (
          <p role="status" className="text-xs text-slate-400">Loading revisions…</p>
        ) : query.isError ? (
          <p role="alert" className="text-xs text-red-400">
            Unable to load revisions.{' '}
            <Button size="xs" variant="secondary" onClick={() => query.refetch()}>Retry</Button>
          </p>
        ) : (
          <>
            {!query.data?.revisions?.length ? (
              <div className="glass-panel p-8 rounded-2xl border border-white/10 text-center">
                <p className="text-xs text-slate-400">No revisions for this category.</p>
              </div>
            ) : (
              <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="min-w-[1000px]">
                    <TableHeader>
                      <TableRow>
                        {[
                          'Effective From',
                          kind === 'wages' ? 'Daily Wage (₹)' : 'Standard Hours',
                          'Status',
                          ...(kind === 'rules' ? ['OT', 'Holiday', 'Double Duty', 'Management Stoppage', 'Short Hours', 'Comp Off'] : []),
                          'Revision'
                        ].map(label => (
                          <TableCell key={label} isHeader>{label}</TableCell>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {query.data.revisions.map(row => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono font-semibold text-slate-200">{row.effective_from}</TableCell>
                          <TableCell className="font-mono font-semibold text-amber-400">
                            {kind === 'wages' ? `₹${row.daily_wage}` : row.standard_duty_hours}
                          </TableCell>
                          <TableCell>
                            <Badge variant={revisionStatusVariant(row.display_status)}>
                              {row.display_status}
                            </Badge>
                          </TableCell>
                          {kind === 'rules' && (
                            <>
                              <TableCell className="text-xs">
                                {row.ot_enabled ? `${row.ot_method}: ${row.ot_rate ?? row.ot_multiplier}` : 'Disabled'}
                              </TableCell>
                              <TableCell className="text-xs">
                                {row.holiday_pay_enabled ? `${row.holiday_multiplier}×` : 'Not enabled'}
                              </TableCell>
                              <TableCell className="font-mono text-xs">{row.double_duty_multiplier ?? 'N/A'}</TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate" title={row.management_stoppage_treatment}>
                                {row.management_stoppage_treatment}
                              </TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate" title={row.short_hours_treatment ?? 'Not configured'}>
                                {row.short_hours_treatment ?? 'Not configured'}
                              </TableCell>
                              <TableCell className="text-xs max-w-[150px] truncate" title={row.comp_off_rule ?? 'N/A'}>
                                {row.comp_off_rule ?? 'N/A'}
                              </TableCell>
                            </>
                          )}
                          <TableCell className="font-mono text-xs text-slate-400">v{row.revision_number}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}
            <Pagination
              currentPage={page}
              totalPages={query.data?.pagination?.totalPages}
              onPageChange={value => change({ page: value })}
              showLabel
              totalRecords={query.data?.pagination?.totalItems}
            />
          </>
        )}
      </div>
    </div>
  );
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
    if (kind === 'wages') {
      body.daily_wage = Number(form.daily_wage);
    } else {
      Object.assign(body, {
        standard_duty_hours: Number(form.standard_duty_hours),
        ot_enabled: form.ot_enabled,
        ot_method: form.ot_method,
        ot_rate: form.ot_method === 'Fixed Hourly' ? numeric('ot_rate') : null,
        ot_multiplier: form.ot_method === 'Fixed Hourly' ? null : numeric('ot_multiplier'),
        holiday_pay_enabled: !local && form.holiday_pay_enabled,
        holiday_multiplier: !local && form.holiday_pay_enabled ? numeric('holiday_multiplier') : null,
        management_stoppage_treatment: form.management_stoppage_treatment.trim(),
        short_hours_treatment: form.short_hours_treatment.trim() || null,
        comp_off_rule: form.comp_off_rule.trim() || null,
        double_duty_multiplier: local ? numeric('double_duty_multiplier') : null
      });
    }
    onSave(body);
  };

  return (
    <form onSubmit={submit} className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60 space-y-6">
      <div>
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
          Configuration Entry
        </span>
        <h2 className="text-lg font-bold text-slate-100 mt-0.5">New Revision</h2>
        <p className="text-xs text-slate-400">Starting references are editable. Select the effective date before saving.</p>
      </div>

      {kind === 'wages' ? (
        <fieldset disabled={pending} className="space-y-4">
          <div className="border-b border-white/5 pb-2">
            <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">Section 1</span>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-0.5">Effective Period & Base Wage</h3>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <Input label="Effective From" type="date" required {...field('effective_from')} />
            <Input label="Daily Wage (₹)" type="number" min="0" step="0.01" required {...field('daily_wage')} />
          </div>
        </fieldset>
      ) : (
        <div className="space-y-6">
          {/* Fieldset 1: Effective Period & Base Hours */}
          <fieldset disabled={pending} className="space-y-4">
            <div className="border-b border-white/5 pb-2">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">Section 1</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-0.5">Effective Period & Base Hours</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Input label="Effective From" type="date" required {...field('effective_from')} />
              <Input label="Standard Duty Hours" type="number" min="0.0001" step="0.0001" required {...field('standard_duty_hours')} />
            </div>
          </fieldset>

          {/* Fieldset 2: Overtime & Multipliers */}
          <fieldset disabled={pending} className="space-y-4">
            <div className="border-b border-white/5 pb-2">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">Section 2</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-0.5">Overtime & Multipliers</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Select
                label="OT Enabled"
                value={String(form.ot_enabled)}
                onChange={event => setForm(prev => ({ ...prev, ot_enabled: event.target.value === 'true' }))}
                options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
              />
              <Select
                label="OT Method"
                value={form.ot_method}
                onChange={event => setForm(prev => ({
                  ...prev,
                  ot_method: event.target.value,
                  ot_rate: event.target.value === 'Fixed Hourly' ? '50' : '',
                  ot_multiplier: event.target.value === 'Fixed Hourly' ? '' : '1'
                }))}
                options={['Fixed Hourly', wage ? 'Derived from daily wage' : 'Salary-derived hourly'].map(value => ({ value, label: value }))}
              />
              {form.ot_method === 'Fixed Hourly' ? (
                <Input label="OT Hourly Rate (₹)" type="number" min="0" step="0.01" required {...field('ot_rate')} />
              ) : (
                <Input label="OT Multiplier" type="number" min="0.0001" step="0.0001" required {...field('ot_multiplier')} />
              )}
              {!local && (
                <>
                  <Select
                    label="Holiday Pay Enabled"
                    value={String(form.holiday_pay_enabled)}
                    onChange={event => setForm(prev => ({ ...prev, holiday_pay_enabled: event.target.value === 'true' }))}
                    options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                  />
                  {form.holiday_pay_enabled && (
                    <Input label="Holiday Multiplier" type="number" min="0.0001" step="0.0001" required {...field('holiday_multiplier')} />
                  )}
                </>
              )}
              {local && (
                <div className="md:col-span-2 space-y-2">
                  <p className="text-xs text-slate-400">Holiday-work pay is not applicable to local workers.</p>
                  <Input label="Double Duty Multiplier" type="number" min="0.0001" step="0.0001" required {...field('double_duty_multiplier')} />
                </div>
              )}
            </div>
          </fieldset>

          {/* Fieldset 3: Stoppage Policies */}
          <fieldset disabled={pending} className="space-y-4">
            <div className="border-b border-white/5 pb-2">
              <span className="text-[10px] uppercase font-bold tracking-widest text-slate-400 font-mono">Section 3</span>
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200 mt-0.5">Stoppage Policies</h3>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <Input label="Management Stoppage Treatment" required maxLength={500} {...field('management_stoppage_treatment')} />
              <Input label="Short Hours Treatment" maxLength={500} {...field('short_hours_treatment')} />
              <Input label="Comp Off Rule" maxLength={500} {...field('comp_off_rule')} />
            </div>
          </fieldset>
        </div>
      )}

      <div className="pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save Revision'}
        </Button>
      </div>
    </form>
  );
}
