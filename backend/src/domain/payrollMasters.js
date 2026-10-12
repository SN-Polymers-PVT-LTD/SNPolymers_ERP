const { z } = require('zod');
const { policy, statutory, adjustmentTypes, units } = require('../validation/payrollMasters.schema');
function validateMaster(kind, data) {
 if (!['policies','statutory'].includes(kind)) return { valid: false, issues: [{ message: 'Unknown master kind.' }], blockers: [] };
 const parsed = (kind === 'policies' ? policy : statutory).safeParse(data);
 if (!parsed.success) return { valid: false, issues: parsed.error.issues, blockers: [] };
 const d = parsed.data, blockers = [];
 const block = (field, code = 'UNRESOLVED') => blockers.push({ field, code });
 if (kind === 'policies') {
  for (const key of ['partial_month_proration_method','split_period_allocation_method','full_month_unpaid_treatment','leave_weekly_off_method']) if (d[key] === 'UNRESOLVED') block(key);
  for (const key of ['lop','proration','allocation']) if (d.rounding[key].method === 'UNRESOLVED') block(`rounding.${key}`);
  if (d.partial_month_proration_method === 'WORK_CALENDAR' || d.leave_weekly_off_method === 'WORK_CALENDAR') block('work_calendar_reference','APPROVED_CALENDAR_REQUIRED');
 } else {
  const c = d.configuration;
  for (const key of ['eligibility','calculation_method','conditions']) if (['UNRESOLVED','PROFILE_EXEMPTIONS'].includes(c[key])) block(key,'UNSUPPORTED_OR_UNRESOLVED');
  if (c.rounding.method === 'UNRESOLVED') block('rounding');
  if (!['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(d.verification_status)) block('verification_status','ADVISOR_VERIFICATION_REQUIRED');
  if (d.scheme === 'PT') { if (!d.slabs.length) block('slabs','INCOMPLETE_SLABS'); }
  else {
   for (const key of ['employee_rate','employer_rate']) if (c[key] === null) block(key,'RATE_REQUIRED');
   if (['WAGE_CEILING','ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility) && c.eligibility_ceiling === null) block('eligibility_ceiling','CEILING_REQUIRED');
   if (c.calculation_method === 'CAPPED_WAGE_PERCENTAGE' && c.wage_ceiling === null) block('wage_ceiling','CEILING_REQUIRED');
  }
 }
 const configuration_warnings = [...blockers];
 if (kind === 'statutory') {
  for (const type of adjustmentTypes) if (!d.configuration.adjustment_basis || d.configuration.adjustment_basis[type] === 'UNRESOLVED')
   configuration_warnings.push({ field: `adjustment_basis.${type}`, code: 'ADJUSTMENT_CLASSIFICATION_REQUIRED' });
 }
 return { valid: true, data: d, blockers: kind === 'policies' ? [] : blockers, configuration_warnings };
}
function resolveMaster(kind, revisions, scope, date) {
 const error = code => ({ error: code, revision_id: null, blockers: [{ code }] });
 if (!['policies','statutory'].includes(kind)) return error('UNKNOWN_MASTER_KIND');
 if (!z.iso.date().safeParse(date).success) return error('INVALID_DATE');
 if (kind === 'policies' && !scope.group_code) return error('PAYROLL_GROUP_REQUIRED');
 if (kind === 'policies' && ['SNP_CASUAL','SNP_LOCAL','FABRIC_CASUAL','FABRIC_LOCAL'].includes(scope.group_code)) return error('DAILY_WAGE_MASTER_REQUIRED');
 if (kind === 'statutory' && (!scope.scheme || (!scope.statutory_scope_id && (!scope.jurisdiction || !scope.establishment)))) return error('STATUTORY_SCOPE_REQUIRED');
 let rows = revisions.filter(r => r.status === 'PUBLISHED' && r.effective_from <= date && (!r.effective_to || date <= r.effective_to));
 if (kind === 'policies') { const specific = rows.filter(r => r.group_code === scope.group_code); rows = specific.length ? specific : rows.filter(r => r.group_code === null); }
 else rows = rows.filter(r => r.scheme === scope.scheme && (scope.statutory_scope_id ? r.statutory_scope_id === scope.statutory_scope_id : r.jurisdiction === scope.jurisdiction && r.establishment === scope.establishment) && ['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(r.verification_status));
 if (rows.length !== 1) return error(rows.length ? 'AMBIGUOUS_POLICY' : 'MISSING_POLICY');
 const r = rows[0], validation = validateMaster(kind, r.data);
 if (!validation.valid) return { ...error('INVALID_POLICY'), revision_id: r.id, issues: validation.issues };
 return { kind, revision_id: r.id, revision: r, data: validation.data, statutory_scope_id: r.statutory_scope_id || null, blockers: validation.blockers, configuration_warnings: [...validation.configuration_warnings, ...(kind === 'statutory' && !r.statutory_scope_id ? [{field:'statutory_scope_id',code:'CANONICAL_SCOPE_REQUIRED'}] : [])], financial_workflows_enabled: false };
}
// Select a configured half-open PT slab, without withholding/posting or guessing
// earnings. The caller must supply resolved revision and statutory-month wages.
function selectProfessionalTaxSlab(resolved, month, wage) {
 if (!resolved || !Array.isArray(resolved.blockers)) return { error: 'INVALID_RESOLVED_REVISION' };
 if (resolved.error || resolved.blockers.length) return { error: 'BLOCKED_STATUTORY_POLICY', blockers: resolved.blockers };
 if (!resolved.data) return { error: 'INVALID_RESOLVED_REVISION' };
 if (resolved.data.scheme !== 'PT') return { error: 'NOT_PT_POLICY' };
 const amount = units(wage);
 if (amount < 0n) return { error: 'INVALID_WAGE' };
 const rows = resolved.data.slabs.filter(s => s.month === month && units(s.lower_bound) <= amount && (s.upper_bound === null || amount < units(s.upper_bound)));
 return rows.length === 1 ? { revision_id: resolved.revision_id, slab: rows[0] } : { error: rows.length ? 'AMBIGUOUS_SLAB' : 'MISSING_SLAB' };
}
// Readiness inspects explicit source facts only. It neither calculates nor enables money.
function calculationReadiness(resolved, scenario) {
 const blockers = [...(resolved?.blockers || [])];
 const block = (field, code = 'UNRESOLVED') => blockers.push({field, code});
 if (!resolved?.revision_id || !resolved.data || resolved.error) block('revision_id','RESOLVED_MASTER_REQUIRED');
 else if (resolved.kind === 'policies') {
  const flags = ['has_lop','partial_month','split_run','full_month_unpaid','weekly_off_leave'];
  if (!scenario || flags.some(key => typeof scenario[key] !== 'boolean') || (scenario.full_month_unpaid && !scenario.has_lop)) block('scenario','CALCULATION_CONTEXT_REQUIRED');
  else {
   const d = resolved.data;
   const requireRule = (field) => { if (d[field] === 'UNRESOLVED') block(field); };
   const requireRounding = key => { if (d.rounding[key].method === 'UNRESOLVED') block(`rounding.${key}`); };
   if (scenario.has_lop) requireRounding('lop');
   if (scenario.partial_month) { requireRule('partial_month_proration_method'); requireRounding('proration'); }
   if (scenario.split_run) { requireRule('split_period_allocation_method'); requireRounding('allocation'); }
   if (scenario.full_month_unpaid) requireRule('full_month_unpaid_treatment');
   if (scenario.weekly_off_leave) requireRule('leave_weekly_off_method');
   if ((scenario.partial_month && d.partial_month_proration_method === 'WORK_CALENDAR') || (scenario.weekly_off_leave && d.leave_weekly_off_method === 'WORK_CALENDAR')) block('work_calendar_reference','APPROVED_CALENDAR_REQUIRED');
  }
 } else if (resolved.kind === 'statutory') {
  if (!resolved.statutory_scope_id) block('statutory_scope_id','CANONICAL_SCOPE_REQUIRED');
  if (scenario?.statutory_profile_verified !== true) block('statutory_profile','VERIFIED_EMPLOYEE_PROFILE_REQUIRED');
  if (!Array.isArray(scenario?.adjustment_types) || scenario.adjustment_types.some(type => !adjustmentTypes.includes(type))) block('adjustment_types','CALCULATION_CONTEXT_REQUIRED');
  else for (const type of new Set(scenario.adjustment_types)) {
   const treatment = resolved.data.configuration.adjustment_basis?.[type];
   if (!treatment || treatment === 'UNRESOLVED') block(`adjustment_basis.${type}`,'ADJUSTMENT_CLASSIFICATION_REQUIRED');
  }
 } else block('kind','UNKNOWN_MASTER_KIND');
 return {ready: blockers.length === 0, blockers, configuration_warnings: resolved?.configuration_warnings || [], financial_workflows_enabled:false};
}
module.exports = { validateMaster, resolveMaster, calculationReadiness, selectProfessionalTaxSlab };
