import { describe, it } from 'vitest';
import assert from 'node:assert';
import { computeSCurveSeries, _scurveTestUtils } from '../utils/scurveSeries';

const { plannedPctAtElapsed, isValidProjectWindow, buildPlannedSeries, SIGMOIDAL_PLANNED } = _scurveTestUtils;

const goldenProjects = [
  { work_order_no: 'WO-401', physical_progress: 80 },
  { work_order_no: 'WO-402', physical_progress: 60 },
  { work_order_no: 'WO-403', physical_progress: 40 },
  { work_order_no: 'WO-404', physical_progress: 90 },
  { work_order_no: 'WO-405', physical_progress: 30 },
];

const goldenSCurveData = [
  {
    work_order_no: 'WO-401',
    project_start_date: '2026-01-01',
    project_end_date: '2026-06-30',
    actuals: [
      { date: '2026-01-01', progress: 10 },
      { date: '2026-02-01', progress: 25 },
      { date: '2026-03-01', progress: 45 },
      { date: '2026-04-01', progress: 65 },
      { date: '2026-05-01', progress: 75 },
      { date: '2026-06-01', progress: 80 },
    ],
  },
];

console.log('--- Running sigmoid planned curve math ---');
assert.ok(plannedPctAtElapsed(0) < plannedPctAtElapsed(0.5));
assert.ok(plannedPctAtElapsed(0.5) < plannedPctAtElapsed(1));
assert.ok(plannedPctAtElapsed(1) >= 90);
assert.strictEqual(isValidProjectWindow('2026-01-01', '2026-06-30'), true);
assert.strictEqual(isValidProjectWindow('2026-06-30', '2026-01-01'), false);
console.log('✓ Contract sigmoid rises monotonically toward completion');

console.log('--- Running sparse-history projected trend fallback ---');
const portfolioRes = computeSCurveSeries([], goldenProjects, 'all');
assert.strictEqual(portfolioRes.avgProg, 60);
assert.strictEqual(portfolioRes.isProjectedTrend, true);
assert.strictEqual(portfolioRes.isDefaultPlannedCurve, true);
assert.strictEqual(portfolioRes.dprPointCount, 0);
assert.deepStrictEqual(portfolioRes.actual, [7, 16, 26, 37, 48, 60]);
assert.deepStrictEqual(portfolioRes.planned, SIGMOIDAL_PLANNED);
console.log('✓ Sparse portfolio history uses projected actual and default planned curve');

const sparseRes = computeSCurveSeries(
  [{ work_order_no: 'WO-401', actuals: [{ date: '2026-01-01', progress: 12 }, { date: '2026-02-01', progress: 20 }] }],
  goldenProjects,
  'WO-401'
);
assert.strictEqual(sparseRes.isProjectedTrend, true);
assert.strictEqual(sparseRes.isDefaultPlannedCurve, true);
assert.strictEqual(sparseRes.dprPointCount, 2);
console.log('✓ Fewer than 3 DPR points keeps projected trend flag');

console.log('--- Running real DPR history with contract planned line ---');
const woRes = computeSCurveSeries(goldenSCurveData, goldenProjects, 'WO-401');
assert.strictEqual(woRes.isProjectedTrend, false);
assert.strictEqual(woRes.isDefaultPlannedCurve, false);
assert.strictEqual(woRes.plannedSource, 'contract_dates');
assert.deepStrictEqual(woRes.actual, [10, 25, 45, 65, 75, 80]);
assert.strictEqual(woRes.months.length, 6);
assert.strictEqual(woRes.planned.length, 6);
assert.ok(woRes.planned.every((v, i, arr) => i === 0 || v >= arr[i - 1]));
console.log('✓ WO-401 plots reported progress and contract-derived planned curve');

const plannedMeta = buildPlannedSeries(
  ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
  goldenSCurveData,
  goldenProjects,
  'WO-401'
);
assert.strictEqual(plannedMeta.isDefaultPlannedCurve, false);
assert.strictEqual(plannedMeta.planned.length, 6);
console.log('✓ Planned series aligns month-for-month with actual timeline');

console.log('--- Running portfolio partial schedule coverage ---');
const mixedProjects = [
  { work_order_no: 'WO-A', project_start_date: '2026-01-01', project_end_date: '2026-06-30', physical_progress: 50 },
  { work_order_no: 'WO-B', physical_progress: 40 },
];
const mixedCurve = [
  {
    work_order_no: 'WO-A',
    project_start_date: '2026-01-01',
    project_end_date: '2026-06-30',
    actuals: [
      { date: '2026-01-15', progress: 10 },
      { date: '2026-02-15', progress: 20 },
      { date: '2026-03-15', progress: 35 },
    ],
  },
];
const mixedRes = computeSCurveSeries(mixedCurve, mixedProjects, 'all');
assert.strictEqual(mixedRes.partialScheduleCoverage, true);
assert.strictEqual(mixedRes.datedProjectCount, 1);
assert.strictEqual(mixedRes.totalProjectCount, 2);
console.log('✓ Portfolio partial schedule coverage is surfaced');

console.log('--- Running empty state detection ---');
const emptyRes = computeSCurveSeries([], [], 'all');
assert.strictEqual(emptyRes.avgProg, 0);
assert.strictEqual(emptyRes.isProjectedTrend, true);
assert.strictEqual(emptyRes.isDefaultPlannedCurve, true);
assert.deepStrictEqual(emptyRes.actual, [0, 0, 0, 0, 0, 0]);
console.log('✓ Empty state triggers zero projected trend');

describe('SCurveProgressChart', () => {
  it('runs s-curve series assertions', () => {});
});
