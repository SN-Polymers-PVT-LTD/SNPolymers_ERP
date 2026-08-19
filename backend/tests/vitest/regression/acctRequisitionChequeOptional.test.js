import { describe, test, expect } from 'vitest';
const { addLineItemSchema } = require('../../../src/validation/acctRequisition.schema');

// Regression coverage for making cheque_no/cheque_date optional across every
// payment mode (previously a .refine() required both fields when
// payment_mode === 'Cheque'; see acctRequisitionLifecycle.test.js Test 6 for
// the pre-existing happy-path Cheque item used in exportBulkNeft coverage).
describe('accountsLineItemBody — cheque_no/cheque_date are optional for every payment_mode', () => {
  const baseParams = { sheetId: '11111111-1111-1111-1111-111111111111' };

  function parse(body) {
    return addLineItemSchema.body.safeParse(body);
  }

  test('payment_mode Cheque without cheque_no/cheque_date is now valid (was previously rejected)', () => {
    const result = parse({ req_amount: 100, payment_mode: 'Cheque' });
    expect(result.success).toBe(true);
  });

  test('payment_mode Cheque with cheque_no/cheque_date still valid', () => {
    const result = parse({
      req_amount: 100, payment_mode: 'Cheque', cheque_no: '000123', cheque_date: '2026-08-16'
    });
    expect(result.success).toBe(true);
  });

  test('payment_mode NEFT with cheque_no/cheque_date supplied is valid', () => {
    const result = parse({
      req_amount: 100, payment_mode: 'NEFT', cheque_no: '000123', cheque_date: '2026-08-16'
    });
    expect(result.success).toBe(true);
    expect(result.data.cheque_no).toBe('000123');
    expect(result.data.cheque_date).toBe('2026-08-16');
  });

  test('payment_mode RTGS without cheque fields is valid', () => {
    const result = parse({ req_amount: 100, payment_mode: 'RTGS' });
    expect(result.success).toBe(true);
  });

  test('payment_mode Bulk NEFT with only cheque_date supplied is valid', () => {
    const result = parse({ req_amount: 100, payment_mode: 'Bulk NEFT', cheque_date: '2026-08-16' });
    expect(result.success).toBe(true);
  });

  test('no payment_mode at all with cheque fields supplied is valid', () => {
    const result = parse({ req_amount: 100, cheque_no: '000999', cheque_date: '2026-08-16' });
    expect(result.success).toBe(true);
  });

  // Sanity check the schema wiring itself (params + body) via the exported shape used by validateRequest.
  test('addLineItemSchema.params still requires a UUID sheetId', () => {
    expect(addLineItemSchema.params.safeParse(baseParams).success).toBe(true);
    expect(addLineItemSchema.params.safeParse({ sheetId: 'not-a-uuid' }).success).toBe(false);
  });
});

// Regression coverage for beneficiary_ifsc tolerating '' the same as
// omitted/null — autosave now sends whatever's in the draft the moment focus
// leaves the row, including a beneficiary_ac_no filled in ahead of an
// still-empty beneficiary_ifsc, so '' must not trip the format check.
describe('accountsLineItemBody — beneficiary_ifsc treats empty string as absent', () => {
  function parse(body) {
    return addLineItemSchema.body.safeParse(body);
  }

  test('empty string beneficiary_ifsc is valid (was previously rejected by .regex())', () => {
    const result = parse({ req_amount: 100, beneficiary_ac_no: '112023052202', beneficiary_ifsc: '' });
    expect(result.success).toBe(true);
  });

  test('omitted beneficiary_ifsc is still valid', () => {
    const result = parse({ req_amount: 100, beneficiary_ac_no: '112023052202' });
    expect(result.success).toBe(true);
  });

  test('null beneficiary_ifsc is still valid', () => {
    const result = parse({ req_amount: 100, beneficiary_ac_no: '112023052202', beneficiary_ifsc: null });
    expect(result.success).toBe(true);
  });

  test('a well-formed beneficiary_ifsc is still accepted', () => {
    const result = parse({ req_amount: 100, beneficiary_ifsc: 'HDFC0000106' });
    expect(result.success).toBe(true);
  });

  test('a malformed non-empty beneficiary_ifsc is still rejected', () => {
    const result = parse({ req_amount: 100, beneficiary_ifsc: 'not-an-ifsc' });
    expect(result.success).toBe(false);
  });
});
