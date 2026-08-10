import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { supabase } = require('../../../src/db/supabase');
const {
  seedCapDivergenceScenario,
  cleanupFinancialScenario,
  insertRequisitionViaRpc
} = require('../../helpers/capDivergenceFixture');
const { FROZEN_ISO, withFrozenTime } = require('../../helpers/freezeTime');
const {
  createFundRequest,
  actOnFundRequest
} = require('../../../src/controllers/fundRequests.controller');
const { createBill } = require('../../../src/controllers/raFinalBill.controller');
const { actOnRequisition } = require('../../../src/controllers/requisitions.controller');

describe('rpcRejectionContracts — BUD02 / EST01 / BAL01', () => {
  describe('Fund request approval BUD02', () => {
    let ctx;

    beforeAll(async () => {
      await requireLocalSupabase();
      const suffix = crypto.randomUUID().substring(0, 8);
      ctx = await seedCapDivergenceScenario({
        suffix: `rpc_fr_${suffix}`,
        workOrderValue: 500000,
        estimateAmount: 30000,
        cementHeadAmount: 30000,
        sandHeadAmount: 0,
        zoBalance: 50000
      });

      const { data: approvedFr, error: frErr } = await supabase
        .from('fund_requests')
        .insert({
          zo_user_id: ctx.zoMobile,
          work_order_no: ctx.workOrder,
          zo_fr_no: `FR_RPC_APP_${ctx.suffix}`,
          zo_fr_amount: 28000,
          request_status: 'Approved',
          approve_ho_amount: 28000,
          transfer_from_account: 'CC',
          approve_ho_user_id: ctx.hoMobile,
          approve_ho_date: new Date().toISOString(),
          created_by: ctx.zoMobile
        })
        .select()
        .single();
      if (frErr) throw frErr;
      ctx.fundRequestIds.push(approvedFr.fund_request_id);
    });

    afterAll(async () => {
      await cleanupFinancialScenario(ctx);
    });

    test('rejects approval when approve_ho_amount exceeds remaining estimate capacity (BUD02)', async () => {
      const { data: pendingFr, error: pendingErr } = await supabase
        .from('fund_requests')
        .insert({
          zo_user_id: ctx.zoMobile,
          work_order_no: ctx.workOrder,
          zo_fr_no: `FR_RPC_PEND_${ctx.suffix}`,
          zo_fr_amount: 5000,
          request_status: 'Pending',
          created_by: ctx.zoMobile
        })
        .select()
        .single();
      if (pendingErr) throw pendingErr;
      ctx.fundRequestIds.push(pendingFr.fund_request_id);

      const approveRes = mockRes();
      await actOnFundRequest(
        {
          params: { id: pendingFr.fund_request_id },
          user: { role: 'ho', mobile_number: ctx.hoMobile },
          body: {
            action: 'Approve',
            approve_ho_amount: 5000,
            transfer_from_account: 'CC',
            ho_remarks: 'Should fail BUD02'
          }
        },
        approveRes
      );

      expect(approveRes.statusCode).toBe(422);
      expect(approveRes.jsonData.message).toMatch(/remaining Cost Estimate funding capacity/i);
    });
  });

  describe('Fund request approval EST01', () => {
    test('rejects approval when no Final Approved estimate exists', async () => {
      await requireLocalSupabase();
      const suffix = crypto.randomUUID().substring(0, 8);
      const ctx = await seedCapDivergenceScenario({
        suffix: `rpc_est01_${suffix}`,
        workOrderValue: 500000,
        estimateAmount: 100000,
        cementHeadAmount: 100000,
        sandHeadAmount: 0
      });

      try {
        const { error: estUpdateErr } = await supabase
          .from('project_cost_estimates')
          .update({ estimate_status: 'Draft' })
          .eq('work_order_no', ctx.workOrder)
          .eq('estimate_status', 'Final Approved');
        if (estUpdateErr) throw estUpdateErr;

        const { data: remainingEst } = await supabase
          .from('project_cost_estimates')
          .select('estimate_id')
          .eq('work_order_no', ctx.workOrder)
          .eq('estimate_status', 'Final Approved');
        expect(remainingEst || []).toHaveLength(0);

        const { data: pendingFr, error: pendingErr } = await supabase
          .from('fund_requests')
          .insert({
            zo_user_id: ctx.zoMobile,
            work_order_no: ctx.workOrder,
            zo_fr_no: `FR_EST01_${suffix}`,
            zo_fr_amount: 5000,
            request_status: 'Pending',
            created_by: ctx.zoMobile
          })
          .select()
          .single();
        if (pendingErr) throw pendingErr;
        ctx.fundRequestIds.push(pendingFr.fund_request_id);

        const approveRes = mockRes();
        await actOnFundRequest(
          {
            params: { id: pendingFr.fund_request_id },
            user: { role: 'ho', mobile_number: ctx.hoMobile },
            body: {
              action: 'Approve',
              approve_ho_amount: 5000,
              transfer_from_account: 'CC',
              ho_remarks: 'Should fail EST01'
            }
          },
          approveRes
        );

        expect(approveRes.statusCode).toBe(422);
        expect(approveRes.jsonData.message).toMatch(/Final Approved cost estimate/i);
      } finally {
        await cleanupFinancialScenario(ctx);
      }
    });
  });

  describe('RA bill overbilling BUD02', () => {
    let ctx;
    let billCopyUrl;

    beforeAll(async () => {
      await requireLocalSupabase();
      const suffix = crypto.randomUUID().substring(0, 8);
      ctx = await seedCapDivergenceScenario({
        suffix: `rpc_ra_${suffix}`,
        workOrderValue: 500000,
        estimateAmount: 100000,
        cementHeadAmount: 100000,
        sandHeadAmount: 0
      });
      billCopyUrl = `https://example.com/bills/${suffix}.pdf`;
    });

    afterAll(async () => {
      if (ctx?.workOrder) {
        await supabase.from('ra_final_bills').delete().eq('work_order_no', ctx.workOrder);
        await cleanupFinancialScenario(ctx);
      }
    });

    test('rejects bill when gross exceeds estimate cap (BUD02)', async () => {
      const res = mockRes();
      await createBill(
        {
          user: { role: 'ho', mobile_number: ctx.hoMobile },
          body: {
            work_order_no: ctx.workOrder,
            payment_type: 'RA Bill 1',
            bill_date: '2026-08-01',
            bill_no: `BILL_RPC_${ctx.suffix}`,
            gross_bill: 150000,
            agency_payment: 150000,
            bill_copy_url: billCopyUrl
          }
        },
        res
      );

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toMatch(/overbilling|exceed/i);
    });
  });

  describe('Requisition approval BAL01', () => {
    test('rejects approval when amount exceeds ZO balance', async () => {
      await requireLocalSupabase();
      const suffix = crypto.randomUUID().substring(0, 8);
      const ctx = await seedCapDivergenceScenario({
        suffix: `rpc_req_${suffix}`,
        estimateAmount: 500000,
        cementHeadAmount: 500000,
        sandHeadAmount: 0,
        zoBalance: 1000
      });

      try {
        const req = await insertRequisitionViaRpc(ctx, {
          requisition_no: `REQ_BAL_${suffix}`,
          requisition_amount: 5000
        });

        const res = mockRes();
        await withFrozenTime(FROZEN_ISO, async () => {
          await actOnRequisition(
            {
              params: { id: req.requisition_id },
              user: { role: 'ho', mobile_number: ctx.hoMobile },
              body: {
                action: 'Approve',
                approved_amount: 5000,
                remarks_approved_authority: 'Should fail BAL01'
              }
            },
            res
          );
        });

        expect(res.statusCode).toBe(422);
        expect(res.jsonData.message).toMatch(/balance|BAL01/i);
      } finally {
        await cleanupFinancialScenario(ctx);
      }
    });
  });
});
