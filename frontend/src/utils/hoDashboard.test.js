import { describe, it, expect } from 'vitest';
import {
  countPendingEstimates,
  filterPendingRequisitions,
  computeRequisitionStats,
  computeApprovalRate,
  computeCapitalFlow,
  computeBillExposure,
  getActiveWorkOrderCount,
  mergeProjectsWithHealth,
  buildEstimateCountMap
} from './hoDashboard';
import { hoOverviewFixture, hoRequisitionsFixture } from '../test/fixtures/dashboardFixtures';

describe('hoDashboard utils', () => {
  it('getActiveWorkOrderCount returns 0 when running is 0 (not projects.length)', () => {
    expect(getActiveWorkOrderCount(hoOverviewFixture)).toBe(0);
    expect(getActiveWorkOrderCount({ running: 3 })).toBe(3);
    expect(getActiveWorkOrderCount({})).toBe(0);
  });

  it('filterPendingRequisitions is case-insensitive on status field', () => {
    const pending = filterPendingRequisitions(hoRequisitionsFixture);
    expect(pending).toHaveLength(1);
    expect(pending[0].requisition_amount).toBe(50000);
  });

  it('computeApprovalRate handles empty and mixed lists', () => {
    expect(computeApprovalRate([])).toBe('0%');
    expect(computeApprovalRate(hoRequisitionsFixture)).toBe('66.7%');
  });

  it('computeCapitalFlow only counts 30-day approved disbursements', () => {
    const flow = computeCapitalFlow([], [], hoRequisitionsFixture);
    expect(flow.requisitionsDisbursed).toBe(100000);
    expect(flow.movedTotal).toBe(100000);
  });

  it('computeBillExposure uses estimate cap per WO when lower than WO value', () => {
    const projects = [
      { work_order_no: 'WO1', work_order_value: 1000000, approved_estimate_amount: 600000 },
      { work_order_no: 'WO2', work_order_value: 500000, approved_estimate_amount: 400000 }
    ];
    const healthMap = {
      WO1: { total_billed_amount: 400000 },
      WO2: { total_billed_amount: 100000 }
    };
    const exp = computeBillExposure(projects, healthMap);
    expect(exp.totalWoValue).toBe(1500000);
    expect(exp.totalGrossBilled).toBe(500000);
    expect(exp.remainingBillAmount).toBe(500000);
  });

  it('mergeProjectsWithHealth prefers health MV physical_progress', () => {
    const raw = [{ work_order_no: 'WO1', physical_progress: 10 }];
    const healthMap = { WO1: { physical_progress: 75 } };
    const estimateCountMap = { WO1: 2 };
    const merged = mergeProjectsWithHealth(raw, healthMap, estimateCountMap);
    expect(merged[0].physical_progress).toBe(75);
    expect(merged[0].estimates_count).toBe(2);
  });

  it('countPendingEstimates matches HO dashboard pending statuses', () => {
    const estimates = [
      { estimate_status: 'Under ZO Review' },
      { estimate_status: 'Final Approved' },
      { estimate_status: 'Submitted' }
    ];
    expect(countPendingEstimates(estimates)).toBe(2);
  });

  it('computeRequisitionStats sums approved amounts', () => {
    const pending = filterPendingRequisitions(hoRequisitionsFixture);
    const stats = computeRequisitionStats(hoRequisitionsFixture, pending);
    expect(stats.pendingCount).toBe(1);
    expect(stats.approvedSum).toBe(300000);
  });
});

describe('buildEstimateCountMap', () => {
  it('counts estimates per work order', () => {
    const map = buildEstimateCountMap([
      { work_order_no: 'WO1' },
      { work_order_no: 'WO1' },
      { work_order_no: 'WO2' }
    ]);
    expect(map.WO1).toBe(2);
    expect(map.WO2).toBe(1);
  });
});
