import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { getMe } = require('../../../src/controllers/auth.controller');
const { getProjectsHealth } = require('../../../src/controllers/analytics.controller');
const { getZonalBalances } = require('../../../src/controllers/zoBalances.controller');
const { getRequisitions } = require('../../../src/controllers/requisitions.controller');
const { getFundRequests, createFundRequest } = require('../../../src/controllers/fundRequests.controller');
const {
  loginTestUser,
  deleteAuthTestUser,
  runVerifyJwt
} = require('../../helpers/authFlow');
const {
  seedFinancialScenario,
  insertRequisitionDirect,
  cleanupFinancialScenario
} = require('../../helpers/financialFixture');
const {
  seedDashboardProject,
  refreshAnalyticsViews,
  cleanupDashboardProject
} = require('../../helpers/seedDashboardProject');
const { seedRbacUsers, cleanupRbacUsers, userForRole } = require('../../helpers/rbacUsers');
const setupUsers = require('../../helpers/setupUsers');
const mockRes = require('../../helpers/mockRes');
const {
  authMeSerializationSchema,
  projectsHealthResponseSerializationSchema,
  zoBalancesResponseSerializationSchema,
  requisitionsListResponseSerializationSchema,
  fundRequestsListResponseSerializationSchema,
  assertSerialization
} = require('../../helpers/serializationSchemas');

describe('apiSerialization — primitive JSON types on high-value endpoints', () => {
  describe('GET /auth/me', () => {
    let session;

    afterAll(async () => {
      if (session) {
        await deleteAuthTestUser(session.mobile.canonical);
      }
    });

    test('user.permissions is an object and success is boolean', async () => {
      session = await loginTestUser({ displayName: 'Serialization me user', role: 'je' });
      const req = { cookies: session.cookies, headers: {} };
      const res = mockRes();

      await runVerifyJwt(req, res);
      await getMe(req, res);

      expect(res.statusCode).toBe(200);
      assertSerialization(authMeSerializationSchema, res.jsonData, 'GET /auth/me');
      expect(typeof res.jsonData.user.permissions).toBe('object');
      expect(res.jsonData.user.permissions).not.toBeNull();
    });
  });

  describe('GET /analytics/projects', () => {
    let suffix;
    let adminMobile;
    let zoMobile;
    let je1Mobile;
    let workOrderNo;

    beforeAll(async () => {
      suffix = crypto.randomUUID().substring(0, 8);
      adminMobile = `96A1${suffix}`;
      zoMobile = `96Z1${suffix}`;
      je1Mobile = `96J1${suffix}`;
      workOrderNo = `WO-SER-${suffix}`;

      await setupUsers([
        { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Ser Admin ${suffix}` },
        { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `Ser ZO ${suffix}` },
        { mobile_number: je1Mobile, role: 'je', is_active: true, display_name: `Ser JE ${suffix}` }
      ]);

      await seedDashboardProject({
        workOrderNo,
        zoMobile,
        jeMobiles: [je1Mobile],
        adminMobile,
        department: 'Roads',
        suffix
      });
      await refreshAnalyticsViews();
    }, 60000);

    afterAll(async () => {
      await cleanupDashboardProject({
        workOrderNo,
        userMobiles: [adminMobile, zoMobile, je1Mobile],
        jeMobiles: [je1Mobile]
      });
    }, 60000);

    test('project health rows expose numeric progress and value fields', async () => {
      const req = { user: { role: 'ho', mobile_number: adminMobile } };
      const res = mockRes();
      await getProjectsHealth(req, res);

      expect(res.statusCode).toBe(200);
      assertSerialization(projectsHealthResponseSerializationSchema, res.jsonData, 'GET /analytics/projects');

      const row = res.jsonData.data.find((p) => p.work_order_no === workOrderNo);
      expect(row).toBeDefined();
      expect(Array.isArray(row.assigned_jes)).toBe(true);
      expect(typeof row.physical_progress).toBe('number');
      expect(typeof row.work_order_value).toBe('number');
    });

    test('JE with no mappings returns data as empty array', async () => {
      const orphanJe = `96J9${suffix}`;
      await setupUsers([
        { mobile_number: orphanJe, role: 'je', is_active: true, display_name: `Orphan JE ${suffix}` }
      ]);

      const req = { user: { role: 'je', mobile_number: orphanJe } };
      const res = mockRes();
      await getProjectsHealth(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.data).toEqual([]);
      assertSerialization(projectsHealthResponseSerializationSchema, res.jsonData, 'GET /analytics/projects (empty JE)');
    });
  });

  describe('GET /zo-balances', () => {
    let finCtx;
    let rbacCtx;

    beforeAll(async () => {
      finCtx = await seedFinancialScenario();
      rbacCtx = await seedRbacUsers();
    });

    afterAll(async () => {
      await cleanupFinancialScenario(finCtx);
      await cleanupRbacUsers(rbacCtx);
    });

    test('ZO caller receives numeric available_balance', async () => {
      const req = { user: { role: 'zo', mobile_number: finCtx.zoMobile }, query: {} };
      const res = mockRes();
      await getZonalBalances(req, res);

      expect(res.statusCode).toBe(200);
      assertSerialization(zoBalancesResponseSerializationSchema, res.jsonData, 'GET /zo-balances (ZO)');
      expect(res.jsonData.balances.length).toBeGreaterThan(0);
      expect(typeof res.jsonData.balances[0].available_balance).toBe('number');
    });

    test('HO caller always receives balances as an array (never null)', async () => {
      const req = { user: userForRole(rbacCtx, 'ho'), query: {} };
      const res = mockRes();
      await getZonalBalances(req, res);

      expect(res.statusCode).toBe(200);
      expect(Array.isArray(res.jsonData.balances)).toBe(true);
      expect(res.jsonData.balances).not.toBeNull();
      assertSerialization(zoBalancesResponseSerializationSchema, res.jsonData, 'GET /zo-balances (HO)');
    });
  });

  describe('GET /requisitions', () => {
    let ctx;

    beforeAll(async () => {
      ctx = await seedFinancialScenario();
      await insertRequisitionDirect(ctx, {
        requisition_no: `REQ_SER_${ctx.suffix}`,
        requisition_amount: 2500.75,
        approved_amount: null
      });
    });

    afterAll(async () => {
      await cleanupFinancialScenario(ctx);
    });

    test('list items expose numeric amounts and pagination totals', async () => {
      const req = { user: { role: 'je', mobile_number: ctx.jeMobile }, query: {} };
      const res = mockRes();
      await getRequisitions(req, res);

      expect(res.statusCode).toBe(200);
      assertSerialization(requisitionsListResponseSerializationSchema, res.jsonData, 'GET /requisitions');
      expect(res.jsonData.requisitions.length).toBeGreaterThan(0);
      expect(typeof res.jsonData.requisitions[0].requisition_amount).toBe('number');
      expect(typeof res.jsonData.pagination.total).toBe('number');
    });
  });

  describe('GET /fund-requests', () => {
    let ctx;

    beforeAll(async () => {
      ctx = await seedFinancialScenario();
      const createRes = mockRes();
      await createFundRequest(
        {
          user: { role: 'zo', mobile_number: ctx.zoMobile },
          body: {
            zo_fr_no: `FR_SER_${ctx.suffix}`,
            work_order_no: ctx.workOrder,
            zo_fr_amount: 3500.5,
            zo_remarks: 'Serialization contract test'
          }
        },
        createRes
      );
      expect(createRes.statusCode).toBe(201);
      ctx.fundRequestIds.push(createRes.jsonData.fundRequest.fund_request_id);
    });

    afterAll(async () => {
      await cleanupFinancialScenario(ctx);
    });

    test('list items expose numeric zo_fr_amount', async () => {
      const req = { user: { role: 'zo', mobile_number: ctx.zoMobile }, query: {} };
      const res = mockRes();
      await getFundRequests(req, res);

      expect(res.statusCode).toBe(200);
      assertSerialization(fundRequestsListResponseSerializationSchema, res.jsonData, 'GET /fund-requests');
      expect(res.jsonData.fundRequests.length).toBeGreaterThan(0);
      expect(typeof res.jsonData.fundRequests[0].zo_fr_amount).toBe('number');
    });
  });

  describe('negative guards — schemas reject type drift', () => {
    test('rejects string money amounts', () => {
      expect(() => assertSerialization(
        requisitionsListResponseSerializationSchema,
        {
          success: true,
          requisitions: [{
            requisition_amount: '1200.50',
            created_at: '2026-01-01T00:00:00.000Z',
            requisition_status: 'Pending'
          }],
          pagination: { page: 1, limit: 50, total: 1, totalPages: 1 }
        },
        'bad requisition amount'
      )).toThrow();
    });

    test('rejects null collections and string booleans', () => {
      expect(() => assertSerialization(
        projectsHealthResponseSerializationSchema,
        { success: true, data: null },
        'null data array'
      )).toThrow();

      expect(() => assertSerialization(
        authMeSerializationSchema,
        {
          success: true,
          user: {
            id: '00000000-0000-4000-8000-000000000001',
            mobile_number: '910000000001',
            role: 'je',
            permissions: 'true'
          }
        },
        'string permissions'
      )).toThrow();
    });
  });
});
