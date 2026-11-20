import { afterEach, expect, test, vi } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const { exportBulkNeft } = require('../../../src/controllers/acctRequisition.controller');
const telegram = require('../../../src/services/telegram.service');
const mockRes = require('../../helpers/mockRes');
const ExcelJS = require('exceljs');

afterEach(() => vi.restoreAllMocks());

test('paid salary blocks the complete export; unpaid salary supports export retries', async () => {
  const sheetId = '00000000-0000-4000-8000-000000000001';
  const id = '00000000-0000-4000-8000-000000000002';
  const item = {
    id, sheet_id: sheetId, payroll_row_id: id, requisition_status: 'Approved',
    payment_mode: 'Bulk NEFT', debit_bank_ac_type: 'Test Bank', ho_pass_amount: '2400.00',
    beneficiary_name: 'Test Employee', beneficiary_ac_no: '001234567890',
    beneficiary_bank_name: 'Test Bank', beneficiary_ifsc: 'TEST0001234'
  };
  const lookup = vi.fn().mockResolvedValueOnce({ data: [{ delivery_id: id }] })
    .mockResolvedValue({ data: [] });
  const update = vi.fn(() => ({ in: async () => ({ error: null }) }));
  vi.spyOn(telegram, 'notifyAcctBulkNeftExported').mockResolvedValue();
  vi.spyOn(supabase, 'from').mockImplementation(table => {
    switch (table) {
      case 'acct_requisition_line_items':
        return { select: () => ({ in: async () => ({ data: [item] }) }), update };
      case 'payroll_payment_confirmations':
        return { select: () => ({ in: (field, values) => {
          expect(field).toBe('payroll_accounts_deliveries.item_id');
          expect(values).toEqual([id]);
          return { limit: lookup };
        } }) };
      case 'bank_balance_master':
        return { select: () => ({ eq: () => ({
          maybeSingle: async () => ({ data: { account_number: '987654321012' } })
        }) }) };
      default: throw new Error(`Unexpected table: ${table}`);
    }
  });
  const request = { params: { sheetId }, body: { item_ids: [id] }, user: { role: 'accounts' } };
  const paid = mockRes();
  await exportBulkNeft(request, paid);
  expect(paid.statusCode).toBe(409);
  expect(paid.jsonData.code).toBe('PAYROLL_ALREADY_PAID');
  expect(paid.body).toBeNull();
  expect(update).not.toHaveBeenCalled();

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const unpaid = mockRes();
    await exportBulkNeft(request, unpaid);
    expect(unpaid.statusCode).toBe(200);
    expect(Buffer.isBuffer(unpaid.body)).toBe(true);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(unpaid.body);
    const sheet = book.getWorksheet('Bulk Sheet 1');
    expect(sheet.getCell('A14').value).toBe('Canara Bank,');
    expect(sheet.getRow(25).values.slice(1)).toEqual([
      1, 'Test Employee', '001234567890', 'Test Bank', 'TEST0001234', 2400
    ]);
    expect(sheet.getCell('F26').formula).toBe('SUM(F25:F25)');
  }
  expect(update).toHaveBeenCalledTimes(2);
});
