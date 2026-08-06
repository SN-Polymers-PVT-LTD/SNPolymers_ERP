import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const { FROZEN_ISO, withFrozenTime } = require('../../helpers/freezeTime');
const {
  seedFinancialScenario,
  seedDraftEstimate,
  insertRequisitionViaRpc,
  getZoBalance,
  countLedgerRows,
  cleanupFinancialScenario
} = require('../../helpers/financialFixture');
const {
  loginTestUser,
  deleteAuthTestUser,
  mockResWithCookies
} = require('../../helpers/authFlow');
const { refreshTokens } = require('../../../src/controllers/auth.controller');
const { actOnRequisition } = require('../../../src/controllers/requisitions.controller');
const {
  createFundRequest,
  actOnFundRequest
} = require('../../../src/controllers/fundRequests.controller');
const { submitEstimate } = require('../../../src/controllers/estimates.workflow.controller');
const { supabase } = require('../../../src/db/supabase');

describe('idempotency — retries must not duplicate money or session side effects', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedFinancialScenario();
  });

  afterAll(async () => {
    await cleanupFinancialScenario(ctx);
  });

  test('retrying requisition approve does not double-debit ZO balance or ledger', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({ suffix: `idem1_${localSuffix}` });

    try {
      const req = await insertRequisitionViaRpc(localCtx, {
        requisition_no: `REQ_IDEM_${localSuffix}`,
        requisition_amount: 2500
      });

      const actionReq = {
        params: { id: req.requisition_id },
        user: { role: 'ho', mobile_number: localCtx.hoMobile },
        body: {
          action: 'Approve',
          approved_amount: 2500,
          remarks_approved_authority: 'First approve'
        }
      };

      const firstRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnRequisition(actionReq, firstRes);
      });
      expect(firstRes.statusCode).toBe(200);

      const balanceAfterFirst = await getZoBalance(localCtx.zoMobile);
      const ledgerCountAfterFirst = await countLedgerRows({
        zoMobile: localCtx.zoMobile,
        referenceId: req.requisition_id
      });

      const retryRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnRequisition(actionReq, retryRes);
      });

      // RPC returns STA01 today — controller may respond 500; DB must stay unchanged.
      expect(retryRes.statusCode).not.toBe(200);

      const balanceAfterRetry = await getZoBalance(localCtx.zoMobile);
      const ledgerCountAfterRetry = await countLedgerRows({
        zoMobile: localCtx.zoMobile,
        referenceId: req.requisition_id
      });

      expect(balanceAfterRetry).toBe(balanceAfterFirst);
      expect(ledgerCountAfterRetry).toBe(ledgerCountAfterFirst);

      const { data: row } = await supabase
        .from('requisitions')
        .select('requisition_status')
        .eq('requisition_id', req.requisition_id)
        .single();
      expect(row.requisition_status).toBe('Approved');
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('retrying fund request approve does not double-credit ZO balance or ledger', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `idem2_${localSuffix}`,
      estimateAmount: 100000
    });

    try {
      const createRes = mockRes();
      await createFundRequest(
        {
          user: { role: 'zo', mobile_number: localCtx.zoMobile },
          body: {
            zo_fr_no: `FR_IDEM_${localSuffix}`,
            work_order_no: localCtx.workOrder,
            zo_fr_amount: 4000,
            zo_remarks: 'Idempotency test'
          }
        },
        createRes
      );
      expect(createRes.statusCode).toBe(201);
      const frId = createRes.jsonData.fundRequest.fund_request_id;
      localCtx.fundRequestIds.push(frId);

      const actionReq = {
        params: { id: frId },
        user: { role: 'ho', mobile_number: localCtx.hoMobile },
        body: {
          action: 'Approve',
          approve_ho_amount: 4000,
          transfer_from_account: 'CC',
          ho_remarks: 'Approved once'
        }
      };

      const firstRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnFundRequest(actionReq, firstRes);
      });
      expect(firstRes.statusCode).toBe(200);

      const balanceAfterFirst = await getZoBalance(localCtx.zoMobile);
      const ledgerCountAfterFirst = await countLedgerRows({ referenceId: frId });

      const retryRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnFundRequest(actionReq, retryRes);
      });

      expect(retryRes.statusCode).toBe(403);
      expect(retryRes.jsonData.message).toMatch(/Pending or Hold/i);

      const balanceAfterRetry = await getZoBalance(localCtx.zoMobile);
      const ledgerCountAfterRetry = await countLedgerRows({ referenceId: frId });

      expect(balanceAfterRetry).toBe(balanceAfterFirst);
      expect(ledgerCountAfterRetry).toBe(ledgerCountAfterFirst);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('refresh token twice does not create duplicate active sessions', async () => {
    const session = await loginTestUser({
      displayName: 'Idempotency refresh user',
      role: 'je'
    });

    try {
      const { data: userRow } = await supabase
        .from('authorised_users')
        .select('id')
        .eq('mobile_number', session.mobile.canonical)
        .single();

      const countActiveSessions = async () => {
        const { count } = await supabase
          .from('sessions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userRow.id)
          .eq('is_active', true);
        return count || 0;
      };

      const activeBefore = await countActiveSessions();

      const firstRefreshReq = { cookies: session.cookies, headers: {} };
      const firstRefreshRes = mockResWithCookies();
      await refreshTokens(firstRefreshReq, firstRefreshRes);
      expect(firstRefreshRes.statusCode).toBe(200);

      const activeAfterFirst = await countActiveSessions();
      expect(activeAfterFirst).toBe(activeBefore);

      const secondRefreshReq = { cookies: firstRefreshRes.cookies, headers: {} };
      const secondRefreshRes = mockResWithCookies();
      await refreshTokens(secondRefreshReq, secondRefreshRes);
      expect(secondRefreshRes.statusCode).toBe(200);

      const activeAfterSecond = await countActiveSessions();
      expect(activeAfterSecond).toBe(activeBefore);
      expect(activeAfterSecond).toBe(1);
    } finally {
      await deleteAuthTestUser(session.mobile.canonical);
    }
  });

  test('retrying estimate submit does not duplicate revision log or change status', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({ suffix: `idem4_${localSuffix}` });
    const { estimateId } = await seedDraftEstimate(localCtx);

    try {
      const submitReq = {
        params: { id: estimateId },
        user: { role: 'je', mobile_number: localCtx.jeMobile }
      };

      const firstRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await submitEstimate(submitReq, firstRes);
      });
      expect(firstRes.statusCode).toBe(200);

      const { data: estimateAfterFirst } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status')
        .eq('estimate_id', estimateId)
        .single();

      const { count: logCountAfterFirst } = await supabase
        .from('estimate_revision_log')
        .select('id', { count: 'exact', head: true })
        .eq('estimate_id', estimateId);

      const retryRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await submitEstimate(submitReq, retryRes);
      });

      expect(retryRes.statusCode).toBe(403);
      expect(retryRes.jsonData.message).toMatch(/cannot be submitted/i);

      const { data: estimateAfterRetry } = await supabase
        .from('project_cost_estimates')
        .select('estimate_status')
        .eq('estimate_id', estimateId)
        .single();

      const { count: logCountAfterRetry } = await supabase
        .from('estimate_revision_log')
        .select('id', { count: 'exact', head: true })
        .eq('estimate_id', estimateId);

      expect(estimateAfterRetry.estimate_status).toBe(estimateAfterFirst.estimate_status);
      expect(logCountAfterRetry).toBe(logCountAfterFirst);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });
});
