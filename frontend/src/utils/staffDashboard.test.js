import { describe, it, expect } from 'vitest';
import { filterStaffPendingRequisitions, getPendingRequisitionAmount } from './staffDashboard';

describe('staffDashboard utils', () => {
  const requisitions = [
    { requisition_status: 'Pending', requisition_amount: 75000, approved_amount: 0 },
    { requisition_status: 'Approved', requisition_amount: 50000, approved_amount: 50000 },
    { requisition_status: 'Pending', requested_amount: 25000 }
  ];

  it('filterStaffPendingRequisitions matches exact Pending status', () => {
    const pending = filterStaffPendingRequisitions(requisitions);
    expect(pending).toHaveLength(2);
  });

  it('getPendingRequisitionAmount prefers requisition_amount over requested_amount', () => {
    expect(getPendingRequisitionAmount(requisitions[0])).toBe(75000);
    expect(getPendingRequisitionAmount(requisitions[2])).toBe(25000);
    expect(getPendingRequisitionAmount({ approved_amount: 99999 })).toBe(0);
  });
});
