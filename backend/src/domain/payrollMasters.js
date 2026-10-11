const { z } = require('zod');
const { policy, statutory, units } = require('../validation/payrollMasters.schema');
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
  if (d.verification_status !== 'ADVISOR_VERIFIED') block('verification_status','ADVISOR_VERIFICATION_REQUIRED');
  if (d.scheme === 'PT') { if (!d.slabs.length) block('slabs','INCOMPLETE_SLABS'); }
  else {
   for (const key of ['employee_rate','employer_rate']) if (c[key] === null) block(key,'RATE_REQUIRED');
   if (['WAGE_CEILING','ENROLLED_AND_WAGE_CEILING'].includes(c.eligibility) && c.eligibility_ceiling === null) block('eligibility_ceiling','CEILING_REQUIRED');
   if (c.calculation_method === 'CAPPED_WAGE_PERCENTAGE' && c.wage_ceiling === null) block('wage_ceiling','CEILING_REQUIRED');
  }
 }
 return { valid: true, data: d, blockers };
}
function resolveMaster(kind, revisions, scope, date) {
 const error = code => ({ error: code, revision_id: null, blockers: [{ code }] });
 if (!['policies','statutory'].includes(kind)) return error('UNKNOWN_MASTER_KIND');
 if (!z.iso.date().safeParse(date).success) return error('INVALID_DATE');
 if (kind === 'policies' && !scope.group_code) return error('PAYROLL_GROUP_REQUIRED');
 if (kind === 'policies' && ['SNP_CASUAL','SNP_LOCAL','FABRIC_CASUAL','FABRIC_LOCAL'].includes(scope.group_code)) return error('DAILY_WAGE_MASTER_REQUIRED');
 if (kind === 'statutory' && (!scope.jurisdiction || !scope.establishment || !scope.scheme)) return error('STATUTORY_SCOPE_REQUIRED');
 let rows = revisions.filter(r => r.status === 'PUBLISHED' && r.effective_from <= date && date <= r.effective_to);
 if (kind === 'policies') { const specific = rows.filter(r => r.group_code === scope.group_code); rows = specific.length ? specific : rows.filter(r => r.group_code === null); }
 else rows = rows.filter(r => r.scheme === scope.scheme && r.jurisdiction === scope.jurisdiction && r.establishment === scope.establishment && r.verification_status === 'ADVISOR_VERIFIED');
 if (rows.length !== 1) return error(rows.length ? 'AMBIGUOUS_POLICY' : 'MISSING_POLICY');
 const r = rows[0], validation = validateMaster(kind, r.data);
 if (!validation.valid) return { ...error('INVALID_POLICY'), revision_id: r.id, issues: validation.issues };
 return { revision_id: r.id, revision: r, data: validation.data, blockers: validation.blockers, financial_workflows_enabled: false };
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
module.exports = { validateMaster, resolveMaster, selectProfessionalTaxSlab };
