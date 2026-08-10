import { describe, it, expect } from 'vitest';
const { getFundRequestCommittedAmount } = require('../../../src/services/workOrderCapacity.service');

describe('workOrderCapacity.service committed amount', () => {
  it('getFundRequestCommittedAmount mirrors client spec 4(c) per-row amounts', () => {
    expect(
      getFundRequestCommittedAmount({
        request_status: 'Approved',
        zo_fr_amount: 22000,
        approve_ho_amount: 10000
      })
    ).toBe(10000);

    expect(
      getFundRequestCommittedAmount({
        request_status: 'Pending',
        zo_fr_amount: 15000
      })
    ).toBe(15000);

    expect(
      getFundRequestCommittedAmount({
        request_status: 'Hold',
        zo_fr_amount: 8000
      })
    ).toBe(8000);

    expect(
      getFundRequestCommittedAmount({
        request_status: 'Cancelled',
        zo_fr_amount: 5000
      })
    ).toBe(0);
  });
});
