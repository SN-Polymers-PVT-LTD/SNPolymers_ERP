import React from 'react';
import { Input, Select, Button } from '../../components/ui';
const names = ['BASIC','STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'];
const opts = values => values.map(value => ({ value, label: value.replaceAll('_',' ') }));
export function Choice({ label, value, values, onChange }) { return <Select label={label} value={value} options={opts(values)} onChange={e => onChange(e.target.value)} />; }
export function RoundingFields({ label, value, onChange }) {
 return <fieldset className="border border-white/10 rounded-xl p-3 space-y-3"><legend>{label} rounding</legend>
  <Choice label={`${label} rounding method`} value={value.method} values={['UNRESOLVED','HALF_UP','HALF_EVEN','DOWN','UP']} onChange={method => onChange(method === 'UNRESOLVED' ? { method, precision: null, stage: 'UNRESOLVED' } : { ...value, method })} />
  {value.method !== 'UNRESOLVED' && <><Input label={`${label} precision`} type="number" min="0" max="6" value={value.precision ?? ''} onChange={e => onChange({ ...value, precision: e.target.value === '' ? null : Number(e.target.value) })} />
   <Choice label={`${label} rounding stage`} value={value.stage} values={['UNRESOLVED','DAILY','LINE','AGGREGATE','MONTH']} onChange={stage => onChange({ ...value, stage })} /></>}
 </fieldset>;
}
export function PolicyFields({ data, setData, groups }) {
 const set = (key,value) => setData({ ...data, [key]: value });
 return <><Select label="Payroll group" value={data.group_code || ''} options={[{ value: '', label: 'Global default (monthly-salaried groups)' },...groups.filter(g => g.is_permanent !== false).map(g => ({ value:g.code,label:g.code }))]} onChange={e => set('group_code',e.target.value || null)} />
 <p>Full eligible month: contractual monthly gross, for 28/29/30/31 days. No sandwich policy.</p>
 <Choice label="LOP method" value={data.lop_method} values={['FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS']} onChange={value => setData({ ...data, lop_method:value, lop_fixed_divisor: value === 'FIXED_DIVISOR' ? '' : null })} />
 {data.lop_method === 'FIXED_DIVISOR' && <Input label="LOP fixed divisor" required inputMode="decimal" value={data.lop_fixed_divisor ?? ''} onChange={e => set('lop_fixed_divisor',e.target.value)} />}
 {data.lop_method === 'ACTUAL_CALENDAR_DAYS' && <p className="text-amber-400">This changes the approved Fixed 30 LOP method. Future publication requires business approval.</p>}
 <Choice label="Joining/leaving proration" value={data.partial_month_proration_method} values={['UNRESOLVED','FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS','WORK_CALENDAR']} onChange={value => setData({ ...data, partial_month_proration_method:value, partial_month_fixed_divisor:value === 'FIXED_DIVISOR' ? '' : null })} />
 {data.partial_month_proration_method === 'FIXED_DIVISOR' && <Input label="Independent proration divisor" value={data.partial_month_fixed_divisor ?? ''} onChange={e => set('partial_month_fixed_divisor',e.target.value)} />}
 <Choice label="Split-run allocation" value={data.split_period_allocation_method} values={['UNRESOLVED','CALENDAR_WEIGHTED_WITH_RESIDUAL']} onChange={value => set('split_period_allocation_method',value)} />
 <p>Full-month unpaid treatment: UNRESOLVED. No automatic zero, cap, or change of divisor.</p>
 <Choice label="Weekly offs inside explicit leave" value={data.leave_weekly_off_method} values={['UNRESOLVED','WORK_CALENDAR']} onChange={value => set('leave_weekly_off_method',value)} />
 <Input label="Work calendar evidence reference" value={data.work_calendar_reference || ''} onChange={e => set('work_calendar_reference',e.target.value || null)} helperText="A reference alone does not provide an approved executable calendar. Affected cases remain blocked." />
 {['lop','proration','allocation'].map(key => <RoundingFields key={key} label={key} value={data.rounding[key]} onChange={value => set('rounding',{ ...data.rounding,[key]:value })} />)}
 <div className="col-span-full border border-amber-500/30 rounded-xl p-3"><p>Synthetic reference only: ₹30,000 gross, two unpaid days, aggregate HALF UP rounding to two places.</p>
 <table className="w-full text-left"><thead><tr><th>Month</th><th>Fixed 30 LOP</th><th>Optional actual-days LOP</th></tr></thead><tbody><tr><td>February 2026 (28)</td><td>₹2,000.00</td><td>₹2,142.86</td></tr><tr><td>October 2026 (31)</td><td>₹2,000.00</td><td>₹1,935.48</td></tr></tbody></table><p>These examples do not approve rounding or proration, and do not calculate this draft’s configured values.</p></div>
 </>;
}
export function StatutoryFields({ data, setData }) {
 const set = (key,value) => setData({ ...data,[key]:value });
 const c = data.configuration;
 const config = (key,value) => set('configuration',{ ...c,[key]:value });
 const isPT = data.scheme === 'PT';
 const changeScheme = scheme => setData({ ...data, scheme, slabs:[], configuration:{ ...c, employee_rate:null, employer_rate:null, eligibility:'UNRESOLVED',calculation_method:'UNRESOLVED',wage_ceiling:null,eligibility_ceiling:null,contribution_minimum:null,contribution_cap:null } });
 const slabChange = (index,key,value) => set('slabs',data.slabs.map((s,i) => i === index ? { ...s,[key]:value } : s));
 return <><Choice label="Scheme" value={data.scheme} values={['EPF','ESI','PT']} onChange={changeScheme} />
 <Input label="Jurisdiction / state" required value={data.jurisdiction} onChange={e => set('jurisdiction',e.target.value)} />
 <Input label="Establishment" required value={data.establishment} onChange={e => set('establishment',e.target.value)} />
 {!isPT && <>{['employee_rate','employer_rate','eligibility_ceiling','wage_ceiling','contribution_minimum','contribution_cap'].map(key => <Input key={key} label={key.replaceAll('_',' ') + (key.includes('rate') ? ' (%)' : ' (₹)')} inputMode="decimal" value={c[key] ?? ''} onChange={e => config(key,e.target.value || null)} />)}</>}
 <Choice label="Eligibility" value={c.eligibility} values={isPT ? ['UNRESOLVED','JURISDICTION_PROFILE'] : ['UNRESOLVED','ENROLLED','WAGE_CEILING','ENROLLED_AND_WAGE_CEILING']} onChange={value => config('eligibility',value)} />
 <Choice label="Calculation method" value={c.calculation_method} values={isPT ? ['UNRESOLVED','SLABS'] : ['UNRESOLVED','QUALIFYING_WAGE_PERCENTAGE','CAPPED_WAGE_PERCENTAGE']} onChange={value => config('calculation_method',value)} />
 <Choice label="Jurisdiction conditions" value={c.conditions} values={['UNRESOLVED','NONE','PROFILE_EXEMPTIONS']} onChange={value => config('conditions',value)} />
 <p>Calendar-month aggregation; effective rule: month start. Other contribution-period rules and profile exemptions require further supported design before publication.</p>
 <fieldset className="space-y-2"><legend>Contribution wage basis: explicitly include/exclude each component</legend>{names.map(name => <label key={name} className="block"><input type="checkbox" checked={c.included_components.includes(name)} onChange={e => { const included = e.target.checked ? [...c.included_components,name] : c.included_components.filter(x => x !== name); set('configuration',{ ...c,included_components:included,excluded_components:names.filter(x => !included.includes(x)) }); }} /> {name.replaceAll('_',' ')} {c.included_components.includes(name) ? '(included)' : '(excluded)'}</label>)}</fieldset>
 <RoundingFields label="Statutory" value={c.rounding} onChange={value => config('rounding',value)} />
 {isPT && <fieldset className="col-span-full space-y-3"><legend>PT slabs — monthly wage basis, [lower, upper), blank upper = infinity</legend>
 <p>Define a complete schedule from zero to infinity for every month. Use the copy action for an identical schedule; customize months where advisor rules differ.</p>
 {data.slabs.map((s,i) => <div key={i} className="grid sm:grid-cols-5 gap-2"><Input label={`Slab ${i+1} month`} type="number" min="1" max="12" value={s.month} onChange={e => slabChange(i,'month',Number(e.target.value))} />{['lower_bound','upper_bound','deduction_amount'].map(key => <Input key={key} label={`Slab ${i+1} ${key.replaceAll('_',' ')}`} inputMode="decimal" value={s[key] ?? ''} onChange={e => slabChange(i,key,key === 'upper_bound' ? e.target.value || null : e.target.value)} />)}<Button variant="danger" onClick={() => set('slabs',data.slabs.filter((_,index) => index !== i))}>Remove slab {i+1}</Button></div>)}
 <Button onClick={() => set('slabs',[...data.slabs,{ month:1,lower_bound:'',upper_bound:null,deduction_amount:'' }])}>Add slab</Button>
 <Button variant="secondary" disabled={!data.slabs.some(s => s.month === 1)} onClick={() => set('slabs',Array.from({length:12},(_,i) => data.slabs.filter(s => s.month === 1).map(s => ({ ...s,month:i+1 }))).flat())}>Copy January schedule to all months</Button>
 </fieldset>}
 <Choice label="Advisor verification" value={data.verification_status} values={['UNVERIFIED','ADVISOR_VERIFIED']} onChange={value => setData({ ...data,verification_status:value,advisor_name:null,verification_reference:null,verified_on:null })} />
 <p className="text-amber-400">Saving a draft does not verify legal applicability. Enter documented payroll/statutory advisor evidence before publication.</p>
 {data.verification_status === 'ADVISOR_VERIFIED' && <><Input label="Advisor name" required value={data.advisor_name || ''} onChange={e => set('advisor_name',e.target.value || null)} /><Input label="Verification evidence reference" required value={data.verification_reference || ''} onChange={e => set('verification_reference',e.target.value || null)} /><Input label="Verified on" required type="date" value={data.verified_on || ''} onChange={e => set('verified_on',e.target.value || null)} /></>}
 </>;
}
