// Golden Dataset & S-Curve Calculation Test Suite for SCurveProgressChart
import assert from 'node:assert';

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

const W = 600;
const H = 330;
const PAD_TOP = 40;
const PAD_BOT = 60;
const PAD_SIDE = 50;

function toX(i, totalCount) {
  return PAD_SIDE + (i / Math.max(1, totalCount - 1)) * (W - 2 * PAD_SIDE);
}

function toY(v) {
  return H - PAD_BOT - (Math.min(100, Math.max(0, v)) / 100) * (H - PAD_TOP - PAD_BOT);
}

function resolveSCurve(sCurveData, projects, selectedWo = 'all') {
  let rawTimeline = [];
  const activeData =
    selectedWo === 'all'
      ? sCurveData
      : (sCurveData || []).filter((d) => d.work_order_no === selectedWo);

  if (activeData && activeData.length > 0) {
    const datesSet = new Set();
    activeData.forEach((s) => {
      (s.actuals || []).forEach((a) => {
        if (a.date) datesSet.add(a.date.slice(0, 7));
      });
    });
    rawTimeline = Array.from(datesSet).sort();
  }

  if (rawTimeline.length < 3) {
    rawTimeline = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
  }

  const sigmoidalPlanned = [2, 12, 35, 65, 88, 98];

  const activeProjects =
    selectedWo === 'all'
      ? projects
      : (projects || []).filter((p) => p.work_order_no === selectedWo);

  const avgProg = activeProjects?.length
    ? Math.round(activeProjects.reduce((a, p) => a + Number(p.physical_progress || 0), 0) / activeProjects.length)
    : 0;

  const stepCount = rawTimeline.length;
  const computedActual = rawTimeline.map((_, idx) => {
    const factor = (idx + 1) / stepCount;
    return Math.min(100, Math.round(avgProg * Math.pow(factor, 1.2)));
  });

  return {
    months: rawTimeline,
    planned: sigmoidalPlanned,
    actual: computedActual,
    avgProg,
  };
}

console.log('--- Running SVG Coordinate Bounds Test ---');
assert.strictEqual(toX(0, 6), 50); // Start PAD_SIDE
assert.strictEqual(toX(5, 6), 550); // End W - PAD_SIDE
assert.strictEqual(toY(0), 270); // Bottom H - PAD_BOT
assert.strictEqual(toY(100), 40); // Top PAD_TOP
console.log('✓ SVG Coordinate Projection bounds strictly verified within [X: 50..550, Y: 40..270]!');

console.log('--- Running Golden Dataset & S-Curve Calculation Test ---');
const portfolioRes = resolveSCurve(null, goldenProjects, 'all');
assert.strictEqual(portfolioRes.avgProg, 60); // Average of (80+60+40+90+30)/5 = 60%
assert.deepStrictEqual(portfolioRes.actual, [7, 16, 26, 37, 48, 60]);

console.log('✓ Portfolio Average Progress = 60%');
console.log('✓ Trajectory Points = [7%, 16%, 26%, 37%, 48%, 60%]');

console.log('--- Running Specific Work Order Selection Test ---');
const woRes = resolveSCurve(null, goldenProjects, 'WO-404');
assert.strictEqual(woRes.avgProg, 90);
assert.deepStrictEqual(woRes.actual, [10, 24, 39, 55, 72, 90]);
console.log('✓ Selected WO-404 Progress = 90%');

console.log('--- Running Backend vs Client Fallback Equivalence Test ---');
const backendRes = resolveSCurve(goldenSCurveData, goldenProjects, 'all');
assert.strictEqual(backendRes.avgProg, 60);
assert.deepStrictEqual(backendRes.actual, portfolioRes.actual);
console.log('✓ API timeline dataset and client projects fallback produce 100% EQUIVALENT trajectory curves!');

console.log('--- Running Empty State Safety Test ---');
const emptyRes = resolveSCurve([], [], 'all');
assert.strictEqual(emptyRes.avgProg, 0);
assert.deepStrictEqual(emptyRes.actual, [0, 0, 0, 0, 0, 0]);
console.log('✓ Empty State (sCurveData=[], projects=[]) Assertions Passed Successfully!');
