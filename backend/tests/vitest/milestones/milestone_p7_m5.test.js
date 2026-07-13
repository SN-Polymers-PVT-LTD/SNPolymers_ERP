import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');
const mockRes = require('../../helpers/mockRes');
const {
  createReturnRequest,
  acceptReturnRequest,
  rejectReturnRequest,
  modifyReturnRequest,
  hoActionOnReturn,
  getReturnRequests
} = require('../../../src/controllers/fundReturns.controller');

describe('Milestone P7-M5 — Excess Fund Returns State Machine Integration Tests', () => {
  let suffix;
  let zoMobile;
  let adminMobile;
  let nonZoMobile;
  let workOrderNo;
  let returnId1;
  let returnId2;
  let returnId3;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    zoMobile = `9401${suffix}`;
    adminMobile = `9402${suffix}`;
    nonZoMobile = `9403${suffix}`;
    workOrderNo = `WO-P7-M5-${suffix}`;

    // Create test users
    await setupUsers([
      {
        mobile_number: zoMobile,
        role: 'zo',
        is_active: true,
        display_name: `Test ZO ${suffix}`
      },
      {
        mobile_number: adminMobile,
        role: 'admin',
        is_active: true,
        display_name: `Test Admin ${suffix}`
      },
      {
        mobile_number: nonZoMobile,
        role: 'je',
        is_active: true,
        display_name: `Test JE ${suffix}`
      }
    ]);

    // Create a project/work order owned by ZO
    const { error: projectErr } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no: workOrderNo,
          estimate_no: `EST-M5-${suffix}`,
          site_details: `Site Details M5-${suffix}`,
          zo_user_id: zoMobile,
          state: 'State',
          district: 'District',
          zone: 'Zone',
          department: 'Dept',
          created_by: adminMobile,
          edited_by: adminMobile,
          work_order_value: 500000.00
        }
      ]);

    if (projectErr) {
      throw new Error(`Failed to set up test project: ${projectErr.message}`);
    }

    // Initialize balance to 5000.00
    await supabase.from('zo_balances').upsert({
      zo_user_id: zoMobile,
      available_balance: 5000.00,
      updated_at: new Date().toISOString()
    });
  });

  afterAll(async () => {
    // Clean up created records in reverse order
    await supabase.from('zo_balances').delete().eq('zo_user_id', zoMobile);
    await supabase.from('zo_fund_ledger').delete().eq('zo_user_id', zoMobile);
    if (returnId1) await supabase.from('excess_fund_returns').delete().eq('id', returnId1);
    if (returnId2) await supabase.from('excess_fund_returns').delete().eq('id', returnId2);
    if (returnId3) await supabase.from('excess_fund_returns').delete().eq('id', returnId3);
    await supabase.from('projects_master').delete().eq('work_order_no', workOrderNo);
    await supabase.from('authorised_users').delete().in('mobile_number', [zoMobile, adminMobile, nonZoMobile]);
  });

  test('M5-TC-01: Successfully creates a return request as Admin (201)', async () => {
    const req = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo,
        zo_user_id: zoMobile,
        requested_amount: 2000.00,
        remarks_ho: 'Excess allocation return requested'
      }
    };
    const res = mockRes();
    await createReturnRequest(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.returnRequest).toBeDefined();
    expect(res.jsonData.returnRequest.status).toBe('Requested');
    expect(Number(res.jsonData.returnRequest.requested_amount)).toBe(2000.00);

    returnId1 = res.jsonData.returnRequest.id;
  });

  test('M5-TC-02: Accepting request fails with 422 if ZO has insufficient balance', async () => {
    // 1. Create a request for amount greater than current balance (5000.00)
    const reqCreate = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo,
        zo_user_id: zoMobile,
        requested_amount: 8000.00,
        remarks_ho: 'Overdraft return'
      }
    };
    const resCreate = mockRes();
    await createReturnRequest(reqCreate, resCreate);
    expect(resCreate.statusCode).toBe(201);
    returnId2 = resCreate.jsonData.returnRequest.id;

    // 2. Try to accept the request
    const reqAccept = {
      user: { mobile_number: zoMobile, role: 'zo' },
      params: { id: returnId2 },
      body: { client_updated_at: resCreate.jsonData.returnRequest.updated_at }
    };
    const resAccept = mockRes();
    await acceptReturnRequest(reqAccept, resAccept);

    console.log('DEBUG TC-02 resAccept JSON:', resAccept.jsonData);

    expect(resAccept.statusCode).toBe(422);
    expect(resAccept.jsonData.success).toBe(false);
    expect(resAccept.jsonData.message).toContain('Insufficient available balance');
  });

  test('M5-TC-03: Accepting request fails with 409 if client_updated_at is stale', async () => {
    const staleTime = new Date(Date.now() - 100000).toISOString();
    const reqAccept = {
      user: { mobile_number: zoMobile, role: 'zo' },
      params: { id: returnId1 },
      body: { client_updated_at: staleTime }
    };
    const resAccept = mockRes();
    await acceptReturnRequest(reqAccept, resAccept);

    expect(resAccept.statusCode).toBe(409);
    expect(resAccept.jsonData.success).toBe(false);
    expect(resAccept.jsonData.message).toContain('Stale acceptance request.');
  });

  test('M5-TC-04: Successfully accepts return request, debits balance, and writes to ledger (200)', async () => {
    // Get latest updated_at
    const { data: latest } = await supabase
      .from('excess_fund_returns')
      .select('updated_at')
      .eq('id', returnId1)
      .single();

    const reqAccept = {
      user: { mobile_number: zoMobile, role: 'zo' },
      params: { id: returnId1 },
      body: { client_updated_at: latest.updated_at }
    };
    const resAccept = mockRes();
    await acceptReturnRequest(reqAccept, resAccept);

    console.log('DEBUG TC-04 resAccept JSON:', resAccept.jsonData);

    expect(resAccept.statusCode).toBe(200);
    expect(resAccept.jsonData.success).toBe(true);
    expect(resAccept.jsonData.returnRequest.status).toBe('Completed');

    // 1. Verify balance was debited (5000.00 - 2000.00 = 3000.00)
    const { data: balData } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', zoMobile)
      .single();
    expect(Number(balData.available_balance)).toBe(3000.00);

    // 2. Verify negative debit ledger entry was created
    const { data: ledgData } = await supabase
      .from('zo_fund_ledger')
      .select('*')
      .eq('reference_id', returnId1)
      .single();
    expect(ledgData).toBeDefined();
    expect(ledgData.transaction_type).toBe('RETURN');
    expect(Number(ledgData.amount)).toBe(-2000.00);
  });

  test('M5-TC-05: Rejects a return request with mandatory ZO remarks (200)', async () => {
    // 1. Create a third return request
    const reqCreate = {
      user: { mobile_number: adminMobile, role: 'admin' },
      body: {
        work_order_no: workOrderNo,
        zo_user_id: zoMobile,
        requested_amount: 500.00,
        remarks_ho: 'Small return request'
      }
    };
    const resCreate = mockRes();
    await createReturnRequest(reqCreate, resCreate);
    expect(resCreate.statusCode).toBe(201);
    returnId3 = resCreate.jsonData.returnRequest.id;

    // 2. Reject it as ZO
    const reqReject = {
      user: { mobile_number: zoMobile, role: 'zo' },
      params: { id: returnId3 },
      body: { remarks_zo: 'Rejecting due to mismatching calculations' }
    };
    const resReject = mockRes();
    await rejectReturnRequest(reqReject, resReject);

    expect(resReject.statusCode).toBe(200);
    expect(resReject.jsonData.success).toBe(true);
    expect(resReject.jsonData.returnRequest.status).toBe('Rejected');
    expect(resReject.jsonData.returnRequest.remarks_zo).toBe('Rejecting due to mismatching calculations');
  });

  test('M5-TC-06: HO Actions on a Rejected request (Reissue / Cancel) (200)', async () => {
    // 1. Reissue/Revise the Rejected request (sets status back to Requested)
    const reqReissue = {
      user: { mobile_number: adminMobile, role: 'admin' },
      params: { id: returnId3 },
      body: { status: 'Requested', requested_amount: 450.00, remarks_ho: 'Revised small request' }
    };
    const resReissue = mockRes();
    await hoActionOnReturn(reqReissue, resReissue);

    expect(resReissue.statusCode).toBe(200);
    expect(resReissue.jsonData.success).toBe(true);
    expect(resReissue.jsonData.returnRequest.status).toBe('Requested');
    expect(Number(resReissue.jsonData.returnRequest.requested_amount)).toBe(450.00);

    // 2. ZO requests modification (sets status to Awaiting HO Review)
    const reqModify = {
      user: { mobile_number: zoMobile, role: 'zo' },
      params: { id: returnId3 },
      body: { remarks_zo: 'Still high, please adjust' }
    };
    const resModify = mockRes();
    await modifyReturnRequest(reqModify, resModify);
    expect(resModify.statusCode).toBe(200);
    expect(resModify.jsonData.returnRequest.status).toBe('Awaiting HO Review');

    // 3. HO Cancels request
    const reqCancel = {
      user: { mobile_number: adminMobile, role: 'admin' },
      params: { id: returnId3 },
      body: { status: 'Cancelled', remarks_ho: 'Cancelled as requested' }
    };
    const resCancel = mockRes();
    await hoActionOnReturn(reqCancel, resCancel);

    expect(resCancel.statusCode).toBe(200);
    expect(resCancel.jsonData.success).toBe(true);
    expect(resCancel.jsonData.returnRequest.status).toBe('Cancelled');
  });
});
