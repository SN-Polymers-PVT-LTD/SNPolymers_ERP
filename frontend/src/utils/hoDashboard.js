import { isWithinLastNDays } from './dateUtils';

export const PENDING_ESTIMATE_STATUSES = [
  'submitted',
  'under zo review',
  'zo revision requested',
  'zo approved',
  'under ho review',
  'ho revision requested',
  'estimate reopened'
];

export const countPendingEstimates = (estimates = []) =>
  estimates.filter(e => {
    const st = (e.estimate_status || '').toLowerCase().trim();
    return PENDING_ESTIMATE_STATUSES.includes(st);
  }).length;

export const filterPendingRequisitions = (requisitions = []) =>
  requisitions.filter(r => (r.requisition_status || r.status || '').toLowerCase() === 'pending');

export const computeRequisitionStats = (requisitions = [], pendingRequisitions = []) => {
  const approvedSum = requisitions
    .filter(r => (r.requisition_status || r.status || '').toLowerCase() === 'approved')
    .reduce((sum, r) => sum + Number(r.approved_amount || r.net_payable_amount || 0), 0);
  return { approvedSum, pendingCount: pendingRequisitions.length };
};

export const computeApprovalRate = (requisitions = []) => {
  if (!requisitions.length) return '0%';
  const appCount = requisitions.filter(
    r => (r.requisition_status || r.status || '').toLowerCase() === 'approved'
  ).length;
  return `${((appCount / requisitions.length) * 100).toFixed(1)}%`;
};

export const computeCapitalFlow = (fundRequests = [], pendingRequisitions = [], requisitions = []) => {
  const pendingFrAmt = fundRequests
    .filter(f => (f.request_status || f.status || '').toLowerCase() === 'pending')
    .reduce((sum, f) => sum + Number(f.zo_fr_amount || f.amount || f.request_amount || 0), 0);

  const pendingReqAmt = pendingRequisitions
    .reduce((sum, r) => sum + Number(r.requisition_amount || r.requested_amount || r.net_payable_amount || 0), 0);

  const inFlightTotal = pendingFrAmt + pendingReqAmt;

  const approvedFrAmt = fundRequests
    .filter(f => {
      const status = (f.request_status || f.status || '').toLowerCase();
      return status === 'approved' && isWithinLastNDays(f.approve_ho_date, 30);
    })
    .reduce((sum, f) => sum + Number(f.approve_ho_amount || f.zo_fr_amount || f.amount || 0), 0);

  const approvedReqAmt = requisitions
    .filter(r => {
      const status = (r.requisition_status || r.status || '').toLowerCase();
      return status === 'approved' && isWithinLastNDays(r.payment_date, 30);
    })
    .reduce((sum, r) => sum + Number(r.approved_amount || r.requisition_amount || r.net_payable_amount || 0), 0);

  const movedTotal = approvedFrAmt + approvedReqAmt;

  return {
    inFlightTotal,
    pendingFrAmt,
    pendingReqAmt,
    movedTotal,
    zonalDisbursals: approvedFrAmt,
    requisitionsDisbursed: approvedReqAmt
  };
};

export const computeBillExposure = (projects = [], healthMap = {}) => {
  const totalWoValue = projects.reduce((sum, p) => sum + Number(p.work_order_value || 0), 0);
  const totalGrossBilled = projects.reduce((sum, p) => {
    const billed = healthMap[p.work_order_no]?.total_billed_amount;
    return sum + Number(billed ?? 0);
  }, 0);
  const remainingBillAmount = Math.max(0, totalWoValue - totalGrossBilled);
  return { totalWoValue, totalGrossBilled, remainingBillAmount };
};

/** Active WO count — never fall back to projects.length when running is 0. */
export const getActiveWorkOrderCount = (overview = {}) => overview.running ?? 0;

export const mergeProjectsWithHealth = (rawProjects = [], healthMap = {}, estimateCountMap = {}) =>
  rawProjects.map(p => {
    const h = healthMap[p.work_order_no];
    const progVal = h?.physical_progress !== undefined && h?.physical_progress !== null
      ? h.physical_progress
      : h?.physical_work_progress;

    const prog = progVal !== undefined && progVal !== null
      ? Number(progVal)
      : Number(p.physical_progress || 0);

    return {
      ...p,
      physical_progress: prog,
      estimates_count: estimateCountMap[p.work_order_no] || 0
    };
  });

export const buildEstimateCountMap = (estimates = []) => {
  const map = {};
  estimates.forEach(e => {
    if (e.work_order_no) {
      map[e.work_order_no] = (map[e.work_order_no] || 0) + 1;
    }
  });
  return map;
};
