import { describe, it, expect } from 'vitest';
import { statutoryPreset, applyStatutoryPreset, newStatutoryConfiguration, contributionBasis, withContributionBasis, statutoryDraftInput, standardStatutorySettings } from './statutoryPresets';

describe('dated statutory authoring suggestions', () => {
 it.each([
  ['2025-01-01', '15000'], ['2026-08-31', '15000'], ['2026-10-01', '25000'], ['2027-01-01', '25000']
 ])('suggests the EPF ceiling for %s', (date, ceiling) => {
  expect(statutoryPreset('EPF', date).values).toMatchObject({ employee_rate: '12', employer_rate: '12', wage_ceiling: ceiling });
 });
 it.each(['', 'invalid', '2026-02-30', '2014-08-01', '2020-05-01', '2020-07-31', '2026-09-01', '2026-09-17', '2026-09-30'])('does not invent a blanket EPF preset for %s', date => {
  expect(statutoryPreset('EPF', date)).toBeNull();
 });
 it('identifies the next historical review boundary', () => {
  expect(statutoryPreset('EPF', '2019-01-01').reviewAfter).toBe('2020-04-30');
  expect(statutoryPreset('EPF', '2025-01-01').reviewAfter).toBe('2026-08-31');
 });
 it('dates ESI rates and never invents state PT slabs', () => {
  expect(statutoryPreset('ESI', '2019-06-30')).toBeNull();
  expect(statutoryPreset('ESI', '2019-07-01').values).toMatchObject({ employee_rate: '0.75', employer_rate: '3.25', eligibility_ceiling: '21000', wage_ceiling: null });
  expect(statutoryPreset('PT', '2027-01-01')).toBeNull();
 });
 it('requires an explicit wage basis and keeps adjustments undecided', () => {
  const configuration = newStatutoryConfiguration();
  expect(configuration.included_components).toEqual([]);
  expect(configuration.adjustment_basis.BONUS).toBe('UNRESOLVED');
  const selected = withContributionBasis(configuration, ['PACKAGE_BALANCE', 'DAILY_WAGE']);
  expect(contributionBasis(selected.included_components)).toBe('CUSTOM');
  expect(selected.excluded_components).not.toContain('DAILY_WAGE');
  expect(new Set([...selected.included_components, ...selected.excluded_components]).size).toBe(5);
 });
 it('applies only to a copied draft, preserves exceptions and excludes server-owned confirmation from requests', () => {
  const data = { configuration: { ...newStatutoryConfiguration(), employee_rate: '7.1234', contribution_cap: '800', collection_timing: 'MONTH_CLOSE', included_components: ['DAILY_WAGE'] }, verification_status: 'ACCOUNTS_CONFIRMED', advisor_name: 'Owner', verification_reference: 'OLD', verified_on: '2025-01-01', establishment: 'Factory' };
  const original = structuredClone(data);
  const applied = applyStatutoryPreset(data, statutoryPreset('ESI', '2027-01-01'));
  expect(data).toEqual(original);
  expect(applied.configuration).toMatchObject({ employee_rate: '0.75', contribution_cap: '800', collection_timing: 'MONTH_CLOSE', included_components: ['DAILY_WAGE'], rounding: { method: 'UP', precision: 0, stage: 'MONTH' } });
  expect(statutoryDraftInput(applied)).not.toHaveProperty('verification_status');
  expect(statutoryDraftInput(applied)).not.toHaveProperty('advisor_name');
 });
});


it('automatic calculation defaults are explicit and preserve entered amounts, wage choices and adjustment decisions', () => {
 const data = {scheme:'ESI',configuration:{...withContributionBasis(newStatutoryConfiguration('ESI'),['PACKAGE_BALANCE','OVERTIME']),employee_rate:'0.8123',employer_rate:'3.4567',wage_ceiling:'54321.12',eligibility_ceiling:'45678.90',eligibility:'ENROLLED',calculation_method:'CAPPED_WAGE_PERCENTAGE',conditions:'PROFILE_EXEMPTIONS',lop_wage_basis:'UNRESOLVED',arrears_period:'UNRESOLVED',collection_timing:'MONTH_CLOSE',rounding:{method:'HALF_EVEN',precision:4,stage:'AGGREGATE'},adjustment_basis:{BONUS:'INCLUDE',SALARY_ARREARS:'EXCLUDE',REIMBURSEMENT:'UNRESOLVED',RECOVERY:'DEDUCTION_ONLY'}}};
 const before=structuredClone(data), standard=standardStatutorySettings(data);
 expect(data).toEqual(before);
 expect(standard.configuration).toMatchObject({employee_rate:'0.8123',employer_rate:'3.4567',included_components:['PACKAGE_BALANCE','OVERTIME'],eligibility_ceiling:'45678.90',wage_ceiling:null,eligibility:'ENROLLED_AND_WAGE_CEILING',calculation_method:'QUALIFYING_WAGE_PERCENTAGE',conditions:'NONE',collection_timing:'MONTH_CLOSE',lop_wage_basis:'PROPORTIONAL_COMPONENTS',arrears_period:'CURRENT_RUN_MONTH',rounding:{method:'UP',precision:0,stage:'MONTH'},adjustment_basis:{BONUS:'INCLUDE',SALARY_ARREARS:'EXCLUDE'}});
});
it('saving older typed-adjustment drafts repairs only the single supported recovery treatment', () => {
 const data={scheme:'EPF',configuration:{...newStatutoryConfiguration(),adjustment_basis:{BONUS:'EXCLUDE',SALARY_ARREARS:'INCLUDE',REIMBURSEMENT:'INCLUDE',RECOVERY:'UNRESOLVED'}}};
 const before=structuredClone(data), input=statutoryDraftInput(data);
 expect(data).toEqual(before);
 expect(input.configuration.adjustment_basis).toEqual({...data.configuration.adjustment_basis,RECOVERY:'DEDUCTION_ONLY'});
});
