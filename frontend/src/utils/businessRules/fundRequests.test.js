import { describe, it, expect } from 'vitest';
import {
  getFundRequestCommittedAmount,
  buildApprovedFundRequestSumByWo,
  buildSubmittedFrSumByWo,
  computeFundRequestRemaining,
  filterApprovedThisMonth
} from './fundRequests';

describe('fundRequests business rules', () => {
  const requests = [
    {
      work_order_no: 'PUR02',
      request_status: 'Approved',
      zo_fr_amount: 22000,
      approve_ho_amount: 10000,
      approve_ho_date: '2026-08-05T00:00:00.000Z'
    },
    {
      work_order_no: 'PUR02',
      request_status: 'Pending',
      zo_fr_amount: 15000
    },
    {
      work_order_no: 'JHR01',
      request_status: 'Hold',
      zo_fr_amount: 22000
    }
  ];

  it('uses approve_ho_amount for approved rows in committed sum', () => {
    expect(getFundRequestCommittedAmount(requests[0])).toBe(10000);
    expect(getFundRequestCommittedAmount(requests[1])).toBe(15000);
  });

  it('buildApprovedFundRequestSumByWo sums only approved HO amounts', () => {
    expect(buildApprovedFundRequestSumByWo(requests)).toEqual({ PUR02: 10000 });
  });

  it('buildSubmittedFrSumByWo includes pipeline amounts with approved HO amounts', () => {
    expect(buildSubmittedFrSumByWo(requests)).toEqual({
      PUR02: 25000,
      JHR01: 22000
    });
  });

  it('computeFundRequestRemaining matches backend funding cap math', () => {
    const approvedTotal = buildApprovedFundRequestSumByWo(requests).PUR02;
    expect(computeFundRequestRemaining(300000, approvedTotal)).toBe(290000);
  });

  it('filterApprovedThisMonth filters by approve_ho_date', () => {
    const now = new Date('2026-08-10T00:00:00.000Z');
    const approved = filterApprovedThisMonth(requests, now);
    expect(approved).toHaveLength(1);
    expect(approved[0].approve_ho_amount).toBe(10000);
  });
});
