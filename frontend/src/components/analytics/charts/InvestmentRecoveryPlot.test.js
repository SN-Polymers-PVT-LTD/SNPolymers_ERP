// Golden Dataset regression test for Investment & Bill Recovery metrics
import assert from 'node:assert';

const goldenProjects = [
  {
    work_order_no: 'WO-001',
    site_details: 'Zone 1 Site Alpha',
    department: 'Civil',
    work_order_value: 10000000, // 1 Cr
    approved_requisitions_amount: 5000000, // 0.5 Cr (50% Inv)
    gross_billed: 4000000, // 0.4 Cr
    agency_payment: 3000000, // 0.3 Cr (Pending = 0.2 Cr)
    physical_progress: 45,
    health_status: 'Healthy',
  },
  {
    work_order_no: 'WO-002',
    site_details: 'Zone 1 Site Beta',
    department: 'Electrical',
    work_order_value: 20000000, // 2 Cr
    approved_requisitions_amount: 15000000, // 1.5 Cr (75% Inv)
    gross_billed: 18000000, // 1.8 Cr
    agency_payment: 16000000, // 1.6 Cr (Surplus = +0.1 Cr)
    physical_progress: 85,
    health_status: 'Healthy',
  },
  {
    work_order_no: 'WO-003',
    site_details: 'Zone 2 Site Gamma',
    department: 'Mechanical',
    work_order_value: 5000000, // 0.5 Cr
    approved_requisitions_amount: 5000000, // 0.5 Cr (100% Inv)
    gross_billed: 5000000, // 0.5 Cr
    agency_payment: 5000000, // 0.5 Cr
    physical_progress: 100,
    health_status: 'Healthy',
  },
  {
    work_order_no: 'WO-004',
    site_details: 'Zone 2 Site Delta',
    department: 'Civil',
    work_order_value: 15000000, // 1.5 Cr
    approved_requisitions_amount: 3000000, // 0.3 Cr (20% Inv)
    gross_billed: 2000000, // 0.2 Cr
    agency_payment: 1000000, // 0.1 Cr
    physical_progress: 15,
    health_status: 'Warning',
  },
  {
    work_order_no: 'WO-005',
    site_details: 'Zone 3 Site Epsilon',
    department: 'Plumbing',
    work_order_value: 8000000, // 0.8 Cr
    approved_requisitions_amount: 2000000, // 0.2 Cr
    gross_billed: 0,
    agency_payment: 0,
    physical_progress: 0,
    health_status: 'Critical',
  },
];

// Calculation function representing InvestmentRecoveryPlot's metric computation
function computeMetrics(projects) {
  const pList = projects || [];
  const totalProjectsCount = pList.length;
  const woValue = pList.reduce((a, p) => a + Number(p.work_order_value || 0), 0);
  const investment = pList.reduce(
    (a, p) => a + Number(p.approved_requisitions_amount || p.requisition_amount || p.approved_amount || 0),
    0
  );
  const grossBilled = pList.reduce((a, p) => a + Number(p.gross_billed || 0), 0);
  const billReceived = pList.reduce((a, p) => a + Number(p.agency_payment ?? p.agency_paid ?? 0), 0);

  const pendingRecovery = Math.max(0, investment - billReceived);
  const surplusRecovery = Math.max(0, billReceived - investment);
  const remainingWOValue = Math.max(0, woValue - investment);
  const deductions = Math.max(0, grossBilled - billReceived);

  const investmentPct = woValue > 0 ? ((investment / woValue) * 100).toFixed(1) : '0.0';
  const disbursementPct = woValue > 0 ? ((billReceived / woValue) * 100).toFixed(1) : '0.0';
  const recoveryAgainstInvestPct = investment > 0 ? ((billReceived / investment) * 100).toFixed(1) : '0.0';
  const deductionRate = grossBilled > 0 ? ((deductions / grossBilled) * 100).toFixed(1) : '0.0';

  return {
    totalProjectsCount,
    woValue,
    investment,
    grossBilled,
    billReceived,
    pendingRecovery,
    surplusRecovery,
    remainingWOValue,
    deductions,
    investmentPct,
    disbursementPct,
    recoveryAgainstInvestPct,
    deductionRate,
  };
}

console.log('--- Running Golden Dataset Metric Calculations Test ---');
const metrics = computeMetrics(goldenProjects);

// Assert totals
assert.strictEqual(metrics.totalProjectsCount, 5);
assert.strictEqual(metrics.woValue, 58000000); // 5.8 Cr
assert.strictEqual(metrics.investment, 30000000); // 3.0 Cr
assert.strictEqual(metrics.grossBilled, 29000000); // 2.9 Cr
assert.strictEqual(metrics.billReceived, 25000000); // 2.5 Cr

// Assert derived financial metrics
assert.strictEqual(metrics.pendingRecovery, 5000000); // 0.5 Cr pending
assert.strictEqual(metrics.surplusRecovery, 0); // Not surplus overall
assert.strictEqual(metrics.investmentPct, '51.7'); // (30M / 58M) * 100 = 51.72%
assert.strictEqual(metrics.disbursementPct, '43.1'); // (25M / 58M) * 100 = 43.10%
assert.strictEqual(metrics.recoveryAgainstInvestPct, '83.3'); // (25M / 30M) * 100 = 83.33%

console.log('✓ Golden Dataset Total Work Order Value: 5.8 Cr');
console.log('✓ Golden Dataset Approved Investment: 3.0 Cr (51.7%)');
console.log('✓ Golden Dataset Agency Realization: 2.5 Cr (83.3% of Investment)');
console.log('✓ Golden Dataset Pending Recovery: 0.5 Cr');
console.log('✓ All 5 Golden Dataset Assertions Passed Successfully!');

// Test empty state
console.log('--- Running Empty State Test ---');
const emptyMetrics = computeMetrics([]);
assert.strictEqual(emptyMetrics.investmentPct, '0.0');
assert.strictEqual(emptyMetrics.disbursementPct, '0.0');
assert.strictEqual(emptyMetrics.recoveryAgainstInvestPct, '0.0');
console.log('✓ Empty State (projects=[]) Assertions Passed Successfully!');
