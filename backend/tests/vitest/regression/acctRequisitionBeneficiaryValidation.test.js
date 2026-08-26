import { describe, test, expect } from 'vitest';
const { addLineItemSchema, upsertBeneficiarySchema } = require('../../../src/validation/acctRequisition.schema');

// Regression coverage for tightening beneficiary_ac_no: previously only
// .trim()'d, with no digit-count/format restriction anywhere in the codebase.
// Now: 9-18 digits, numeric only — same "empty string passes through"
// convention already used for beneficiary_ifsc, since a partially-filled row
// autosaves '' until the field is complete.
describe('accountsLineItemBody.beneficiary_ac_no — 9-18 digits, numeric only', () => {
  function parse(body) {
    return addLineItemSchema.body.safeParse(body);
  }

  test('9 digits (minimum) is valid', () => {
    expect(parse({ beneficiary_ac_no: '123456789' }).success).toBe(true);
  });

  test('18 digits (maximum) is valid', () => {
    expect(parse({ beneficiary_ac_no: '123456789012345678' }).success).toBe(true);
  });

  test('8 digits is rejected', () => {
    expect(parse({ beneficiary_ac_no: '12345678' }).success).toBe(false);
  });

  test('19 digits is rejected', () => {
    expect(parse({ beneficiary_ac_no: '1234567890123456789' }).success).toBe(false);
  });

  test('non-numeric characters are rejected', () => {
    expect(parse({ beneficiary_ac_no: '12345ABCD' }).success).toBe(false);
  });

  test('leading/trailing whitespace is trimmed before the digit check runs', () => {
    const result = parse({ beneficiary_ac_no: '  123456789  ' });
    expect(result.success).toBe(true);
    expect(result.data.beneficiary_ac_no).toBe('123456789');
  });

  test('empty string still passes through (partially-filled row autosave)', () => {
    expect(parse({ beneficiary_ac_no: '' }).success).toBe(true);
  });

  test('omitted/null still passes through', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ beneficiary_ac_no: null }).success).toBe(true);
  });
});

// upsertBeneficiarySchema.account_number is required (not autosave-tolerant),
// so it's a hard .regex() rather than the .refine()-with-empty-bypass above —
// but the same 9-18-digit rule applies.
describe('upsertBeneficiarySchema.account_number — required, 9-18 digits', () => {
  const validBase = {
    account_number: '123456789',
    ifsc: 'HDFC0000106',
    beneficiary_name: 'Test Beneficiary',
    beneficiary_bank_name: 'HDFC Bank'
  };

  test('valid 9-digit account number is accepted', () => {
    expect(upsertBeneficiarySchema.body.safeParse(validBase).success).toBe(true);
  });

  test('8-digit account number is rejected', () => {
    const result = upsertBeneficiarySchema.body.safeParse({ ...validBase, account_number: '12345678' });
    expect(result.success).toBe(false);
  });

  test('empty account number is rejected (required here, unlike the line-item field)', () => {
    const result = upsertBeneficiarySchema.body.safeParse({ ...validBase, account_number: '' });
    expect(result.success).toBe(false);
  });
});
