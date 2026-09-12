import { describe, expect, test } from 'vitest';
import { expandCompletedFundReturn } from './exportHelpers';

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
});
