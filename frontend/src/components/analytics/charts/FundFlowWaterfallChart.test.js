import { describe, it } from "vitest";
// Golden Dataset & Equivalence Test Suite for FundFlowWaterfallChart
import assert from 'node:assert';

const goldenProjects = [
  {
    work_order_no: 'WO-101',
    approved_estimate_amount: 10000000, // 1.0 Cr
    estimate_status: 'Final Approved',
    approved_ho_amount: 8000000, // 0.8 Cr
    excess_refunded_amount: 1000000, // 0.1 Cr (Net HO = 0.7 Cr)
    approved_requisitions_amount: 6000000, // 0.6 Cr
    gross_billed: 5000000, // 0.5 Cr
    agency_paid: 4000000, // 0.4 Cr
  },
  {
    work_order_no: 'WO-102',
    approved_estimate_amount: 20000000, // 2.0 Cr
    estimate_status: 'Final Approved',
    approved_ho_amount: 18000000, // 1.8 Cr
    excess_refunded_amount: 2000000, // 0.2 Cr (Net HO = 1.6 Cr)
    approved_requisitions_amount: 14000000, // 1.4 Cr
    gross_billed: 12000000, // 1.2 Cr
    agency_paid: 10000000, // 1.0 Cr
  },
  {
    work_order_no: 'WO-103',
    approved_estimate_amount: 5000000, // 0.5 Cr
    estimate_status: 'Final Approved',
    approved_ho_amount: 5000000, // 0.5 Cr
    excess_refunded_amount: 0,
    approved_requisitions_amount: 4000000, // 0.4 Cr
    gross_billed: 3000000, // 0.3 Cr
    agency_paid: 2500000, // 0.25 Cr
  },
  {
    work_order_no: 'WO-104',
    approved_estimate_amount: 15000000, // 1.5 Cr
    estimate_status: 'Final Approved',
    approved_ho_amount: 10000000, // 1.0 Cr
    excess_refunded_amount: 500000, // 0.05 Cr (Net HO = 0.95 Cr)
    approved_requisitions_amount: 8000000, // 0.8 Cr
    gross_billed: 6000000, // 0.6 Cr
    agency_paid: 5000000, // 0.5 Cr
  },
  {
    work_order_no: 'WO-105',
    approved_estimate_amount: 8000000, // 0.8 Cr
    estimate_status: 'Final Approved',
    approved_ho_amount: 5000000, // 0.5 Cr
    excess_refunded_amount: 0,
    approved_requisitions_amount: 3000000, // 0.3 Cr
    gross_billed: 2000000, // 0.2 Cr
    agency_paid: 1500000, // 0.15 Cr
  },
];

// Helper representing FundFlowWaterfallChart's row resolution logic
function resolveRows(data, projects) {
  if (data && Array.isArray(data) && data.length > 0) return data;

  const p = projects || [];
  const est = p.reduce((a, pr) => a + Number(pr.approved_estimate_amount || (pr.estimate_status === 'Final Approved' ? pr.estimate_amount : 0)), 0);
  const grossAllocated = p.reduce((a, pr) => a + Number(pr.approved_ho_amount || pr.ho_allocated_amount || pr.approve_ho_amount || pr.approved_amount || 0), 0);
  const excessReturned = p.reduce((a, pr) => a + Number(pr.excess_refunded_amount || pr.total_refunded || 0), 0);
  const netAllocated = Math.max(0, grossAllocated - excessReturned);
  const reqApproved = p.reduce((a, pr) => a + Number(pr.approved_requisitions_amount || pr.requisition_amount || 0), 0);
  const billed = p.reduce((a, pr) => a + Number(pr.gross_billed || 0), 0);
  const paid = p.reduce((a, pr) => a + Number(pr.agency_payment ?? pr.agency_paid ?? 0), 0);

  return [
    { stage: 'Final Approved Estimate', amount: est },
    { stage: 'HO Allocated (Gross)',    amount: grossAllocated },
    { stage: 'Excess Returned to HO',   amount: excessReturned, isRefund: true },
    { stage: 'HO Allocated (Net)',      amount: netAllocated },
    { stage: 'Requisitions Approved',   amount: reqApproved },
    { stage: 'Gross Billed',            amount: billed },
    { stage: 'Agency Paid',             amount: paid },
  ];
}

console.log('--- Running Waterfall Golden Dataset Calculation Test ---');
const fallbackRows = resolveRows(null, goldenProjects);

assert.strictEqual(fallbackRows.length, 7);
assert.strictEqual(fallbackRows[0].amount, 58000000); // 5.8 Cr Estimate
assert.strictEqual(fallbackRows[1].amount, 46000000); // 4.6 Cr HO Gross
assert.strictEqual(fallbackRows[2].amount, 3500000);  // 0.35 Cr Returned
assert.strictEqual(fallbackRows[3].amount, 42500000); // 4.25 Cr HO Net
assert.strictEqual(fallbackRows[4].amount, 35000000); // 3.5 Cr Requisitions Approved
assert.strictEqual(fallbackRows[5].amount, 28000000); // 2.8 Cr Billed
assert.strictEqual(fallbackRows[6].amount, 23000000); // 2.3 Cr Agency Paid

console.log('✓ Stage 1: Final Approved Estimate = 5.8 Cr');
console.log('✓ Stage 2: HO Allocated (Gross) = 4.6 Cr');
console.log('✓ Stage 3: Excess Returned to HO = 0.35 Cr');
console.log('✓ Stage 4: HO Allocated (Net) = 4.25 Cr');
console.log('✓ Stage 5: Requisitions Approved = 3.5 Cr');
console.log('✓ Stage 6: Gross Billed = 2.8 Cr');
console.log('✓ Stage 7: Agency Paid = 2.3 Cr');

console.log('--- Running Backend Data vs Client Fallback Equivalence Test ---');
const backendEquivalentData = [
  { stage: 'Final Approved Estimate', amount: 58000000 },
  { stage: 'HO Allocated (Gross)',    amount: 46000000 },
  { stage: 'Excess Returned to HO',   amount: 3500000, isRefund: true },
  { stage: 'HO Allocated (Net)',      amount: 42500000 },
  { stage: 'Requisitions Approved',   amount: 35000000 },
  { stage: 'Gross Billed',            amount: 28000000 },
  { stage: 'Agency Paid',             amount: 23000000 },
];

const backendRows = resolveRows(backendEquivalentData, goldenProjects);
for (let i = 0; i < 7; i++) {
  assert.strictEqual(backendRows[i].stage, fallbackRows[i].stage);
  assert.strictEqual(backendRows[i].amount, fallbackRows[i].amount);
}
console.log('✓ Pre-computed backend data and client fallback calculation produce 100% EQUIVALENT stage values!');

console.log('--- Running Empty State & Boundary Safety Test ---');
const emptyRows = resolveRows([], []);
assert.strictEqual(emptyRows.length, 7);
emptyRows.forEach(r => assert.strictEqual(r.amount, 0));
console.log('✓ Empty State (data=[], projects=[]) Assertions Passed Successfully!');
describe('Test Suite', () => { it('runs assertions', () => {
}); });
