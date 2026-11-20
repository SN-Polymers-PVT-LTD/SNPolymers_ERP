import { describe, it, expect } from 'vitest';
const { draft, publish, review } = require('../../../src/validation/payrollGuidedSetup.schema');
const { statutory } = require('../../helpers/payrollMasterFixtures');

describe('guided deduction setup validation', () => {
  const base = { state_id: 'e98f9276-28eb-454e-af0f-42ef506e01a6', establishment: 'Test', effective_from: '2027-01-01' };
  it('defaults review to ordinary publication and allows an optional reference and requires a retry key for publish', () => {
    expect(review.body.parse({ expected_version: 1 })).toEqual({ expected_version: 1, initial_setup: false });
    const request = { expected_version: 1, review_token: 'a'.repeat(64), approval_reference: 'Fixture', idempotency_key: base.state_id };
    expect(publish.body.safeParse(request).success).toBe(true);
    expect(publish.body.parse({ ...request, approval_reference: ' ' }).approval_reference).toBeNull();
    expect(publish.body.parse({ ...request, approval_reference: undefined }).approval_reference).toBeNull();
    expect(publish.body.safeParse({ ...request, approval_reference: 'a'.repeat(2001) }).success).toBe(false);
    expect(publish.body.safeParse({ ...request, idempotency_key: undefined }).success).toBe(false);
  });
  it('allows a company-only draft before selecting schemes', () => {
    expect(draft.safeParse({ ...base, rules: {} }).success).toBe(true);
  });
  it('rejects unknown scheme names and unexpected fields', () => {
    expect(draft.safeParse({ ...base, rules: { UNKNOWN: {} }, extra: true }).success).toBe(false);
  });
  it('accepts a matching rule and rejects mismatched scope or coverage', () => {
    const { verification_status, advisor_name, verification_reference, verified_on, ...rule } = statutory({ state_id: base.state_id, establishment: base.establishment, effective_from: '2027-01-01', effective_to: '2027-12-31' });
    expect(draft.safeParse({ ...base, rules: { EPF: rule } }).success).toBe(true);
    const incomplete = { ...rule, reason: '', configuration: { ...rule.configuration, included_components: [], excluded_components: ['PACKAGE_BALANCE', 'DAILY_WAGE', 'OVERTIME', 'HOLIDAY_PREMIUM', 'ADJUSTMENTS'] } };
    expect(draft.parse({ ...base, rules: { EPF: incomplete } }).rules.EPF).toEqual(incomplete);
    for (const change of [{ scheme: 'ESI' }, { state_id: '50ed493e-28e3-42bc-bfb6-329bafc108fe' }, { establishment: 'Other' }, { effective_from: '2027-02-01' }]) {
      expect(draft.safeParse({ ...base, rules: { EPF: { ...rule, ...change } } }).success).toBe(false);
    }
  });
  it('defaults an unselected ESI wage basis and preserves a previously selected basis', () => {
    const { verification_status, advisor_name, verification_reference, verified_on, ...rule } = statutory({
      ...base, scheme: 'ESI', effective_to: null,
    });
    const empty = { ...rule.configuration, included_components: [], excluded_components: ['PACKAGE_BALANCE', ...rule.configuration.excluded_components] };
    const parse = configuration => draft.parse({ ...base, rules: { ESI: { ...rule, configuration } } }).rules.ESI.configuration;
    expect(parse(empty)).toEqual(rule.configuration);
    const saved = { ...empty, included_components: ['DAILY_WAGE'], excluded_components: empty.excluded_components.filter(component => component !== 'DAILY_WAGE') };
    expect(parse(saved)).toEqual(saved);
  });
  it('rejects client-supplied confirmation metadata and invalid contribution values', () => {
    const { verification_status, advisor_name, verification_reference, verified_on, ...rule } = statutory({ state_id: base.state_id, establishment: base.establishment, effective_from: '2027-01-01', effective_to: '2027-12-31' });
    expect(draft.safeParse({ ...base, rules: { EPF: { ...rule, verification_status: 'ACCOUNTS_CONFIRMED' } } }).success).toBe(false);
    expect(draft.safeParse({ ...base, rules: { EPF: { ...rule, configuration: { ...rule.configuration, employee_rate: '101' } } } }).success).toBe(false);
  });
});
