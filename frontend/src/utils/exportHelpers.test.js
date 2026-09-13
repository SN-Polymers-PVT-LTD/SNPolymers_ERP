import { describe, expect, test } from 'vitest';
import {
  expandCompletedFundReturn,
  fullLedgerRequisitionHeaders,
  buildFullLedgerRequisitionRow
} from './exportHelpers';

describe('expandCompletedFundReturn', () => {
  test('falls back to the single work order when breakdown is absent', () => {
    const rows = expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 1250 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workOrder: 'WO-1', amount: 1250 });
  });

  test('expands and preserves a valid multi-work-order breakdown', () => {
    const rows = expandCompletedFundReturn({
      status: 'Completed', requested_amount: 300,
      breakdown: [{ work_order_no: 'WO-1', amount: 100 }, { work_order_no: 'WO-2', amount: 200 }]
    });
    expect(rows.map(row => row.amount)).toEqual([100, 200]);
  });

  test('does not hide a malformed non-empty breakdown behind the fallback', () => {
    expect(expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 300, breakdown: [{ work_order_no: 'WO-1', amount: 100 }] })).toEqual([]);
  });

  test('defaults paymentOffice to ZO Office when payment_destination is absent', () => {
    const rows = expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 500 });
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentOffice).toBe('ZO Office');
  });

  test('formats paymentOffice according to payment_destination when present', () => {
    const rows = expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 500, payment_destination: 'ACCOUNTS' });
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentOffice).toBe('HO Office');
  });
});

describe('full subcontractor ledger requisition export contract', () => {
  test('keeps headers aligned with financial row values', () => {
    const row = buildFullLedgerRequisitionRow({
      requisition_no: 'REQ-001',
      work_order_no: 'WO-001',
      material_details: 'Vendor A',
      material_sub_head: 'Civil',
      requisition_status: 'Approved',
      payment_status: 'PARTIALLY_PAID',
      payment_destination: 'ACCOUNTS',
      requisition_amount: 50000,
      approved_amount: 45000,
      paid_amount: 30000,
      requester_name: 'JE'
    });

    expect(fullLedgerRequisitionHeaders.length).toBe(row.length);
    expect(row[fullLedgerRequisitionHeaders.indexOf('Payment Status')]).toBe('PARTIALLY_PAID');
    expect(row[fullLedgerRequisitionHeaders.indexOf('Payment Office')]).toBe('HO Office');
    expect(row[fullLedgerRequisitionHeaders.indexOf('Effective Liability (INR)')]).toBe(30000);
    expect(row[fullLedgerRequisitionHeaders.indexOf('Paid Amount (INR)')]).toBe(30000);
  });
});
