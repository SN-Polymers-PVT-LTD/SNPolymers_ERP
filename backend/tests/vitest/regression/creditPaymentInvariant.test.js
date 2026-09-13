import { describe, expect, test } from 'vitest';
const {
  addLineItemSchema,
  updateLineItemSchema,
  resubmitLineItemSchema
} = require('../../../src/validation/acctRequisition.schema');

const validParams = {
  sheetId: '11111111-1111-4111-8111-111111111111',
  itemId: '22222222-2222-4222-8222-222222222222'
};

const parse = (schema, body) => schema.body.safeParse(body);

describe('Accounts Credit payment invariant', () => {
  test.each([
    ['Credit / Credit', { debit_bank_ac_type: 'Credit', payment_mode: 'Credit' }],
    ['empty draft', { debit_bank_ac_type: null, payment_mode: null }],
    ['cash bank with incomplete payment mode', { debit_bank_ac_type: 'HDFC', payment_mode: null }],
    ['cash bank with NEFT', { debit_bank_ac_type: 'HDFC', payment_mode: 'NEFT' }]
  ])('accepts %s', (_label, fields) => {
    expect(parse(addLineItemSchema, fields).success).toBe(true);
  });

  test.each([
    { debit_bank_ac_type: 'Credit', payment_mode: null },
    { debit_bank_ac_type: 'Credit', payment_mode: 'NEFT' },
    { debit_bank_ac_type: 'HDFC', payment_mode: 'Credit' },
    { debit_bank_ac_type: null, payment_mode: 'Credit' }
  ])('rejects contradictory Credit fields: %j', (fields) => {
    const result = parse(addLineItemSchema, fields);
    expect(result.success).toBe(false);
    expect(result.error.issues.some(issue => issue.path.includes('payment_mode'))).toBe(true);
  });

  test('uses the same invariant for update and resubmit schemas', () => {
    const fields = { debit_bank_ac_type: 'HDFC', payment_mode: 'Credit' };
    expect(updateLineItemSchema.params.safeParse(validParams).success).toBe(true);
    expect(resubmitLineItemSchema.params.safeParse({ itemId: validParams.itemId }).success).toBe(true);
    expect(parse(updateLineItemSchema, fields).success).toBe(false);
    expect(parse(resubmitLineItemSchema, fields).success).toBe(false);
  });
});
