import StatutoryStateField from '../../components/payroll/StatutoryStateField';
import PTSlabEditor from '../../components/payroll/PTSlabEditor';
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
 <Choice label="Full-month unpaid treatment" value={data.full_month_unpaid_treatment} values={['UNRESOLVED','NO_PAYABLE_ENTITLEMENT_ZERO']} onChange={value=>set('full_month_unpaid_treatment',value)} /><p>The zero exception requires evidence that every employment day has no payable entitlement. Paid rest days are preserved.</p><Choice label="Special Package period" value={data.special_package_period||'UNRESOLVED'} values={['UNRESOLVED','MONTHLY_CONFIRMED']} onChange={value=>set('special_package_period',value)} />
 <Choice label="Weekly offs inside explicit leave" value={data.leave_weekly_off_method} values={['UNRESOLVED','WORK_CALENDAR','EXCLUDE_PAID_CALENDAR_DAYS']} onChange={value => set('leave_weekly_off_method',value)} />
 <Input label="Work calendar evidence reference" value={data.work_calendar_reference || ''} onChange={e => set('work_calendar_reference',e.target.value || null)} helperText="Publish dated paid/unpaid calendar evidence through payroll review; a text reference alone is insufficient." />
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
 const changeScheme = scheme => setData({ ...data, scheme, slabs:[], configuration:{ ...c, employee_rate:null, employer_rate:null, eligibility:scheme==='PT'?'JURISDICTION_PROFILE':'UNRESOLVED',calculation_method:scheme==='PT'?'SLABS':'UNRESOLVED',wage_ceiling:null,eligibility_ceiling:null,contribution_minimum:null,contribution_cap:null } });
 return <><Choice label="Scheme" value={data.scheme} values={['EPF','ESI','PT']} onChange={changeScheme} />
 <p>These are historical display labels. Calculation requires an explicitly approved canonical scope mapping and an evidenced employee statutory profile.</p>
 <StatutoryStateField data={data} onChange={setData} />
 <Input label="Establishment" required value={data.establishment} onChange={e => set('establishment',e.target.value)} />
 {!isPT && <>{['employee_rate','employer_rate','eligibility_ceiling','wage_ceiling','contribution_minimum','contribution_cap'].map(key => <Input key={key} label={key.replaceAll('_',' ') + (key.includes('rate') ? ' (%)' : ' (₹)')} inputMode="decimal" value={c[key] ?? ''} onChange={e => config(key,e.target.value || null)} />)}</>}
 <Choice label="Eligibility" value={c.eligibility} values={isPT ? ['UNRESOLVED','JURISDICTION_PROFILE'] : ['UNRESOLVED','ENROLLED','WAGE_CEILING','ENROLLED_AND_WAGE_CEILING']} onChange={value => config('eligibility',value)} />
 <Choice label="Calculation method" value={c.calculation_method} values={isPT ? ['UNRESOLVED','SLABS'] : ['UNRESOLVED','QUALIFYING_WAGE_PERCENTAGE','CAPPED_WAGE_PERCENTAGE']} onChange={value => config('calculation_method',value)} />
 <Choice label="Jurisdiction conditions" value={c.conditions} values={isPT ? ['UNRESOLVED','NONE'] : ['UNRESOLVED','NONE','PROFILE_EXEMPTIONS']} onChange={value => config('conditions',value)} />
 <p>Calendar-month aggregation; effective rule: month start. Other contribution-period rules and profile exemptions require further supported design before publication.</p>
 <p>New pay structures record agreed gross only. For these records, PACKAGE BALANCE contains the full monthly contractual gross; BASIC, STAFF WELFARE and OTHER FIXED are unavailable. Select wage treatment explicitly. Including an unavailable component blocks calculation; it does not mean zero. Historical component values remain available for historical revisions.</p>
 <fieldset className="space-y-2"><legend>Contribution wage basis: explicitly include/exclude each component</legend>{names.filter(name => name !== 'ADJUSTMENTS' || !c.adjustment_basis).map(name => <label key={name} className="block"><input type="checkbox" checked={c.included_components.includes(name)} onChange={e => { const included = e.target.checked ? [...c.included_components,name] : c.included_components.filter(x => x !== name); set('configuration',{ ...c,included_components:included,excluded_components:names.filter(x => !included.includes(x)) }); }} /> {name.replaceAll('_',' ')} {c.included_components.includes(name) ? '(included)' : '(excluded)'}</label>)}</fieldset>
 <fieldset className="space-y-3"><legend>Typed adjustment wage basis — Accounts classification required</legend>
 {!c.adjustment_basis && <><p>Legacy ADJUSTMENTS does not classify arrears, bonuses, reimbursements or recoveries. Affected calculations remain blocked.</p><Button onClick={() => set('configuration',{...c,included_components:c.included_components.filter(x => x !== 'ADJUSTMENTS'),excluded_components:[...new Set([...c.excluded_components,'ADJUSTMENTS'])],adjustment_basis:{SALARY_ARREARS:'UNRESOLVED',BONUS:'UNRESOLVED',REIMBURSEMENT:'UNRESOLVED',RECOVERY:'UNRESOLVED'}})}>Classify typed adjustments</Button></>}
 {c.adjustment_basis && Object.entries(c.adjustment_basis).map(([type,value]) => <Choice key={type} label={`${type.replaceAll('_',' ')} statutory basis`} value={value} values={type === 'RECOVERY' ? ['UNRESOLVED','DEDUCTION_ONLY'] : ['UNRESOLVED','INCLUDE','EXCLUDE']} onChange={treatment => config('adjustment_basis',{...c.adjustment_basis,[type]:treatment})} />)}
 <p>Recovery is a separate deduction; arrears may have a signed effect linked to the original period. No statutory treatment is inferred.</p></fieldset>
 <Choice label="Statutory collection timing" value={c.collection_timing||'UNRESOLVED'} values={['UNRESOLVED','INCREMENTAL_MONTHLY','MONTH_CLOSE']} onChange={value=>config('collection_timing',value)} /><Choice label="LOP statutory component allocation" value={c.lop_wage_basis||'UNRESOLVED'} values={['UNRESOLVED','PROPORTIONAL_COMPONENTS']} onChange={value=>config('lop_wage_basis',value)} /><Choice label="Included arrears contribution period" value={c.arrears_period||'UNRESOLVED'} values={['UNRESOLVED','CURRENT_RUN_MONTH']} onChange={value=>config('arrears_period',value)} /><p>Select only confirmed scheme rules. Unsupported collection, caps, exemptions and later statutory reversals remain blocked.</p>
 <RoundingFields label="Statutory" value={c.rounding} onChange={value => config('rounding',value)} />
 {isPT && <PTSlabEditor slabs={data.slabs} effectiveFrom={data.effective_from} onChange={slabs=>set('slabs',slabs)} />}
 <Choice label="Accounts setup confirmation" value={data.verification_status} values={['UNVERIFIED','ACCOUNTS_CONFIRMED',...(data.verification_status==='ADVISOR_VERIFIED'?['ADVISOR_VERIFIED']:[])]} onChange={value => setData({ ...data,verification_status:value,advisor_name:null,verification_reference:null,verified_on:null })} />
 <p className="text-amber-400">Saving a draft does not verify legal applicability. Accounts must record the setup owner, reference and confirmation date before publication.</p>
 {['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(data.verification_status) && <><Input label="Setup confirmed by" required value={data.advisor_name || ''} onChange={e => set('advisor_name',e.target.value || null)} /><Input label="Verification evidence reference" required value={data.verification_reference || ''} onChange={e => set('verification_reference',e.target.value || null)} /><Input label="Verified on" required type="date" value={data.verified_on || ''} onChange={e => set('verified_on',e.target.value || null)} /></>}
 </>;
}
