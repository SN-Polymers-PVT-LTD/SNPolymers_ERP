import { describe, it, expect } from 'vitest';
import { newStatutoryConfiguration, statutoryPreset, applyStatutoryPreset, withContributionBasis } from '../../../../frontend/src/components/payroll/statutoryPresets.js';
const { statutory } = require('../../../src/validation/payrollMasters.schema');
const { statutory: statutoryFixture } = require('../../helpers/payrollMasterFixtures');
const { office, leave } = require('../../helpers/payrollPreviewFixtures');
const { calculatePreview } = require('../../../src/domain/payroll/preview');

function draft(scheme, basis = ['PACKAGE_BALANCE']) {
 const data = statutoryFixture({ scheme, configuration: withContributionBasis(newStatutoryConfiguration(scheme), basis) });
 return scheme === 'PT' ? data : applyStatutoryPreset(data, statutoryPreset(scheme, '2027-01-01'));
}
function source(scheme) {
 const s = office('2091-11-01');
 s.financial_context = { activation_enabled: false };
 Object.assign(s.pay_structures[0], { guaranteed_monthly_gross: '15000.00', basic_salary: null, staff_welfare: null, other_fixed_components: null, epf_enrolment: scheme === 'EPF', esi_enrolment: scheme === 'ESI' });
 s.statutory_profiles = ['EPF', 'ESI', 'PT'].map(name => ({ id: 'profile-' + name, scheme: name, effective_from: '2090-01-01', effective_to: null, verification_status: 'ACCOUNTS_CONFIRMED', statutory_scope_id: 'scope', applicability: name === scheme ? 'APPLICABLE' : 'NOT_APPLICABLE', enrolled: name === scheme }));
 s.statutory_calculation_rules = [{ ...draft(scheme), id: 'rule', statutory_scope_id: 'scope', effective_from: '2090-01-01', verification_status: 'ACCOUNTS_CONFIRMED' }];
 s.statutory_calculation_rules.push({ ...draft('PT'), id: 'pt-rule', statutory_scope_id: 'scope', effective_from: '2090-01-01', slabs: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, lower_bound: '0', upper_bound: null, deduction_amount: '0' })), verification_status: 'ACCOUNTS_CONFIRMED' });
 s.statutory_entries = []; s.adjustments = []; s.adjustment_applications = [];
 return s;
}
describe('frontend statutory presets with the actual backend contract and calculator', () => {
 it.each(['EPF', 'ESI', 'PT'])('%s draft matches the strict API contract', scheme => {
  const result = statutory.safeParse(draft(scheme));
  expect(result.error?.issues).toBeUndefined(); expect(result.success).toBe(true);
 });
 it.each([
  ['EPF', false, '15000.00', '1800.00', '1800.00'],
  ['EPF', true, '13500.00', '1620.00', '1620.00'],
  ['ESI', false, '15000.00', '113.00', '488.00'],
  ['ESI', true, '13500.00', '102.00', '439.00']
 ])('%s preset processes unpaid leave=%s with declared rounding', (scheme, unpaid, gross, employee, employer) => {
  const s = source(scheme);
  if (unpaid) s.leave = [leave('2091-11-05', '2091-11-07')];
  const result = calculatePreview(s);
  expect(result.blockers).toEqual([]);
  expect(result.gross_after_lop).toBe(gross);
  expect(result.statutory.find(entry => entry.scheme === scheme)).toMatchObject({ employee_deduction: employee, employer_contribution: employer });
 });
 it('preserves fail-closed treatment of unavailable components and unclassified adjustments', () => {
  const s = source('EPF');
  s.statutory_calculation_rules[0].configuration = withContributionBasis(s.statutory_calculation_rules[0].configuration, ['BASIC']);
  expect(calculatePreview(s).blockers.map(b => b.code)).toContain('INVALID_STATUTORY_CONFIGURATION');
  s.statutory_calculation_rules[0].configuration = withContributionBasis(s.statutory_calculation_rules[0].configuration, ['PACKAGE_BALANCE']);
  s.adjustments = [{ id: 'bonus', kind: 'BONUS', amount: '1000.00', effective_date: '2091-11-05', status: 'APPROVED', version: 2, target_row_id: s.row.id }];
  expect(calculatePreview(s).blockers.map(b => b.code)).toContain('ADJUSTMENT_CLASSIFICATION_REQUIRED');
 });
});

it.each(['EPF','ESI'])('%s automatic recovery treatment permits an advance without reducing contribution wages',scheme=>{
 const s=source(scheme);
 s.adjustments=[{id:'advance',employee_id:s.row.employee_id,kind:'ADVANCE',amount:'1000.00',installment:'100.00',effective_date:'2090-01-01',recovery_start_month:'2091-11-01',status:'APPROVED',version:2}];
 const result=calculatePreview(s);
 expect(result.blockers).toEqual([]);
 expect(result.gross_after_lop).toBe('15000.00');
 expect(result.deductions.find(line=>line.code==='ADVANCE_RECOVERY').amount).toBe('100.00');
 expect(result.statutory.find(entry=>entry.scheme===scheme)).toMatchObject({employee_deduction:scheme==='EPF'?'1800.00':'113.00',employer_contribution:scheme==='EPF'?'1800.00':'488.00'});
});
