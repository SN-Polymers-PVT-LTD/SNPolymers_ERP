import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { supabase } = require('../../../src/db/supabase');
const {
  seedCapDivergenceScenario,
  cleanupFinancialScenario
} = require('../../helpers/capDivergenceFixture');
const { getFundRequests, createFundRequest, actOnFundRequest } = require('../../../src/controllers/fundRequests.controller');
const { getProjectCapacity } = require('../../../src/controllers/projects.controller');
const { getBillSummaryByWorkOrder, createBill } = require('../../../src/controllers/raFinalBill.controller');
const { getWorkOrderCapacity } = require('../../../src/services/workOrderCapacity.service');

describe('businessRuleInvariants — estimate ≠ WO value matrix', () => {
  let ctx;

  beforeAll(async () => {
    await requireLocalSupabase();
    const suffix = crypto.randomUUID().substring(0, 8);
    ctx = await seedCapDivergenceScenario({
      suffix: `br_${suffix}`,
      workOrderValue: 500000,
      estimateAmount: 300000,
      cementHeadAmount: 300000,
      sandHeadAmount: 0
    });
  });

  afterAll(async () => {
    await cleanupFinancialScenario(ctx);
  });

  test('capacity service exposes estimate-based caps when WO value differs', async () => {
    const capacity = await getWorkOrderCapacity(ctx.workOrder);

    expect(capacity.work_order_value).toBe(500000);
    expect(capacity.estimate_amount).toBe(300000);
    expect(capacity.funding_cap).toBe(300000);
    expect(capacity.funding_cap_source).toBe('estimate');
    expect(capacity.billing_cap).toBe(300000);
    expect(capacity.fr_remaining).toBe(300000);
    expect(capacity.billing_remaining).toBe(300000);
  });

  test('GET /projects/:wo/capacity returns unified capacity payload', async () => {
    const req = {
      params: { work_order_no: ctx.workOrder },
      user: { role: 'admin', mobile_number: ctx.adminMobile }
    };
    const res = mockRes();
    await getProjectCapacity(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.capacity.estimate_amount).toBe(300000);
    expect(res.jsonData.capacity.funding_cap).toBe(300000);
    expect(res.jsonData.capacity.billing_cap).toBe(300000);
  });

  test('GET /fund-requests enriches estimated_value from Final Approved estimate', async () => {
    const createRes = mockRes();
    await createFundRequest(
      {
        user: { role: 'zo', mobile_number: ctx.zoMobile },
        body: {
          zo_fr_no: `FR_BR_${ctx.suffix}`,
          work_order_no: ctx.workOrder,
          zo_fr_amount: 10000,
          zo_remarks: 'Invariant test'
        }
      },
      createRes
    );
    expect(createRes.statusCode).toBe(201);
    ctx.fundRequestIds.push(createRes.jsonData.fundRequest.fund_request_id);

    const listRes = mockRes();
    await getFundRequests(
      { user: { role: 'admin', mobile_number: ctx.adminMobile }, query: {} },
      listRes
    );

    expect(listRes.statusCode).toBe(200);
    const row = listRes.jsonData.fundRequests.find(
      (fr) => fr.fund_request_id === createRes.jsonData.fundRequest.fund_request_id
    );
    expect(row).toBeTruthy();
    expect(row.estimated_value).toBe(300000);
    expect(row.work_order_value).toBe(500000);
  });

  test('fund request remaining capacity uses submitted+approved totals (spec 4c)', async () => {
    const suffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedCapDivergenceScenario({
      suffix: `br_fr_${suffix}`,
      workOrderValue: 500000,
      estimateAmount: 300000,
      cementHeadAmount: 300000,
      sandHeadAmount: 0
    });

    try {
      const { data: partialFr, error: frErr } = await supabase
        .from('fund_requests')
        .insert({
          zo_user_id: localCtx.zoMobile,
          work_order_no: localCtx.workOrder,
          zo_fr_no: `FR_PART_${suffix}`,
          zo_fr_amount: 22000,
          request_status: 'Approved',
          approve_ho_amount: 10000,
          transfer_from_account: 'CC',
          approve_ho_user_id: localCtx.hoMobile,
          approve_ho_date: new Date().toISOString(),
          created_by: localCtx.zoMobile
        })
        .select()
        .single();
      if (frErr) throw frErr;
      localCtx.fundRequestIds.push(partialFr.fund_request_id);

      const { data: pendingFr, error: pendingErr } = await supabase
        .from('fund_requests')
        .insert({
          zo_user_id: localCtx.zoMobile,
          work_order_no: localCtx.workOrder,
          zo_fr_no: `FR_PEND_${suffix}`,
          zo_fr_amount: 15000,
          request_status: 'Pending',
          created_by: localCtx.zoMobile
        })
        .select()
        .single();
      if (pendingErr) throw pendingErr;
      localCtx.fundRequestIds.push(pendingFr.fund_request_id);

      const capacity = await getWorkOrderCapacity(localCtx.workOrder);
      expect(capacity.fr_approved_total).toBe(10000);
      expect(capacity.fr_submitted_total).toBe(25000);
      expect(capacity.fr_remaining).toBe(275000);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('create fund request rejects when pending FRs consume submitted pipeline (spec 4c)', async () => {
    const suffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedCapDivergenceScenario({
      suffix: `br_create_${suffix}`,
      workOrderValue: 500000,
      estimateAmount: 300000,
      cementHeadAmount: 300000,
      sandHeadAmount: 0
    });

    try {
      const { data: pendingFr, error: pendingErr } = await supabase
        .from('fund_requests')
        .insert({
          zo_user_id: localCtx.zoMobile,
          work_order_no: localCtx.workOrder,
          zo_fr_no: `FR_PIPE_${suffix}`,
          zo_fr_amount: 290000,
          request_status: 'Pending',
          created_by: localCtx.zoMobile
        })
        .select()
        .single();
      if (pendingErr) throw pendingErr;
      localCtx.fundRequestIds.push(pendingFr.fund_request_id);

      const overRes = mockRes();
      await createFundRequest(
        {
          user: { role: 'zo', mobile_number: localCtx.zoMobile },
          body: {
            zo_fr_no: `FR_OVER_${suffix}`,
            work_order_no: localCtx.workOrder,
            zo_fr_amount: 20000,
            zo_remarks: 'Should fail — only 10k pipeline left'
          }
        },
        overRes
      );
      expect(overRes.statusCode).toBe(400);
      expect(overRes.jsonData.message).toMatch(/cannot exceed the remaining/i);

      const okRes = mockRes();
      await createFundRequest(
        {
          user: { role: 'zo', mobile_number: localCtx.zoMobile },
          body: {
            zo_fr_no: `FR_OK_${suffix}`,
            work_order_no: localCtx.workOrder,
            zo_fr_amount: 10000,
            zo_remarks: 'Should pass — exactly 10k pipeline left'
          }
        },
        okRes
      );
      expect(okRes.statusCode).toBe(201);
      localCtx.fundRequestIds.push(okRes.jsonData.fundRequest.fund_request_id);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('RA bill summary exposes estimate-based billing cap', async () => {
    const res = mockRes();
    await getBillSummaryByWorkOrder(
      {
        params: { work_order_no: ctx.workOrder },
        user: { role: 'admin', mobile_number: ctx.adminMobile }
      },
      res
    );

    expect(res.statusCode).toBe(200);
    expect(res.jsonData.estimate_amount).toBe(300000);
    expect(res.jsonData.billing_cap).toBe(300000);
    expect(res.jsonData.work_order_value).toBe(500000);
    expect(res.jsonData.billing_remaining).toBe(300000);
  });
});
