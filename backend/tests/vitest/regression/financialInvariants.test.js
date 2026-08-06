import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const { FROZEN_ISO, withFrozenTime } = require('../../helpers/freezeTime');
const {
  seedFinancialScenario,
  insertRequisitionDirect,
  insertRequisitionViaRpc,
  getZoBalance,
  getLedgerRows,
  cleanupFinancialScenario
} = require('../../helpers/financialFixture');
const {
  getRequisitionById,
  createRequisition,
  actOnRequisition
} = require('../../../src/controllers/requisitions.controller');
const {
  createFundRequest,
  actOnFundRequest
} = require('../../../src/controllers/fundRequests.controller');
const { supabase } = require('../../../src/db/supabase');

describe('financialInvariants — budget, ledger, approval integrity', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedFinancialScenario();
  });

  afterAll(async () => {
    await cleanupFinancialScenario(ctx);
  });

  test('approved requisitions commit approved_amount in remaining estimate calculation', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud1_${localSuffix}`,
      estimateAmount: 500000,
      cementHeadAmount: 500000,
      sandHeadAmount: 0
    });

    try {
      const approved = await insertRequisitionDirect(localCtx, {
        requisition_no: `REQ_APP_${localSuffix}`,
        requisition_amount: 10000,
        estimate_amount: 500000,
        requisition_status: 'Approved',
        approved_amount: 4000,
        approved_balance_amount: 6000
      });

      const pending = await insertRequisitionDirect(localCtx, {
        requisition_no: `REQ_PEND_${localSuffix}`,
        requisition_amount: 2000,
        estimate_amount: 500000,
        requisition_status: 'Pending'
      });

      const res = mockRes();
      await getRequisitionById(
        {
          params: { id: pending.requisition_id },
          user: { role: 'admin', mobile_number: localCtx.adminMobile }
        },
        res
      );

      expect(res.statusCode).toBe(200);
      expect(Number(res.jsonData.requisition.remainingEstimateAmount)).toBe(494000);
      expect(approved.requisition_id).toBeTruthy();
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('cancelled requisitions are excluded from committed budget on create', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud2_${localSuffix}`,
      estimateAmount: 10000,
      cementHeadAmount: 10000,
      sandHeadAmount: 0
    });

    try {
      await insertRequisitionDirect(localCtx, {
        requisition_no: `REQ_CAN_${localSuffix}`,
        requisition_amount: 8000,
        estimate_amount: 10000,
        requisition_status: 'Cancelled'
      });

      const res = mockRes();
      await createRequisition(
        {
          user: { role: 'je', mobile_number: localCtx.jeMobile },
          body: {
            work_order_no: localCtx.workOrder,
            requisition_no: `REQ_NEW_${localSuffix}`,
            material_main_head: 'Cement',
            requisition_pdf_url: `fixtures/REQ_NEW_${localSuffix}.pdf`,
            requisition_amount: 9000,
            gst_bill: 'No',
            bank_details: 'Test bank'
          }
        },
        res
      );

      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);
      if (res.jsonData.requisition?.requisition_id) {
        localCtx.requisitionIds.push(res.jsonData.requisition.requisition_id);
      }
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('create rejects amount exceeding remaining main-head capacity', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud3_${localSuffix}`,
      estimateAmount: 10000,
      cementHeadAmount: 10000,
      sandHeadAmount: 0
    });

    try {
      await insertRequisitionDirect(localCtx, {
        requisition_no: `REQ_APP5K_${localSuffix}`,
        requisition_amount: 5000,
        estimate_amount: 10000,
        requisition_status: 'Approved',
        approved_amount: 5000,
        approved_balance_amount: 0
      });

      const res = mockRes();
      await createRequisition(
        {
          user: { role: 'je', mobile_number: localCtx.jeMobile },
          body: {
            work_order_no: localCtx.workOrder,
            requisition_no: `REQ_OVER_${localSuffix}`,
            material_main_head: 'Cement',
            requisition_pdf_url: `fixtures/REQ_OVER_${localSuffix}.pdf`,
            requisition_amount: 5001,
            gst_bill: 'No',
            bank_details: 'Test bank'
          }
        },
        res
      );

      expect(res.statusCode).toBe(422);
      expect(res.jsonData.success).toBe(false);
      expect(res.jsonData.message).toMatch(/capacity|balance/i);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('main-head capacity gate blocks second approval when head is exhausted', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud4_${localSuffix}`,
      estimateAmount: 30000,
      cementHeadAmount: 10000,
      sandHeadAmount: 20000
    });

    try {
      const reqA = await insertRequisitionViaRpc(localCtx, {
        requisition_no: `REQ_A_${localSuffix}`,
        requisition_amount: 8000
      });
      const reqB = await insertRequisitionViaRpc(localCtx, {
        requisition_no: `REQ_B_${localSuffix}`,
        requisition_amount: 3000
      });

      const approveA = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnRequisition(
          {
            params: { id: reqA.requisition_id },
            user: { role: 'zo', mobile_number: localCtx.zoMobile },
            body: {
              action: 'Approve',
              approved_amount: 8000,
              remarks_approved_authority: 'First approval'
            }
          },
          approveA
        );
      });
      expect(approveA.statusCode).toBe(200);

      const approveB = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnRequisition(
          {
            params: { id: reqB.requisition_id },
            user: { role: 'zo', mobile_number: localCtx.zoMobile },
            body: {
              action: 'Approve',
              approved_amount: 3000,
              remarks_approved_authority: 'Should fail'
            }
          },
          approveB
        );
      });

      expect(approveB.statusCode).toBe(422);
      expect(approveB.jsonData.message).toMatch(/Main Head capacity/i);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('requisition approval debits ZO balance and writes negative ledger entry', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud5_${localSuffix}`,
      zoBalance: 50000
    });

    try {
      const req = await insertRequisitionViaRpc(localCtx, {
        requisition_no: `REQ_DEB_${localSuffix}`,
        requisition_amount: 3000
      });

      const balanceBefore = await getZoBalance(localCtx.zoMobile);
      const ledgerBefore = await getLedgerRows({
        zoMobile: localCtx.zoMobile,
        referenceId: req.requisition_id
      });

      const res = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnRequisition(
          {
            params: { id: req.requisition_id },
            user: { role: 'ho', mobile_number: localCtx.hoMobile },
            body: {
              action: 'Approve',
              approved_amount: 3000,
              remarks_approved_authority: 'Debit test'
            }
          },
          res
        );
      });

      expect(res.statusCode).toBe(200);

      const balanceAfter = await getZoBalance(localCtx.zoMobile);
      expect(balanceAfter).toBe(balanceBefore - 3000);

      const ledgerAfter = await getLedgerRows({
        zoMobile: localCtx.zoMobile,
        referenceId: req.requisition_id
      });
      expect(ledgerAfter.length).toBe(ledgerBefore.length + 1);
      expect(Number(ledgerAfter.find((row) => row.reference_id === req.requisition_id).amount)).toBe(-3000);
      expect(ledgerAfter.find((row) => row.reference_id === req.requisition_id).transaction_type).toBe('REQUISITION_APPROVAL');
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('fund request create rejects amount above remaining estimate funding capacity', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud6_${localSuffix}`,
      estimateAmount: 10000,
      cementHeadAmount: 10000,
      sandHeadAmount: 0
    });

    try {
      const { data: approvedFr, error: frErr } = await supabase
        .from('fund_requests')
        .insert({
          zo_user_id: localCtx.zoMobile,
          work_order_no: localCtx.workOrder,
          zo_fr_no: `FR_APP_${localSuffix}`,
          zo_fr_amount: 8000,
          request_status: 'Approved',
          approve_ho_amount: 8000,
          transfer_from_account: 'CC',
          approve_ho_user_id: localCtx.hoMobile,
          approve_ho_date: new Date().toISOString(),
          created_by: localCtx.zoMobile
        })
        .select()
        .single();
      if (frErr) throw frErr;
      localCtx.fundRequestIds.push(approvedFr.fund_request_id);

      const res = mockRes();
      await createFundRequest(
        {
          user: { role: 'zo', mobile_number: localCtx.zoMobile },
          body: {
            zo_fr_no: `FR_NEW_${localSuffix}`,
            work_order_no: localCtx.workOrder,
            zo_fr_amount: 3000,
            zo_remarks: 'Over capacity'
          }
        },
        res
      );

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.message).toMatch(/remaining Cost Estimate funding capacity/i);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('fund request approval credits ZO balance and writes positive ledger entry', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud7_${localSuffix}`,
      estimateAmount: 100000,
      zoBalance: 10000
    });

    try {
      const createRes = mockRes();
      await createFundRequest(
        {
          user: { role: 'zo', mobile_number: localCtx.zoMobile },
          body: {
            zo_fr_no: `FR_CRED_${localSuffix}`,
            work_order_no: localCtx.workOrder,
            zo_fr_amount: 5000,
            zo_remarks: 'Credit test'
          }
        },
        createRes
      );
      expect(createRes.statusCode).toBe(201);
      const frId = createRes.jsonData.fundRequest.fund_request_id;
      localCtx.fundRequestIds.push(frId);

      const balanceBefore = await getZoBalance(localCtx.zoMobile);
      const ledgerBefore = await getLedgerRows({ referenceId: frId });

      const approveRes = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnFundRequest(
          {
            params: { id: frId },
            user: { role: 'ho', mobile_number: localCtx.hoMobile },
            body: {
              action: 'Approve',
              approve_ho_amount: 5000,
              transfer_from_account: 'CC',
              ho_remarks: 'Approved for credit test'
            }
          },
          approveRes
        );
      });

      expect(approveRes.statusCode).toBe(200);

      const balanceAfter = await getZoBalance(localCtx.zoMobile);
      expect(balanceAfter).toBe(balanceBefore + 5000);

      const ledgerAfter = await getLedgerRows({ referenceId: frId });
      expect(ledgerAfter.length).toBe(ledgerBefore.length + 1);
      const creditRow = ledgerAfter.find((row) => row.reference_id === frId && row.transaction_type === 'ALLOCATION');
      expect(Number(creditRow.amount)).toBe(5000);
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });

  test('approved requisition stores correct approved_balance_amount', async () => {
    const localSuffix = crypto.randomUUID().substring(0, 8);
    const localCtx = await seedFinancialScenario({
      suffix: `bud8_${localSuffix}`
    });

    try {
      const req = await insertRequisitionViaRpc(localCtx, {
        requisition_no: `REQ_BAL_${localSuffix}`,
        requisition_amount: 10000
      });

      const res = mockRes();
      await withFrozenTime(FROZEN_ISO, async () => {
        await actOnRequisition(
          {
            params: { id: req.requisition_id },
            user: { role: 'admin', mobile_number: localCtx.adminMobile },
            body: {
              action: 'Approve',
              approved_amount: 7000,
              remarks_approved_authority: 'Partial approval'
            }
          },
          res
        );
      });

      expect(res.statusCode).toBe(200);
      expect(Number(res.jsonData.requisition.approved_amount)).toBe(7000);
      expect(Number(res.jsonData.requisition.approved_balance_amount)).toBe(3000);

      const { data: row, error } = await supabase
        .from('requisitions')
        .select('approved_balance_amount, requisition_amount, approved_amount')
        .eq('requisition_id', req.requisition_id)
        .single();
      expect(error).toBeNull();
      expect(Number(row.approved_balance_amount)).toBe(
        Number(row.requisition_amount) - Number(row.approved_amount)
      );
    } finally {
      await cleanupFinancialScenario(localCtx);
    }
  });
});
