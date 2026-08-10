import { describe, it, expect } from 'vitest';
import {
  getRequisitionCommittedAmount,
  buildSubmittedRequisitionSumByWo,
  computeRequisitionAdvisoryRemaining
} from './requisitions';

describe('requisitions business rules', () => {
  const requisitions = [
    {
      work_order_no: 'PUR02',
      requisition_status: 'Approved',
      requisition_amount: 22000,
      approved_amount: 18000
    },
    {
      work_order_no: 'PUR02',
      requisition_status: 'Pending',
      requisition_amount: 12000
    },
    {
      work_order_no: 'JHR01',
      requisition_status: 'Cancelled',
      requisition_amount: 5000
    }
  ];

  it('uses approved_amount for approved rows', () => {
    expect(getRequisitionCommittedAmount(requisitions[0])).toBe(18000);
    expect(getRequisitionCommittedAmount(requisitions[1])).toBe(12000);
    expect(getRequisitionCommittedAmount(requisitions[2])).toBe(0);
  });

  it('buildSubmittedRequisitionSumByWo sums pipeline and approved amounts', () => {
    expect(buildSubmittedRequisitionSumByWo(requisitions)).toEqual({ PUR02: 30000 });
  });

  it('computeRequisitionAdvisoryRemaining subtracts committed total from estimate', () => {
    expect(computeRequisitionAdvisoryRemaining(300000, requisitions, 'PUR02')).toBe(270000);
  });
});
