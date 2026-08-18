import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  createSheet, addLineItem, updateLineItem, deleteLineItem, submitSheet,
  actOnLineItem, resubmitLineItem, reopenLineItem, exportBulkNeft, upsertBeneficiary
} = require('../../../src/controllers/acctRequisition.controller');
const { supabase } = require('../../../src/db/supabase');

async function callCreateSheet(mobile) {
  const req = { body: {}, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await createSheet(req, res);
  return res;
}

async function callAddLineItem(sheetId, mobile, body) {
  const req = { params: { sheetId }, body, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await addLineItem(req, res);
  return res;
}

async function callSubmitSheet(sheetId, mobile) {
  const req = { params: { sheetId }, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await submitSheet(req, res);
  return res;
}

async function callActOnLineItem(itemId, mobile, body, permissions = {}) {
  const req = { params: { itemId }, body, user: { role: 'ho', mobile_number: mobile, permissions } };
  const res = mockRes();
  await actOnLineItem(req, res);
  return res;
}

async function getItem(itemId) {
  const { data } = await supabase.from('acct_requisition_line_items').select('*').eq('id', itemId).single();
  return data;
}

describe('Accounts HO Approval — §9 lifecycle regression suite', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
  });

  // ── Test 1 — Balance guardrail (status-flag gated, not date-window gated) ──
  test('Test 1: balance guardrail rejects approval that would drive balance below zero', async () => {
    const sheetARes = await callCreateSheet(ctx.accountsMobile);
    const sheetA = sheetARes.jsonData.sheet;
    const itemARes = await callAddLineItem(sheetA.id, ctx.accountsMobile, {
      req_amount: 70000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const itemA = itemARes.jsonData.item;
    ctx.itemIds.push(itemA.id);
    ctx.sheetIds.push(sheetA.id);
    await callSubmitSheet(sheetA.id, ctx.accountsMobile);

    const approveARes = await callActOnLineItem(itemA.id, ctx.ho1Mobile, { action: 'Approve' });
    expect(approveARes.statusCode).toBe(200);
    expect(approveARes.jsonData.item.ho_actioned_by).toBe(ctx.ho1Mobile);

    // Migration 025: approval now actually debits bank_balance_master (was
    // previously untouched — a guardrail-only sum over line-item history).
    const { data: bankAfterA } = await supabase
      .from('bank_balance_master')
      .select('available_balance')
      .eq('bank_name', ctx.bankName)
      .single();
    expect(Number(bankAfterA.available_balance)).toBe(30000);

    const { data: payoutAuditRows } = await supabase
      .from('audit_log')
      .select('*')
      .eq('module_name', 'Bank Balance Master')
      .eq('record_identifier', ctx.bankName)
      .eq('action', 'BANK_DEBITED_PAYOUT');
    expect(payoutAuditRows.length).toBe(1);
    expect(Number(payoutAuditRows[0].new_value.delta)).toBe(-70000);

    const sheetBRes = await callCreateSheet(ctx.accountsMobile);
    const sheetB = sheetBRes.jsonData.sheet;
    const itemBRes = await callAddLineItem(sheetB.id, ctx.accountsMobile, {
      req_amount: 40000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const itemB = itemBRes.jsonData.item;
    ctx.itemIds.push(itemB.id);
    ctx.sheetIds.push(sheetB.id);
    await callSubmitSheet(sheetB.id, ctx.accountsMobile);

    const approveBRes = await callActOnLineItem(itemB.id, ctx.ho1Mobile, { action: 'Approve' });
    expect(approveBRes.statusCode).toBe(422); // 40000 > 30000 remaining
  });

  // ── Test 2 — Full audit log (9 named events, NB2 regression) ──
  test('Test 2: full lifecycle produces the 9 expected audit_log events in order', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 15000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;
    ctx.itemIds.push(item.id);

    expect((await getItem(item.id)).requisition_status).toBeNull();

    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    expect((await getItem(item.id)).requisition_status).toBe('Pending HO Review');

    await callActOnLineItem(item.id, ctx.ho1Mobile, { action: 'Hold', ho_remarks: 'need info' });
    await callActOnLineItem(item.id, ctx.ho1Mobile, { action: 'Return', ho_remarks: 'fix beneficiary' });

    const resubmitReq = {
      params: { itemId: item.id },
      body: { req_amount: 15000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const resubmitRes = mockRes();
    await resubmitLineItem(resubmitReq, resubmitRes);
    expect(resubmitRes.statusCode).toBe(200);

    await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Reject', ho_remarks: 'not valid' });

    const reopenReq = {
      params: { itemId: item.id },
      body: { reopen_remark: 'reconsidered' },
      user: { role: 'ho', mobile_number: ctx.ho2Mobile, permissions: { 'ho.requisition.reopen': true } }
    };
    const reopenRes = mockRes();
    await reopenLineItem(reopenReq, reopenRes);
    expect(reopenRes.statusCode).toBe(200);

    const approveRes = await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Approve' });
    expect(approveRes.statusCode).toBe(200);

    const { data: log } = await supabase
      .from('audit_log')
      .select('action')
      .eq('record_identifier', item.id)
      .order('timestamp', { ascending: true });

    expect(log.map(l => l.action)).toEqual([
      'LINE_ITEM_ADDED', 'PENDING_HO_REVIEW_FIRST_SUBMIT',
      'HO_HELD', 'HO_HOLD_RELEASED', 'HO_RETURNED',
      'RESUBMIT_AFTER_CORRECTION', 'HO_REJECTED', 'REOPEN', 'HO_APPROVED'
    ]);
  });

  // ── Test 3 — NB1 regression: resubmit does not throw ──
  test('Test 3: resubmit after Return clears live ho_* and populates last_ho_* without CHECK violation', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 5000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;
    ctx.itemIds.push(item.id);

    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    await callActOnLineItem(item.id, ctx.ho1Mobile, { action: 'Return', ho_remarks: 'fix it' });

    const afterReturn = await getItem(item.id);
    expect(afterReturn.ho_process).toBe('Returned for Correction');
    expect(afterReturn.ho_actioned_by).toBe(ctx.ho1Mobile);

    const resubmitReq = {
      params: { itemId: item.id },
      body: { req_amount: 6000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const resubmitRes = mockRes();
    await resubmitLineItem(resubmitReq, resubmitRes);

    expect(resubmitRes.statusCode).toBe(200); // no 500/CHECK violation
    expect(resubmitRes.jsonData.item.ho_process).toBeNull();
    expect(resubmitRes.jsonData.item.ho_actioned_by).toBeNull();
    expect(resubmitRes.jsonData.item.last_ho_process).toBe('Returned for Correction');
    expect(resubmitRes.jsonData.item.last_ho_actioned_by).toBe(ctx.ho1Mobile);
    expect(resubmitRes.jsonData.item.revision_number).toBe(1);
  });

  // ── Test 4 — updateLineItem gate (B3 regression) ──
  test('Test 4: updateLineItem gate allows Returned-for-Correction path, strips HO fields, blocks On Hold', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const item1Res = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 4000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item1 = item1Res.jsonData.item;
    ctx.itemIds.push(item1.id);

    const item2Res = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 3000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item2 = item2Res.jsonData.item;
    ctx.itemIds.push(item2.id);

    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    await callActOnLineItem(item1.id, ctx.ho1Mobile, { action: 'Return', ho_remarks: 'fix amount' });

    // Sheet Submitted, item1 Returned for Correction — allowed
    const update1Req = {
      params: { sheetId: sheet.id, itemId: item1.id },
      body: { req_amount: 4000 },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const update1Res = mockRes();
    await updateLineItem(update1Req, update1Res);
    expect(update1Res.statusCode).toBe(200);

    // ho_process is not part of accountsLineItemBody — silently stripped by validate(), never reaches the UPDATE
    const update2Req = {
      params: { sheetId: sheet.id, itemId: item1.id },
      body: { req_amount: 4000, ho_process: 'Approved' },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const update2Res = mockRes();
    await updateLineItem(update2Req, update2Res);
    expect(update2Res.statusCode).toBe(200);
    const reloaded = await getItem(item1.id);
    expect(reloaded.ho_process).toBe('Returned for Correction'); // stripped, not overwritten

    // Sheet Submitted, item2 On Hold (not Returned) — blocked
    await callActOnLineItem(item2.id, ctx.ho1Mobile, { action: 'Hold', ho_remarks: 'checking' });
    const update3Req = {
      params: { sheetId: sheet.id, itemId: item2.id },
      body: { req_amount: 3500 },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const update3Res = mockRes();
    await updateLineItem(update3Req, update3Res);
    expect(update3Res.statusCode).toBe(403);
  });

  // ── Test 5 — Concurrent sheet creation (B4 regression) ──
  test('Test 5: concurrent createSheet calls never collide on sheet_number', async () => {
    const results = await Promise.all(
      Array(10).fill().map(() => callCreateSheet(ctx.accountsMobile))
    );
    results.forEach(r => expect(r.statusCode).toBe(201));
    const sheetNumbers = results.map(r => r.jsonData.sheet.sheet_number);
    results.forEach(r => ctx.sheetIds.push(r.jsonData.sheet.id));
    expect(new Set(sheetNumbers).size).toBe(sheetNumbers.length);
  });

  // ── Test 6 — exportBulkNeft validation ──
  test('Test 6: exportBulkNeft enforces sheet/payment-mode/status validations', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);
    const otherSheetRes = await callCreateSheet(ctx.accountsMobile);
    const otherSheet = otherSheetRes.jsonData.sheet;
    ctx.sheetIds.push(otherSheet.id);

    const otherSheetItemRes = await callAddLineItem(otherSheet.id, ctx.accountsMobile, {
      req_amount: 1000, payment_mode: 'Bulk NEFT', debit_bank_ac_type: ctx.bankName
    });
    const otherSheetItem = otherSheetItemRes.jsonData.item;
    ctx.itemIds.push(otherSheetItem.id);

    const pendingNeftRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1200, payment_mode: 'Bulk NEFT', debit_bank_ac_type: ctx.bankName
    });
    const pendingNeftItem = pendingNeftRes.jsonData.item;
    ctx.itemIds.push(pendingNeftItem.id);

    const chequeItemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 900, payment_mode: 'Cheque', cheque_no: '000123', cheque_date: '2026-08-16', debit_bank_ac_type: ctx.bankName
    });
    const chequeItem = chequeItemRes.jsonData.item;
    ctx.itemIds.push(chequeItem.id);

    const approvedNeftRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1500, payment_mode: 'Bulk NEFT', debit_bank_ac_type: ctx.bankName
    });
    const approvedNeftItem = approvedNeftRes.jsonData.item;
    ctx.itemIds.push(approvedNeftItem.id);

    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    await callActOnLineItem(chequeItem.id, ctx.ho1Mobile, { action: 'Approve' });
    await callActOnLineItem(approvedNeftItem.id, ctx.ho1Mobile, { action: 'Approve' });

    async function callExport(sheetId, itemIds) {
      const req = { params: { sheetId }, body: { item_ids: itemIds }, user: { role: 'accounts', mobile_number: ctx.accountsMobile } };
      const res = mockRes();
      await exportBulkNeft(req, res);
      return res;
    }

    const wrongSheetRes = await callExport(sheet.id, [otherSheetItem.id]);
    expect(wrongSheetRes.statusCode).toBe(400);

    const notApprovedRes = await callExport(sheet.id, [pendingNeftItem.id]);
    expect(notApprovedRes.statusCode).toBe(400);

    const notBulkNeftRes = await callExport(sheet.id, [chequeItem.id]);
    expect(notBulkNeftRes.statusCode).toBe(400);

    const validRes = await callExport(sheet.id, [approvedNeftItem.id]);
    expect(validRes.statusCode).toBe(200);
    // Success now streams the real .xlsx (bulkNeftExport.service.js), not a JSON
    // { exportedItemIds } body — assert the binary contract and that the
    // neft_exported flag update (unchanged logic) actually landed instead.
    expect(validRes.headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(Buffer.isBuffer(validRes.body)).toBe(true);
    expect(validRes.body.length).toBeGreaterThan(0);

    const exportedItem = await getItem(approvedNeftItem.id);
    expect(exportedItem.neft_exported).toBe(true);
  });

  // ── Test 7 — deleteLineItem trigger gate (NB3 regression) ──
  test('Test 7: DELETE allowed pre-submission, blocked once submitted (DB-level backstop)', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 5000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;
    expect((await getItem(item.id)).requisition_status).toBeNull();

    const deleteReq = { params: { sheetId: sheet.id, itemId: item.id }, user: { role: 'accounts', mobile_number: ctx.accountsMobile } };
    const deleteRes = mockRes();
    await deleteLineItem(deleteReq, deleteRes);
    expect(deleteRes.statusCode).toBe(200); // trigger RETURN OLD, DELETE proceeds

    const item2Res = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 3000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item2 = item2Res.jsonData.item;
    ctx.itemIds.push(item2.id);
    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    expect((await getItem(item2.id)).requisition_status).toBe('Pending HO Review');

    // Simulate a controller bug bypassing the app-layer gate: direct DB DELETE.
    const { error } = await supabase.from('acct_requisition_line_items').delete().eq('id', item2.id);
    expect(error).toBeTruthy();
    expect(error.message).toMatch(/Hard deletion of submitted acct_requisition_line_items/i);
  });

  // ── Test 8 — Repeat reopen audit label (S5 regression) ──
  test('Test 8: REOPEN audit action fires on every reopen cycle, not just the first', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 2000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;
    ctx.itemIds.push(item.id);
    await callSubmitSheet(sheet.id, ctx.accountsMobile);

    async function reopen(remark) {
      const req = {
        params: { itemId: item.id },
        body: { reopen_remark: remark },
        user: { role: 'ho', mobile_number: ctx.ho2Mobile, permissions: { 'ho.requisition.reopen': true } }
      };
      const res = mockRes();
      await reopenLineItem(req, res);
      return res;
    }

    await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Reject', ho_remarks: 'first reject' });
    expect((await reopen('First reopen')).statusCode).toBe(200);
    await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Reject', ho_remarks: 'second reject' });
    expect((await reopen('Second reopen')).statusCode).toBe(200);
    await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Approve' });

    const { data: log } = await supabase
      .from('audit_log')
      .select('action')
      .eq('record_identifier', item.id)
      .order('timestamp', { ascending: true });

    const actions = log.map(l => l.action);
    expect(actions.filter(a => a === 'REOPEN').length).toBe(2);
    expect(actions).not.toContain('PENDING_HO_REVIEW_ENTER');
  });

  // ── Test 9 — Indian Banks master list validation (S6 regression) ──
  test('Test 9: upsertBeneficiary rejects unrecognized bank names, accepts recognized ones', async () => {
    const acNo = `ACNO_${crypto.randomUUID().substring(0, 8)}`;

    const badReq = {
      body: {
        account_number: acNo,
        ifsc: 'SBIN0001234',
        beneficiary_name: 'Acme Corp',
        beneficiary_bank_name: 'Fictitious Bank of Nowhere'
      },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const badRes = mockRes();
    await upsertBeneficiary(badReq, badRes);
    expect(badRes.statusCode).toBe(400);
    expect(badRes.jsonData.message).toMatch(/recognized bank from the Indian Banks Master List/i);

    const goodReq = {
      body: {
        account_number: acNo,
        ifsc: 'SBIN0001234',
        beneficiary_name: 'Acme Corp',
        beneficiary_bank_name: 'State Bank of India'
      },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const goodRes = mockRes();
    await upsertBeneficiary(goodReq, goodRes);
    expect(goodRes.statusCode).toBe(200);
  });
});
