const { z } = require('zod');
// Exact decimal strings cross the API boundary; no binary-float monetary values.
const decimal = z.string().regex(/^(0|[1-9]\d{0,10})(\.\d{1,4})?$/, 'Use an unsigned decimal string with at most four places.');
const units = value => { if (typeof value !== 'string' || !/^(0|[1-9]\d{0,10})(\.\d{1,4})?$/.test(value)) return -1n; const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0')); };
const bounded = (max, positive = false) => decimal.refine(v => units(v) >= 0n && units(v) <= units(max) && (!positive || units(v) > 0n), 'Decimal outside permitted range.');
const money = bounded('99999999999').refine(v => !v.includes('.') || v.split('.')[1].length <= 2, 'Use at most two decimal places.');
const rounding = z.object({ method: z.enum(['UNRESOLVED','HALF_UP','HALF_EVEN','DOWN','UP']), precision: z.number().int().min(0).max(6).nullable(), stage: z.enum(['UNRESOLVED','DAILY','LINE','AGGREGATE','MONTH']) }).strict().refine(v => v.method === 'UNRESOLVED' ? v.precision === null && v.stage === 'UNRESOLVED' : v.precision !== null && v.stage !== 'UNRESOLVED', 'Specify rounding precision and stage together.');
const text = z.string().trim().min(1).max(2000);
const base = { effective_from: z.iso.date(), effective_to: z.iso.date(), reason: text };
const policy = z.object({ ...base, group_code: z.string().min(1).max(40).nullable(), monthly_entitlement_method: z.literal('CONTRACTUAL_MONTHLY_GROSS'),
 lop_method: z.enum(['FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS']), lop_fixed_divisor: bounded('9999', true).nullable(),
 partial_month_proration_method: z.enum(['UNRESOLVED','FIXED_DIVISOR','ACTUAL_CALENDAR_DAYS','WORK_CALENDAR']), partial_month_fixed_divisor: bounded('9999', true).nullable(),
 split_period_allocation_method: z.enum(['UNRESOLVED','CALENDAR_WEIGHTED_WITH_RESIDUAL']), full_month_unpaid_treatment: z.enum(['UNRESOLVED','NO_PAYABLE_ENTITLEMENT_ZERO']),
 leave_weekly_off_method: z.enum(['UNRESOLVED','WORK_CALENDAR','EXCLUDE_PAID_CALENDAR_DAYS']), monetary_rounding_method: z.enum(['UNRESOLVED','HALF_UP_2']), special_package_period:z.enum(['UNRESOLVED','MONTHLY_CONFIRMED']).optional(), sandwich_enabled: z.literal(false),
 rounding: z.object({ lop: rounding, proration: rounding, allocation: rounding }).strict(), work_calendar_reference: text.nullable()
}).strict().refine(v => v.effective_from <= v.effective_to, 'Invalid effective range.').refine(v => (v.lop_method === 'FIXED_DIVISOR') === (v.lop_fixed_divisor !== null), 'LOP divisor must match method.').refine(v => (v.partial_month_proration_method === 'FIXED_DIVISOR') === (v.partial_month_fixed_divisor !== null), 'Proration divisor must match its independent method.');
const components = ['BASIC','STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS'];
const adjustmentTypes = ['SALARY_ARREARS','BONUS','REIMBURSEMENT','RECOVERY'];
const adjustmentBasis = z.object(Object.fromEntries(adjustmentTypes.map(type => [type, z.enum(type === 'RECOVERY' ? ['UNRESOLVED','DEDUCTION_ONLY'] : ['UNRESOLVED','INCLUDE','EXCLUDE'])]))).strict();
const configuration = z.object({ arrears_period:z.enum(['UNRESOLVED','CURRENT_RUN_MONTH']).optional(), collection_timing:z.enum(['UNRESOLVED','INCREMENTAL_MONTHLY','MONTH_CLOSE']).optional(), lop_wage_basis:z.enum(['UNRESOLVED','PROPORTIONAL_COMPONENTS']).optional(), adjustment_basis: adjustmentBasis.optional(), employee_rate: bounded('100').nullable(), employer_rate: bounded('100').nullable(), included_components: z.array(z.enum(components)).min(1).max(8), excluded_components: z.array(z.enum(components)).max(8),
 eligibility: z.enum(['UNRESOLVED','ENROLLED','WAGE_CEILING','ENROLLED_AND_WAGE_CEILING','JURISDICTION_PROFILE']), eligibility_ceiling: bounded('99999999999').nullable(), wage_ceiling: bounded('99999999999').nullable(), contribution_minimum: bounded('99999999999').nullable(), contribution_cap: bounded('99999999999').nullable(),
 calculation_method: z.enum(['UNRESOLVED','QUALIFYING_WAGE_PERCENTAGE','CAPPED_WAGE_PERCENTAGE','SLABS']), rounding, aggregation: z.literal('CALENDAR_MONTH'), effective_rule: z.literal('MONTH_START'), conditions: z.enum(['UNRESOLVED','NONE','PROFILE_EXEMPTIONS'])
}).strict().refine(v => new Set([...v.included_components,...v.excluded_components]).size === 8 && v.included_components.length + v.excluded_components.length === 8, 'Classify every earning component exactly once.').refine(v => v.contribution_minimum === null || v.contribution_cap === null || units(v.contribution_minimum) <= units(v.contribution_cap), 'Minimum exceeds cap.').refine(v => !v.adjustment_basis || v.excluded_components.includes('ADJUSTMENTS'), 'Typed adjustments cannot also use the legacy aggregate wage basis.');
const slab = z.object({ month: z.number().int().min(1).max(12), lower_bound: money, upper_bound: money.nullable(), deduction_amount: money }).strict().refine(v => v.upper_bound === null || units(v.upper_bound) > units(v.lower_bound), 'Invalid slab boundaries.');
const statutory = z.object({ ...base,effective_to:z.iso.date().nullable(), scheme: z.enum(['EPF','ESI','PT']), state_id:z.uuid().nullable().optional(), jurisdiction: z.string().trim().min(1).max(120), establishment: z.string().trim().min(1).max(120), configuration,
 verification_status: z.enum(['UNVERIFIED','ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED']), advisor_name: z.string().trim().min(1).max(120).nullable(), verification_reference: text.nullable(), verified_on: z.iso.date().nullable(), slabs: z.array(slab).max(1200)
}).strict().superRefine((v, ctx) => {
 const issue = message => ctx.addIssue({ code: 'custom', message });
 if (v.effective_from > v.effective_to) issue('Invalid effective range.');
 if (v.verification_status === 'UNVERIFIED' ? [v.advisor_name,v.verification_reference,v.verified_on].some(x => x !== null) : [v.advisor_name,v.verification_reference,v.verified_on].some(x => x === null)) issue('Verification evidence must match verification status.');
 const c = v.configuration;
 if (v.scheme === 'PT') {
  if (c.employee_rate !== null || c.employer_rate !== null || !['UNRESOLVED','SLABS'].includes(c.calculation_method) || !['UNRESOLVED','JURISDICTION_PROFILE'].includes(c.eligibility) || [c.wage_ceiling,c.eligibility_ceiling,c.contribution_minimum,c.contribution_cap].some(x => x !== null)) issue('PT uses jurisdiction slabs, not rates or ceilings.');
  if (v.slabs.length) for (let month = 1; month <= 12; month++) {
   const rows = v.slabs.filter(s => s.month === month).sort((a,b) => units(a.lower_bound) < units(b.lower_bound) ? -1 : 1);
   let end = '0';
   for (const s of rows) { if (end === null || units(s.lower_bound) !== units(end)) issue(`Month ${month}: slab gap or overlap.`); end = s.upper_bound; }
   if (!rows.length || end !== null) issue(`Month ${month}: complete zero-to-infinity slabs required.`);
  }
 } else {
  if (v.slabs.length || c.calculation_method === 'SLABS' || c.eligibility === 'JURISDICTION_PROFILE') issue('Invalid EPF/ESI configuration.');
  if (c.calculation_method === 'QUALIFYING_WAGE_PERCENTAGE' && c.wage_ceiling !== null) issue('Wage ceiling requires capped method.');
 }
});
const kind = z.enum(['policies','statutory']);
const params = z.object({ kind }).strict();
const idParams = z.object({ kind, id: z.uuid() }).strict();
const save = z.object({ id: z.uuid().nullable(), expected_version: z.number().int().min(0), data: z.unknown() }).strict();
module.exports = {configuration,slab, policy, statutory, components, adjustmentTypes, units, rounding,
 list: { params, query: z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() },
 save: { params, body: save }, preview: { params: idParams },
 publish: { params: idParams, body: z.object({ expected_version: z.number().int().positive(), preview_token: z.string().regex(/^[a-f0-9]{32}$/), approval_reference: text }).strict() },
 resolve: { params, query: z.object({ date: z.iso.date(), group_code: z.string().min(1).max(40).optional(), scheme: z.enum(['EPF','ESI','PT']).optional(), statutory_scope_id: z.uuid().optional(), jurisdiction: z.string().trim().min(1).max(120).optional(), establishment: z.string().trim().min(1).max(120).optional() }).strict() }
};
