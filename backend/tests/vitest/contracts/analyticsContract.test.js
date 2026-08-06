import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const {
  getHoChartData,
  getHoActionableInsights,
  getProjectsHealth
} = require('../../../src/controllers/analytics.controller');
const { seedRbacUsers, cleanupRbacUsers, userForRole } = require('../../helpers/rbacUsers');
const mockRes = require('../../helpers/mockRes');
const {
  hoChartDataSerializationSchema,
  hoActionableInsightsSerializationSchema,
  projectsHealthResponseSerializationSchema,
  assertSerialization
} = require('../../helpers/serializationSchemas');

describe('analyticsContract — stable analytics envelope', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedRbacUsers();
  });

  afterAll(async () => {
    await cleanupRbacUsers(ctx);
  });

  test('chart.empty_db_keys — HO chart-data returns six core array datasets', async () => {
    const req = { user: userForRole(ctx, 'ho'), query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    const keys = ['bubbleMatrix', 'waterfallData', 'zonalHeatmap', 'runwayTrend', 'sCurveData', 'revisionHeatmap'];
    keys.forEach((key) => {
      expect(Array.isArray(res.jsonData[key])).toBe(true);
    });
  });

  test('chart.extended_keys — extended analytics fields are present', async () => {
    const req = { user: userForRole(ctx, 'ho'), query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toHaveProperty('departmentWiseEstimate');
    expect(res.jsonData).toHaveProperty('physicalProgressMetrics');
    expect(res.jsonData).toHaveProperty('jeVisitFrequencyMetrics');
    expect(res.jsonData).toHaveProperty('executiveSummaryKpis');
    expect(res.jsonData).toHaveProperty('projectsList');
    assertSerialization(hoChartDataSerializationSchema, res.jsonData, 'GET /analytics/ho/chart-data');
  });

  test('chart.kpi_amounts_numeric — executiveSummaryKpis amounts are finite numbers', async () => {
    const req = { user: userForRole(ctx, 'ho'), query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    const kpis = res.jsonData.executiveSummaryKpis;
    expect(typeof kpis.totalWOValue).toBe('number');
    expect(Number.isFinite(kpis.totalWOValue)).toBe(true);
    expect(typeof kpis.zoAvailableBalance).toBe('number');
    expect(Number.isFinite(kpis.zoAvailableBalance)).toBe(true);
  });

  test('chart.waterfall_nonneg — waterfall stages use non-negative numeric amounts', async () => {
    const req = { user: userForRole(ctx, 'ho'), query: {} };
    const res = mockRes();
    await getHoChartData(req, res);

    res.jsonData.waterfallData.forEach((stage) => {
      expect(typeof stage.amount).toBe('number');
      expect(stage.amount).toBeGreaterThanOrEqual(0);
    });
  });

  test('projects.empty_je — JE without mappings gets empty data array', async () => {
    const req = { user: userForRole(ctx, 'je'), query: {} };
    const res = mockRes();
    await getProjectsHealth(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData).toEqual({ success: true, data: [] });
    assertSerialization(projectsHealthResponseSerializationSchema, res.jsonData, 'GET /analytics/projects (empty JE)');
  });

  test('insights.empty_arrays — actionable insights arrays are always present', async () => {
    const req = { user: userForRole(ctx, 'ho'), query: {} };
    const res = mockRes();
    await getHoActionableInsights(req, res);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.jsonData.runwayData)).toBe(true);
    expect(Array.isArray(res.jsonData.stalledProjects)).toBe(true);
    expect(Array.isArray(res.jsonData.highRevisionProjects)).toBe(true);
    assertSerialization(hoActionableInsightsSerializationSchema, res.jsonData, 'GET /analytics/ho/actionable-insights');
  });
});
