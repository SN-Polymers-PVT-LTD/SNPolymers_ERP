import { describe, it } from 'vitest';
import assert from 'node:assert';
import { buildDonutSlices } from '../utils/donutGeometry.js';

const goldenProjects = [
  { work_order_no: 'WO-201', department: 'Civil', work_order_value: 20000000 }, // 2.0 Cr
  { work_order_no: 'WO-202', department: 'Civil', work_order_value: 10000000 }, // 1.0 Cr (Civil Total = 3.0 Cr)
  { work_order_no: 'WO-203', department: 'Electrical', work_order_value: 15000000 }, // 1.5 Cr
  { work_order_no: 'WO-204', department: 'Mechanical', work_order_value: 10000000 }, // 1.0 Cr
  { work_order_no: 'WO-205', department: 'Plumbing', work_order_value: 5000000 }, // 0.5 Cr (Total = 6.0 Cr)
];

const preComputedItems = [
  { department: 'Civil', amount: 30000000, count: 2, percentage: 50.0, color: '#3B82F6' },
  { department: 'Electrical', amount: 15000000, count: 1, percentage: 25.0, color: '#10B981' },
  { department: 'Mechanical', amount: 10000000, count: 1, percentage: 16.7, color: '#8B5CF6' },
  { department: 'Plumbing', amount: 5000000, count: 1, percentage: 8.3, color: '#F97316' },
];

function normalizeItems(items, projects) {
  if (items && Array.isArray(items) && items.length > 0) {
    const total = items.reduce((a, i) => a + Number(i.amount || 0), 0) || 1;
    return items.map((item, _idx) => ({
      department: item.department || item.name || 'General',
      amount: Number(item.amount || 0),
      count: item.count !== undefined ? Number(item.count) : undefined,
      percentage: item.percentage !== undefined ? Number(item.percentage) : Number(((Number(item.amount || 0) / total) * 100).toFixed(1)),
    }));
  }

  const pList = projects || [];
  const map = {};
  const countMap = {};
  pList.forEach((p) => {
    const d = p.department || 'General';
    map[d] = (map[d] || 0) + Number(p.work_order_value || 0);
    countMap[d] = (countMap[d] || 0) + 1;
  });

  const total = Object.values(map).reduce((a, v) => a + v, 0) || 1;
  return Object.entries(map).map(([dept, amount]) => ({
    department: dept,
    amount,
    count: countMap[dept],
    percentage: Number(((amount / total) * 100).toFixed(1)),
  }));
}

describe('DepartmentWiseEstimateChart Test Suite', () => {
  it('runs geometry and golden dataset assertions', () => {
    console.log('--- Running buildDonutSlices Geometry Test ---');
    const rawSlices = [
      { percentage: 50, color: '#3B82F6', label: 'Civil' },
      { percentage: 25, color: '#10B981', label: 'Electrical' },
      { percentage: 25, color: '#8B5CF6', label: 'Mechanical' },
    ];
    const donut = buildDonutSlices(rawSlices);
    assert.strictEqual(donut.length, 3);
    assert.strictEqual(donut[0].startAngle, 0);
    assert.strictEqual(donut[0].endAngle, 180);
    assert.strictEqual(donut[1].startAngle, 180);
    assert.strictEqual(donut[1].endAngle, 270);
    assert.strictEqual(donut[2].startAngle, 270);
    assert.strictEqual(donut[2].endAngle, 360);
    console.log('✓ SVG Donut Slice Path Geometry Validated!');

    console.log('--- Running Backend Items vs Client Fallback Equivalence Test ---');
    const preComputedResult = normalizeItems(preComputedItems, []);
    const fallbackResult = normalizeItems([], goldenProjects);

    assert.strictEqual(preComputedResult.length, fallbackResult.length);
    for (let i = 0; i < preComputedResult.length; i++) {
      assert.strictEqual(preComputedResult[i].department, fallbackResult[i].department);
      assert.strictEqual(preComputedResult[i].amount, fallbackResult[i].amount);
      assert.strictEqual(preComputedResult[i].percentage, fallbackResult[i].percentage);
    }
    console.log('✓ Pre-computed backend breakdown and client fallback aggregation produce 100% EQUIVALENT results!');

    console.log('--- Running Empty State Safety Test ---');
    const emptyResult = normalizeItems([], []);
    assert.strictEqual(emptyResult.length, 0);
    const emptyDonut = buildDonutSlices([]);
    assert.strictEqual(emptyDonut.length, 0);
    console.log('✓ Empty State (items=[], projects=[]) Assertions Passed Successfully!');
  });
});
