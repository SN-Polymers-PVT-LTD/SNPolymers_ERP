import FactoryWorkCalendar from '../../components/payroll/FactoryWorkCalendar';
import React, { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../components/AuthContext';
import { Button, Input, Select, Badge, Table, TableHeader, TableBody, TableRow, TableCell, Pagination, Modal } from '../../components/ui';
import { getFactoryRevisions, createFactoryRevision, getEffectiveFactoryMasters, getFactorySetupImpact, completeFactorySetup } from '../../api/hrFactoryMastersApi';
import { FACTORY_CATEGORIES, WAGE_CATEGORIES, getDepartmentsForCategory } from '../admin/employeeConstants';

const factoryCategories = FACTORY_CATEGORIES;
const wageCategories = WAGE_CATEGORIES;
const workerType = category => category==='Local Daily-Wage Workers'?'Local':wageCategories.includes(category)?'Casual':'Permanent';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

function defaults(category) {
  const local = category === 'Local Daily-Wage Workers';
  const casual = ['SNP Casual Factory Labour', 'Fabric Factory Casual Factory Labour'].includes(category);
  return {
    effective_from: '',
    salary_days: '26',
    holiday_salary_days: '26',
    calculation_reason: '',
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
  if (status === 'Current') return 'emerald';
  if (status === 'Future') return 'blue';
  return 'slate';
}

export default function FactoryMasters() {
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const kind = user?.role==='accounts' ? 'calendar' : ['rules','calendar'].includes(params.get('tab')) ? params.get('tab') : 'wages';
  const allCategories = kind === 'wages' ? wageCategories : factoryCategories;
  const rawCategory = params.get('category');
  const inferred = getDepartmentsForCategory(rawCategory);
  const department = ['SNP Factory','Fabric Factory'].includes(params.get('department')) ? params.get('department') : inferred.length===1?inferred[0]:rawCategory?'':'Fabric Factory';
  const categories = allCategories.filter(c=>!department||getDepartmentsForCategory(c).includes(department));
  const category = categories.includes(rawCategory) ? rawCategory : categories[0];
  const rawPage = Number(params.get('page'));
  const page = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(params.get('date') || '') ? params.get('date') : today();
  const canWrite = ['admin', 'factory_manager'].includes(user?.role);
  const client = useQueryClient();
  const [formKey, setFormKey] = useState(0);
  const [success, setSuccess] = useState('');
  const [completion, setCompletion] = useState(null);
  const [creating, setCreating] = useState(false);
  const scopeKey = `${kind}:${department}:${category}:${asOf}`;
  const isCreating = creating === scopeKey;

  const change = (values) => {
    setSuccess('');
    setCreating(false);
    setCompletion(null);
    setParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(values)) next.set(key, String(value));
      if (!Object.hasOwn(values, 'page')) next.delete('page');
      return next;
    });
  };

  const query = useQuery({
    queryKey: ['hr-factory-revisions', kind, department, category, asOf, page],
    enabled: !!department && kind !== 'calendar',
    queryFn: async () => (await getFactoryRevisions(kind, { department, employee_category: category, as_of: asOf, page, limit: 20 })).data
  });

  const effective = useQuery({
    queryKey: ['hr-factory-effective', department, category, asOf],
    enabled: !!department && kind !== 'calendar',
    queryFn: async () => (await getEffectiveFactoryMasters({ department, employee_category: category, date: asOf })).data
  });

  const save = useMutation({
    mutationFn: body => createFactoryRevision(kind, {...body,department}),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['hr-factory-revisions'] });
      client.invalidateQueries({ queryKey: ['hr-factory-effective'] });
      setFormKey(value => value + 1);
      setCreating(false);
      setSuccess('Revision saved.');
    }
  });

  const title = kind === 'calendar' ? 'Factory Work Calendar' : kind === 'wages' ? 'Factory Labour Wage Master' : 'Factory Attendance & Pay Rule Master';

  return (
    <div className="space-y-6 pb-12">
      {completion && completion.selected_department===department && completion.employee_category===category && <FactoryRuleSetup key={`${department}:${category}:${completion.id}`} rule={completion} onClose={() => setCompletion(null)} onSaved={() => {
        setCompletion(null); setSuccess('Pay rule setup saved. Unsubmitted drafts use it on the next source check.');
        client.invalidateQueries({queryKey:['hr-factory-revisions']}); client.invalidateQueries({queryKey:['hr-factory-effective']});
      }} />}
      {/* Page Title & Breadcrumb */}
      <div className="border-b border-white/5 pb-4 flex flex-wrap items-center justify-between gap-4">
        <div>
        <span className="text-[10px] uppercase font-bold tracking-widest text-amber-500 font-mono block">
          Factory Operations · Policy Master
        </span>
        <h1 className="text-3xl font-extrabold tracking-tight text-slate-100 mt-1">
          {title}
        </h1>
        <p className="text-xs text-slate-400 font-medium mt-1">
          {kind==='calendar' ? 'Sunday off by default. Add holidays and working-day exceptions when needed.' : 'Manage daily wage benchmarks, standard working hours, and duty pay rules for factory labour.'}
        </p>
      </div>

      {canWrite && kind !== 'calendar' && !isCreating && <Button variant="yellow" disabled={!department} onClick={() => setCreating(scopeKey)}>New revision</Button>}
        </div>

      {/* Pill Tabs */}
      {user?.role!=='accounts'&&<>
      <div className="flex flex-wrap items-center gap-2 p-1.5 rounded-2xl bg-white/5 border border-white/10 w-fit max-w-full">
        <Button
          disabled={save.isPending}
          variant={kind === 'wages' ? 'yellow' : 'secondary'}
          size="sm"
          onClick={() => { save.reset(); change({ tab: 'wages', category: wageCategories.includes(category)?category:wageCategories.find(c=>getDepartmentsForCategory(c).includes(department))||category, department }); }}
        >
          Daily Wage Master
        </Button>
        <Button
          disabled={save.isPending}
          variant={kind === 'rules' ? 'yellow' : 'secondary'}
          size="sm"
          onClick={() => { save.reset(); change({ tab: 'rules', category: factoryCategories.includes(category)?category:factoryCategories.find(c=>getDepartmentsForCategory(c).includes(department))||category, department }); }}
        >
          Attendance & Pay Rules
        </Button>
        <Button size="sm" variant={kind==='calendar'?'yellow':'secondary'} onClick={()=>change({tab:'calendar',department:department||'Fabric Factory'})}>Work Calendar</Button>
      </div>

      </>}
      {kind === 'calendar' ? <FactoryWorkCalendar key={department} department={department||'Fabric Factory'} onDepartmentChange={value=>change({department:value})}/> : <>
      {/* Filter Toolbar Card */}
      <div className="glass-panel p-5 rounded-2xl border border-white/10 bg-slate-900/60">
        <div className="grid md:grid-cols-3 gap-4">
          <Select label="Factory" value={department} disabled={save.isPending} options={[{value:'',label:'Select factory'},... ['SNP Factory','Fabric Factory'].map(value=>({value,label:value}))]} onChange={event=>{const dept=event.target.value;const options=allCategories.filter(c=>getDepartmentsForCategory(c).includes(dept));save.reset();change({department:dept,category:options.find(c=>workerType(c)===workerType(category))||options[0]||category});}} />
          <Select
            disabled={save.isPending || !department}
            label="Worker type"
            value={category}
            options={categories.map(value => ({ value, label: workerType(value) }))}
            onChange={event => { save.reset(); change({ category: event.target.value,department }); }}
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

      {kind==='wages' && <p className="text-sm text-slate-400">Permanent salaries are maintained per employee. {user?.role==='admin'?<Link className="text-amber-500 underline" to="/admin/employee-management?tab=pay-structure">Open Employee Pay Structures</Link>:'Ask Admin to update Employee Pay Structures.'}</p>}
      {/* Applicable Policy Snapshot Card */}
      {!department ? <p role="status">Choose a factory to view Local wages and pay rules.</p> : effective.isPending ? (
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
                Current rules
              </span>
              <h3 className="text-sm font-bold text-slate-100 mt-0.5">
                Rules in effect on: <span className="font-mono text-amber-400">{asOf}</span>
              </h3>
            </div>
            <Badge variant="blue" showDot={false}>{department} · {workerType(category)}</Badge>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="p-3.5 rounded-xl bg-white/5 border border-white/5">
              <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">Applicable Wage</span>
              <span className="text-sm font-bold font-mono text-slate-100">
                {effective.data?.wage_revision
                  ? `₹${effective.data.wage_revision.daily_wage} from ${effective.data.wage_revision.effective_from}`
                  : wageCategories.includes(category)
                    ? 'Not configured'
                    : 'Monthly salary from Employee Management'}
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
                    ? `${effective.data.rule_revision.ot_method}: ${effective.data.rule_revision.ot_rate !== null ? `₹${effective.data.rule_revision.ot_rate} per hour` : `${effective.data.rule_revision.ot_multiplier}×`}`
                    : 'Disabled'}
                </span>
              </div>
            )}

            {effective.data?.rule_revision?.double_duty_multiplier != null && (
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
                  {effective.data.rule_revision.treatment ? 'Retain normal pay' : effective.data.rule_revision.management_stoppage_treatment || 'Not configured'}
                </span>
              </div>
            )}
          </div>

          {kind === 'wages' && effective.data?.rule_revision && (
            <p className="text-xs text-slate-400 pt-1 border-t border-white/5">
              OT method: {effective.data.rule_revision.ot_method}; {effective.data.rule_revision.ot_rate !== null ? `₹${effective.data.rule_revision.ot_rate} per hour` : `${effective.data.rule_revision.ot_multiplier}×`}; Double duty: {effective.data.rule_revision.double_duty_multiplier ?? 'Not applicable'}. Maintained in Pay Rule Master.
            </p>
          )}
        </div>
      )}

      {/* Revision Form */}
      {canWrite && department && isCreating && (
        <RevisionForm
          key={`${scopeKey}:${formKey}`}
          kind={kind}
          category={category}
          onCancel={() => { if (!save.isPending) { setCreating(false); save.reset(); } }}
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

        {!department ? null : query.isPending ? (
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
              <>
                <div className="grid gap-3 md:hidden" role="list" aria-label="Revision cards">
                  {query.data.revisions.map(row => <article key={row.id} role="listitem" className="glass-panel rounded-2xl border border-white/10 p-4 space-y-4">
                    <div className="flex flex-wrap justify-between gap-2">
                      <h3 className="font-semibold">Revision {row.revision_number}</h3>
                      <Badge variant={revisionStatusVariant(row.display_status)}>{row.display_status}</Badge>
                    </div>
                    <p className="text-sm text-slate-400">From {row.effective_from}</p>
                    {kind === 'wages' ? <p className="font-semibold">₹{row.daily_wage} per day</p> : <>
                      <p className="text-sm">{row.standard_duty_hours} hours per duty</p>
                      <RuleSummary rule={row} />
                      <RuleReadiness rule={row} canWrite={canWrite} onComplete={row=>setCompletion({...row,selected_department:department})} mobile />
                    </>}
                  </article>)}
                </div>
                <div className="hidden md:block glass-panel rounded-2xl border border-white/10 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="min-w-[950px]">
                    <TableHeader>
                      <TableRow>
                        {[
                          'Effective From',
                          kind === 'wages' ? 'Daily Wage (₹)' : 'Standard Hours',
                          'Status',
                          ...(kind === 'rules' ? ['Overtime', 'Holiday & Shifts', 'Attendance Pay', 'Payroll Setup'] : []),
                          'Revision'
                        ].map(label => (
                          <TableCell key={label} isHeader>{label}</TableCell>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {query.data.revisions.map(row => (
                        <TableRow key={row.id}>
                          <TableCell className="font-mono font-semibold text-slate-800 dark:text-slate-200">{row.effective_from}</TableCell>
                          <TableCell className="font-mono font-semibold text-amber-500 dark:text-amber-400">
                            {kind === 'wages' ? `₹${row.daily_wage}` : `${row.standard_duty_hours} hrs`}
                          </TableCell>
                          <TableCell>
                            <div className="space-y-1">
                              <Badge variant={revisionStatusVariant(row.display_status)}>
                                {row.display_status}
                              </Badge>
                              {row.department === null && row.employee_category === 'Local Daily-Wage Workers' && (
                                <span className="block text-[10px] font-mono text-slate-500 dark:text-slate-400 font-medium">Shared legacy</span>
                              )}
                            </div>
                          </TableCell>
                          {kind === 'rules' && (
                            <>
                              <TableCell><RuleOvertimeColumn rule={row} /></TableCell>
                              <TableCell><RuleShiftsColumn rule={row} /></TableCell>
                              <TableCell><RuleTreatmentColumn rule={row} /></TableCell>
                              <TableCell><RuleReadiness rule={row} canWrite={canWrite} onComplete={row=>setCompletion({...row,selected_department:department})} /></TableCell>
                            </>
                          )}
                          <TableCell className="font-mono text-xs text-slate-400">v{row.revision_number}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
              </>
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
      </>}
    </div>
  );
}

function RuleOvertimeColumn({ rule }) {
  if (!rule.ot_enabled) {
    return <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-white/5 text-slate-400 border border-slate-200 dark:border-white/5">Disabled</span>;
  }
  return (
    <div className="space-y-1 text-xs">
      <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-mono">
        {rule.ot_method}
      </span>
      <p className="font-mono font-bold text-slate-900 dark:text-slate-100 text-xs">
        {rule.ot_rate != null ? `₹${rule.ot_rate} per hour` : `${rule.ot_multiplier}× multiplier`}
      </p>
    </div>
  );
}

function RuleShiftsColumn({ rule }) {
  const hasHoliday = rule.holiday_pay_enabled;
  const hasDouble = rule.double_duty_multiplier != null;
  const hasCompOff = Boolean(rule.comp_off_rule);

  if (!hasHoliday && !hasDouble && !hasCompOff) {
    return <span className="text-slate-400 text-xs">—</span>;
  }

  return (
    <div className="space-y-1 text-xs text-slate-700 dark:text-slate-300">
      {hasHoliday && (
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 font-mono shrink-0">
            Holiday
          </span>
          <span className="font-medium">
            <strong className="font-mono text-slate-900 dark:text-slate-100">{rule.holiday_multiplier}×</strong> total pay
          </span>
        </div>
      )}
      {hasDouble && (
        <div className="flex items-center gap-1.5">
          <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-purple-500/10 text-purple-700 dark:text-purple-400 border border-purple-500/20 font-mono shrink-0">
            Double Duty
          </span>
          <span className="font-medium">
            <strong className="font-mono text-slate-900 dark:text-slate-100">{rule.double_duty_multiplier}×</strong>, no OT
          </span>
        </div>
      )}
      {hasCompOff && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-slate-600 dark:text-slate-300">Comp Off:</span> {rule.comp_off_rule}
        </div>
      )}
    </div>
  );
}

function RuleTreatmentColumn({ rule }) {
  if (!rule.treatment) {
    return (
      <div className="space-y-1">
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 font-mono">
          ⚠ Needs confirmation
        </span>
        <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">Attendance pay needs confirmation</p>
      </div>
    );
  }

  return (
    <div className="space-y-1 text-xs">
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 font-mono">
        ✓ Active
      </span>
      <p className="text-[11px] text-slate-600 dark:text-slate-300">Deduct missing hours only.</p>
      <p className="text-[11px] text-slate-500 dark:text-slate-400">Retain normal stoppage pay.</p>
    </div>
  );
}

function RuleSummary({ rule }) {
  return (
    <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.02] border border-slate-200 dark:border-white/5 space-y-2 text-xs">
      <div>
        <span className="text-[9px] font-mono font-bold uppercase text-slate-400 block tracking-wider">Overtime</span>
        <p className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
          {rule.ot_enabled
            ? `${rule.ot_method} · ${rule.ot_rate != null ? `₹${rule.ot_rate} per hour` : `${rule.ot_multiplier}×`}`
            : 'Overtime disabled'}
        </p>
      </div>
      {(rule.holiday_pay_enabled || rule.double_duty_multiplier != null || rule.comp_off_rule) && (
        <div>
          <span className="text-[9px] font-mono font-bold uppercase text-slate-400 block tracking-wider">Special Shifts</span>
          {rule.holiday_pay_enabled && <p className="text-slate-700 dark:text-slate-300">Holiday duty: {rule.holiday_multiplier}× total pay</p>}
          {rule.double_duty_multiplier != null && <p className="text-slate-700 dark:text-slate-300">Double duty: {rule.double_duty_multiplier}×, without overtime</p>}
          {rule.comp_off_rule && <p className="text-slate-500 dark:text-slate-400">Comp Off: {rule.comp_off_rule}</p>}
        </div>
      )}
      <div>
        <span className="text-[9px] font-mono font-bold uppercase text-slate-400 block tracking-wider">Attendance Treatment</span>
        {rule.treatment ? (
          <p className="text-emerald-600 dark:text-emerald-400">Deduct missing hours only. Retain normal stoppage pay.</p>
        ) : (
          <p className="text-amber-600 dark:text-amber-400">Attendance pay needs confirmation</p>
        )}
      </div>
    </div>
  );
}

function RuleReadiness({ rule, canWrite, onComplete, mobile = false }) {
  const incomplete = !rule.treatment || (rule.ot_enabled && !rule.calculation);
  return (
    <div className="text-sm space-y-1.5">
      {incomplete ? (
        canWrite ? (
          <Button
            size="sm"
            variant="yellow"
            aria-label={mobile ? `Finish setup for revision ${rule.revision_number}` : undefined}
            onClick={() => onComplete(rule)}
          >
            Finish setup
          </Button>
        ) : (
          <Badge variant="amber">Needs setup</Badge>
        )
      ) : (
        <Badge variant="emerald">Ready</Badge>
      )}
      {rule.calculation?.salary_days && (
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          OT basis: <strong className="text-slate-700 dark:text-slate-300">{rule.calculation.salary_days} days</strong>
        </p>
      )}
      {rule.treatment?.holiday_salary_days && (
        <p className="text-xs text-slate-500 dark:text-slate-400 font-mono">
          Holiday basis: <strong className="text-slate-700 dark:text-slate-300">{rule.treatment.holiday_salary_days} days</strong>
        </p>
      )}
    </div>
  );
}

function RevisionForm({ kind, category, onSave, onCancel, pending }) {
  const [form, setForm] = useState(() => defaults(category));
  const local = category === 'Local Daily-Wage Workers';
  const wage = wageCategories.includes(category);
  const field = name => ({ value: form[name], onChange: event => setForm(prev => ({ ...prev, [name]: event.target.value })) });
  const numeric = name => form[name] === '' ? null : Number(form[name]);

  const submit = event => {
    event.preventDefault();
    const body = { employee_category: category, effective_from: form.effective_from, setup_reason:form.calculation_reason.trim() };
    if (kind === 'wages') {
      body.daily_wage = Number(form.daily_wage);
    } else {
      Object.assign(body, {
        standard_duty_hours: Number(form.standard_duty_hours),
        treatment:{holiday_salary_days:!wage && form.holiday_pay_enabled?Number(form.holiday_salary_days):null,reason:form.calculation_reason.trim()},
        ot_enabled: form.ot_enabled,
        ...(form.ot_enabled ? {calculation:{salary_days:form.ot_method==='Salary-derived hourly'?Number(form.salary_days):null,reason:form.calculation_reason.trim()}} : {}),
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
              {form.ot_enabled && <>
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
                <Input label="Overtime rate per hour (₹)" type="number" min="0" step="0.01" required {...field('ot_rate')} />
              ) : (
                <Input label="OT Multiplier" type="number" min="0.0001" step="0.0001" required {...field('ot_multiplier')} />
              )}
              {form.ot_enabled && <div className="md:col-span-2 rounded-xl border border-amber-500/20 p-4 space-y-3">
                {form.ot_method === 'Salary-derived hourly' && <Input label="Days used to calculate overtime" type="number" min="0.0001" max="366" step="0.0001" required {...field('salary_days')} />}
                <p className="text-sm text-slate-300">{form.ot_method === 'Salary-derived hourly' ? 'Uses agreed monthly gross ÷ OT salary days ÷ standard duty hours × multiplier. Unpaid-leave calculation stays separate.' : form.ot_method === 'Derived from daily wage' ? 'Uses the applicable daily wage ÷ standard duty hours × multiplier.' : 'Uses the configured hourly rate.'}</p>
                <p className="text-xs text-slate-400">Overtime rounding: nearest paise, half up, at each daily and hourly rate and final amount. Saving confirms these settings.</p>

              </div>}
              </>}
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
                  <p className="text-sm text-slate-300">Double duty pays 2× the daily wage, without additional overtime.</p>
                </div>
              )}
            </div>
          </fieldset>

          <fieldset disabled={pending} className="rounded-xl border border-white/10 p-4 space-y-3">
            <h3 className="font-semibold">Attendance pay treatment</h3>
            <p className="text-sm text-slate-300">Short days: deduct only missing hours. Approved management stoppages retain normal pay. Paid medical and other leave follow HO’s recorded decision on paid or unpaid leave.</p>
            {!wage && form.holiday_pay_enabled && <>
              <Input label="Days used to calculate holiday pay" type="number" min="0.0001" max="366" step="0.0001" required {...field('holiday_salary_days')} />
              <p className="text-sm text-slate-300">Holiday pay is the total daily entitlement: a 1.5× rule adds 0.5× daily pay above the normal pay already included in monthly salary. A published paid-holiday calendar entry is required.</p>
            </>}

          </fieldset>
        </div>
      )}

      <Input disabled={pending} label="Reason for this revision" required maxLength={500} {...field('calculation_reason')} />
      <div className="pt-2 flex flex-wrap gap-3">
        <Button type="submit" variant="yellow" disabled={pending}>
          {pending ? 'Saving…' : 'Save Revision'}
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function FactoryRuleSetup({ rule, onClose, onSaved }) {
  const [days, setDays] = useState('26');
  const [holidayDays, setHolidayDays] = useState('26');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const impact = useQuery({
    queryKey: ['factory-setup-impact', rule.id],
    queryFn: async () => (await getFactorySetupImpact(rule.id)).data.impact
  });
  const needsOT = rule.ot_enabled && !impact.data?.calculation_configured;
  const needsTreatment = !impact.data?.treatment_configured;
  const salary = needsOT && rule.ot_method === 'Salary-derived hourly';
  const holiday = needsTreatment && !wageCategories.includes(rule.employee_category) && rule.holiday_pay_enabled;
  const save = useMutation({
    mutationFn: () => completeFactorySetup(rule.id, {
      salary_days: salary ? Number(days) : null,
      holiday_salary_days: holiday ? Number(holidayDays) : null,
      reason: reason.trim()
    }),
    onSuccess: onSaved
  });
  const complete = !needsOT && !needsTreatment;
  const blocked = impact.data?.locked_rows > 0 || complete || impact.isError || impact.isFetching;
  const formatDate = value => value ? new Intl.DateTimeFormat('en-IN', {day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(`${value}T00:00:00Z`)) : 'Not specified';
  const factoryName = rule.selected_department || rule.department || getDepartmentsForCategory(rule.employee_category)[0];

  const saveButton = (
    <div className="space-y-3 w-full sm:w-auto sm:min-w-[280px]">
      <label className="flex items-start gap-2.5 text-xs text-slate-800 dark:text-slate-200 font-semibold cursor-pointer select-none">
        <input
          form="factory-setup-form"
          type="checkbox"
          checked={confirmed}
          onChange={event => setConfirmed(event.target.checked)}
          disabled={!impact.data || blocked || save.isPending}
          required
          className="mt-0.5 h-4 w-4 rounded border-slate-300 dark:border-slate-700 text-amber-500 focus:ring-amber-500 focus:ring-offset-0 bg-white dark:bg-slate-900 cursor-pointer accent-yellow-500"
        />
        <span>I confirm these pay settings.</span>
      </label>
      <Button
        type="submit"
        form="factory-setup-form"
        variant="yellow"
        fullWidth
        loading={save.isPending}
        disabled={!confirmed || !reason.trim() || !impact.data || blocked || save.isPending}
      >
        Save setup
      </Button>
    </div>
  );

  return (
    <Modal
      size="lg"
      footer={saveButton}
      role="dialog"
      aria-modal="true"
      titleId="factory-setup-title"
      aria-labelledby="factory-setup-title"
      closeLabel="Close pay rule setup"
      title="Complete pay setup"
      subtitle={`${factoryName} · ${workerType(rule.employee_category)} employees`}
      onClose={save.isPending ? undefined : onClose}
      closeDisabled={save.isPending}
    >
      <form id="factory-setup-form" className="space-y-4" onSubmit={event => { event.preventDefault(); if (confirmed && !blocked && impact.data && !save.isPending) save.mutate(); }}>
        {rule.department===null && rule.employee_category==='Local Daily-Wage Workers' && (
          <p role="note" className="text-xs rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-amber-800 dark:text-amber-400 font-medium">
            This earlier rule is shared by both factories. Completing it applies to recorded attendance in both SNP and Fabric.
          </p>
        )}

        {impact.isPending ? (
          <div role="status" className="flex items-center gap-2 p-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Checking pay setup…</span>
          </div>
        ) : impact.isError ? (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 flex items-center justify-between">
            <span>Unable to check affected payroll.</span>
            <Button type="button" size="xs" variant="secondary" onClick={() => impact.refetch()}>Retry</Button>
          </div>
        ) : (
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/10 text-xs font-mono text-slate-600 dark:text-slate-300">
            <span className="text-amber-500 font-bold">📅</span>
            <span>
              Applies from <strong className="text-slate-900 dark:text-slate-100 font-semibold">{formatDate(impact.data?.effective_from || rule.effective_from)}</strong>
              {impact.data?.effective_to ? (
                <> to <strong className="text-slate-900 dark:text-slate-100 font-semibold">{formatDate(impact.data.effective_to)}</strong></>
              ) : (
                <span className="text-slate-400"> · No end date</span>
              )}
            </span>
          </div>
        )}

        {impact.data && !impact.isError && (
          <>
            {complete && (
              <p role="alert" className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-3 text-xs text-blue-700 dark:text-blue-300 font-medium">
                This rule is already configured. Create a new revision to change it.
              </p>
            )}
            {impact.data.locked_rows > 0 && (
              <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 font-medium">
                This period includes locked payroll. Create a future rule or use the correction workflow.
              </p>
            )}

            <fieldset disabled={save.isPending || blocked} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {needsOT && (
                  <section className={`rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 space-y-2.5 ${!holiday ? 'sm:col-span-2' : ''}`}>
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-white/5">
                      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Overtime Policy</h3>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20">
                        {rule.ot_method}
                      </span>
                    </div>
                    {salary ? (
                      <>
                        <Input
                          id="factory-setup-ot-days"
                          label="Overtime calculation days"
                          type="number"
                          min="0.0001"
                          max="366"
                          step="0.0001"
                          required
                          value={days}
                          onChange={event => setDays(event.target.value)}
                        />
                        <p className="text-xs text-slate-500 dark:text-slate-400">Converts monthly salary into an hourly rate.</p>
                      </>
                    ) : null}
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
                      {rule.ot_method === 'Fixed Hourly' ? `Existing rate: ₹${rule.ot_rate} per hour` : `Existing OT multiplier: ${rule.ot_multiplier}×`}
                    </p>
                    {!salary && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {rule.ot_method === 'Derived from daily wage' ? 'Calculated from the daily wage and duty hours.' : 'Uses the saved hourly rate.'}
                      </p>
                    )}
                  </section>
                )}

                {holiday && (
                  <section className={`rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 space-y-2.5 ${!needsOT ? 'sm:col-span-2' : ''}`}>
                    <div className="flex items-center justify-between pb-1 border-b border-slate-200/60 dark:border-white/5">
                      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Holiday Pay</h3>
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20">
                        {rule.holiday_multiplier}× Total
                      </span>
                    </div>
                    <Input
                      id="factory-setup-holiday-days"
                      label="Holiday calculation days"
                      type="number"
                      min="0.0001"
                      max="366"
                      step="0.0001"
                      required
                      value={holidayDays}
                      onChange={event => setHolidayDays(event.target.value)}
                    />
                    <p className="text-xs text-slate-500 dark:text-slate-400">Converts monthly salary into daily pay.</p>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-200">Existing holiday entitlement: {rule.holiday_multiplier}× total pay</p>
                  </section>
                )}
              </div>

              {needsTreatment && (
                <div className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-3.5 space-y-2 text-xs">
                  <span className="text-[10px] font-mono font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                    Attendance Pay Treatment
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md font-bold uppercase text-[9px] tracking-wider bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 shrink-0 font-mono">
                      Short days
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">deduct missing hours only.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md font-bold uppercase text-[9px] tracking-wider bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 shrink-0 font-mono">
                      Stoppages
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">Approved stoppages: retain normal pay.</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md font-bold uppercase text-[9px] tracking-wider bg-blue-500/10 text-blue-700 dark:text-blue-400 border border-blue-500/20 shrink-0 font-mono">
                      Leave
                    </span>
                    <span className="text-slate-700 dark:text-slate-300">
                      {rule.employee_category === 'Local Daily-Wage Workers' ? 'unpaid for Local workers.' : 'follow HO’s Paid or Unpaid decision.'}
                    </span>
                  </div>
                </div>
              )}

              <Input
                label="Setup note"
                placeholder="Why are you confirming these settings?"
                maxLength={500}
                required
                value={reason}
                onChange={event => setReason(event.target.value)}
              />
            </fieldset>

            <details className="rounded-2xl border border-slate-200 dark:border-white/10 bg-slate-50/70 dark:bg-white/[0.02] p-4 text-xs transition-colors duration-200 group">
              <summary className="cursor-pointer font-bold text-slate-800 dark:text-slate-200 flex items-center justify-between select-none list-none [&::-webkit-details-marker]:hidden">
                <span className="flex items-center gap-2">
                  <svg className="w-4 h-4 text-amber-500 transition-transform duration-200 group-open:rotate-90 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
                  </svg>
                  <span>Calculation details</span>
                </span>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200/70 dark:bg-white/10 text-slate-600 dark:text-slate-300 font-semibold">
                  Revision {rule.revision_number} Impact
                </span>
              </summary>
              <div className="mt-3.5 space-y-3 pt-3 border-t border-slate-200/80 dark:border-white/5 text-slate-600 dark:text-slate-300">
                {/* Visual Metric Chips */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-amber-700 dark:text-amber-400 block font-mono">Draft</span>
                    <span className="text-base font-extrabold font-mono text-amber-800 dark:text-amber-300">{impact.data.draft_rows}</span>
                    <span className="text-[9px] text-amber-600/80 dark:text-amber-400/80 block mt-0.5">Recalculates</span>
                  </div>
                  <div className="p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/25">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-blue-700 dark:text-blue-400 block font-mono">Protected</span>
                    <span className="text-base font-extrabold font-mono text-blue-800 dark:text-blue-300">{impact.data.protected_rows}</span>
                    <span className="text-[9px] text-blue-600/80 dark:text-blue-400/80 block mt-0.5">Submitted / returned</span>
                  </div>
                  <div className={`p-2.5 rounded-xl border ${impact.data.locked_rows > 0 ? 'bg-red-500/10 border-red-500/30' : 'bg-emerald-500/10 border-emerald-500/25'}`}>
                    <span className={`text-[10px] uppercase font-bold tracking-wider block font-mono ${impact.data.locked_rows > 0 ? 'text-red-700 dark:text-red-400' : 'text-emerald-700 dark:text-emerald-400'}`}>Locked</span>
                    <span className={`text-base font-extrabold font-mono ${impact.data.locked_rows > 0 ? 'text-red-800 dark:text-red-300' : 'text-emerald-800 dark:text-emerald-300'}`}>{impact.data.locked_rows}</span>
                    <span className={`text-[9px] block mt-0.5 ${impact.data.locked_rows > 0 ? 'text-red-600/80 dark:text-red-400/80' : 'text-emerald-600/80 dark:text-emerald-400/80'}`}>{impact.data.locked_rows > 0 ? 'Locked' : 'Unchanged'}</span>
                  </div>
                </div>

                {/* Audit scope line */}
                <div className="p-2.5 rounded-xl bg-slate-100 dark:bg-white/5 border border-slate-200/80 dark:border-white/5 space-y-1 text-slate-700 dark:text-slate-300">
                  <p className="font-medium text-slate-800 dark:text-slate-200">
                    Revision {rule.revision_number}. Only missing settings will be added. Reviewed payroll stays unchanged.
                  </p>
                  <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400">
                    {impact.data.draft_rows} draft rows · {impact.data.protected_rows} submitted or returned rows · {impact.data.locked_rows} locked rows.
                  </p>
                </div>

                {salary && (
                  <div className="p-2.5 rounded-xl bg-amber-500/5 border border-amber-500/20 text-slate-700 dark:text-slate-300 space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-amber-700 dark:text-amber-400 block font-mono">Formula Breakdown</span>
                    <p className="font-mono text-[11px] text-amber-900 dark:text-amber-200 font-semibold">
                      Overtime = monthly gross ÷ overtime calculation days ÷ standard duty hours × OT multiplier × overtime hours.
                    </p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">Unpaid leave uses its separate salary policy.</p>
                  </div>
                )}

                {holiday && (
                  <div className="p-2.5 rounded-xl bg-blue-500/5 border border-blue-500/20 text-slate-700 dark:text-slate-300 space-y-1">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-blue-700 dark:text-blue-400 block font-mono">Holiday Entitlement</span>
                    <p className="text-[11px]">
                      Holiday duty pays <strong className="font-mono text-blue-900 dark:text-blue-200">{rule.holiday_multiplier}×</strong> in total. Normal daily pay is already included in monthly salary, so only the extra amount is added. A published paid-holiday calendar entry is required.
                    </p>
                  </div>
                )}

                {needsOT && (
                  <div className="p-2.5 rounded-xl bg-slate-100/80 dark:bg-white/5 border border-slate-200/80 dark:border-white/5 flex items-start gap-2 text-slate-600 dark:text-slate-300 text-[11px]">
                    <span className="text-amber-500 font-bold shrink-0 text-xs">ℹ</span>
                    <p>Overtime rounding: daily rates, hourly rates and final amounts round to two decimal places. Half a paise rounds up.</p>
                  </div>
                )}
              </div>
            </details>
          </>
        )}

        {save.isError && (
          <p role="alert" className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-600 dark:text-red-400 font-medium">
            {save.error.response?.data?.message || 'Unable to save pay rule setup.'}
          </p>
        )}
      </form>
    </Modal>
  );
}
