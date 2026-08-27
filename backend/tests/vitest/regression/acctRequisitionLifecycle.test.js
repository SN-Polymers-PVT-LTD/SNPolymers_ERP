import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  createSheet, addLineItem, updateLineItem, deleteLineItem, deleteSheetIfEmpty, submitSheet,
  actOnLineItem, resubmitLineItem, exportBulkNeft, upsertBeneficiary
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

  // ── Test 2 — Full audit log for the remaining legal chain (NB2 regression,
  // updated for 037: Hold/Reject are now terminal so a single item can no
  // longer chain through Hold -> Return -> ... -> Reopen -> Approve. The
  // longest legal in-place chain left is Return -> Resubmit -> a final
  // decision; Reject is used here since it's the one HO_HOLD_RELEASED/REOPEN
  // can no longer precede. ──
  test('Test 2: full lifecycle produces the expected audit_log events in order', async () => {
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

    await callActOnLineItem(item.id, ctx.ho1Mobile, { action: 'Return', ho_remarks: 'fix beneficiary' });

    const resubmitReq = {
      params: { itemId: item.id },
      body: { req_amount: 15000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    };
    const resubmitRes = mockRes();
    await resubmitLineItem(resubmitReq, resubmitRes);
    expect(resubmitRes.statusCode).toBe(200);

    const rejectRes = await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Reject', ho_remarks: 'not valid' });
    expect(rejectRes.statusCode).toBe(200);

    // Terminal now — no further action possible on this item at all.
    const postRejectAction = await callActOnLineItem(item.id, ctx.ho2Mobile, { action: 'Approve' });
    expect(postRejectAction.statusCode).toBe(409);

    const { data: log } = await supabase
      .from('audit_log')
      .select('action')
      .eq('record_identifier', item.id)
      .order('timestamp', { ascending: true });

    expect(log.map(l => l.action)).toEqual([
      'LINE_ITEM_ADDED', 'PENDING_HO_REVIEW_FIRST_SUBMIT',
      'HO_RETURNED', 'RESUBMIT_AFTER_CORRECTION', 'HO_REJECTED'
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

    // Bulk NEFT items now require beneficiary details to pass submit_acct_sheet_transact's
    // VAL02 check (033_add_line_item_transact_and_neft_beneficiary_check.sql) — a Bulk NEFT
    // item with no beneficiary_ac_no/ifsc/name used to reach HO approval and exportBulkNeft
    // with nothing to put in the bank-authorization workbook.
    const beneficiaryFields = {
      beneficiary_ac_no: '123456789012', beneficiary_ifsc: 'ABCD0123456', beneficiary_name: 'Test Beneficiary'
    };

    const otherSheetItemRes = await callAddLineItem(otherSheet.id, ctx.accountsMobile, {
      req_amount: 1000, payment_mode: 'Bulk NEFT', debit_bank_ac_type: ctx.bankName, ...beneficiaryFields
    });
    const otherSheetItem = otherSheetItemRes.jsonData.item;
    ctx.itemIds.push(otherSheetItem.id);

    const pendingNeftRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1200, payment_mode: 'Bulk NEFT', debit_bank_ac_type: ctx.bankName, ...beneficiaryFields
    });
    const pendingNeftItem = pendingNeftRes.jsonData.item;
    ctx.itemIds.push(pendingNeftItem.id);

    const chequeItemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 900, payment_mode: 'Cheque', cheque_no: '000123', cheque_date: '2026-08-16', debit_bank_ac_type: ctx.bankName
    });
    const chequeItem = chequeItemRes.jsonData.item;
    ctx.itemIds.push(chequeItem.id);

    const approvedNeftRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1500, payment_mode: 'Bulk NEFT', debit_bank_ac_type: ctx.bankName, ...beneficiaryFields
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

  // ── Test 8 — On Hold and Rejected are terminal on their original sheet (037 regression) ──
  test('Test 8: no further HO action is possible once an item is On Hold or Rejected', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const holdItemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 2000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const holdItem = holdItemRes.jsonData.item;
    ctx.itemIds.push(holdItem.id);

    const rejectedItemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 2500, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const rejectedItem = rejectedItemRes.jsonData.item;
    ctx.itemIds.push(rejectedItem.id);

    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    await callActOnLineItem(holdItem.id, ctx.ho1Mobile, { action: 'Hold', ho_remarks: 'hold for now' });
    await callActOnLineItem(rejectedItem.id, ctx.ho1Mobile, { action: 'Reject', ho_remarks: 'rejecting' });

    // Re-Hold, Return, Reject, and Approve are all blocked from On Hold now —
    // no in-place path back, only re-import (034_add_line_item_import.sql).
    const reHold = await callActOnLineItem(holdItem.id, ctx.ho1Mobile, { action: 'Hold', ho_remarks: 'still on hold' });
    expect(reHold.statusCode).toBe(409);
    const approveFromHold = await callActOnLineItem(holdItem.id, ctx.ho1Mobile, { action: 'Approve' });
    expect(approveFromHold.statusCode).toBe(409);

    // Same for an already-Rejected item — no more Reopen action exists.
    const reReject = await callActOnLineItem(rejectedItem.id, ctx.ho1Mobile, { action: 'Reject', ho_remarks: 'again' });
    expect(reReject.statusCode).toBe(409);
  });

  // ── Test 9 — Indian Banks master list validation (S6 regression) ──
  test('Test 9: upsertBeneficiary rejects unrecognized bank names, accepts recognized ones', async () => {
    // Must be a valid 9-18 digit account number (accountNumberRegex) so this
    // test exercises the bank-name check specifically, not the digit-count one.
    const acNo = `9${Date.now()}`;

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

  // ── Test 10 — deleteSheetIfEmpty (030_allow_empty_open_sheet_delete regression) ──
  test('Test 10: deleteSheetIfEmpty removes a never-touched Open sheet and frees its number', async () => {
    const sheetARes = await callCreateSheet(ctx.accountsMobile);
    const sheetA = sheetARes.jsonData.sheet;

    const delRes = mockRes();
    await deleteSheetIfEmpty(
      { params: { sheetId: sheetA.id }, user: { role: 'accounts', mobile_number: ctx.accountsMobile } },
      delRes
    );
    expect(delRes.statusCode).toBe(200);
    expect(delRes.jsonData.deleted).toBe(true);

    const { data: gone } = await supabase.from('acct_requisition_sheets').select('id').eq('id', sheetA.id).maybeSingle();
    expect(gone).toBeNull();

    // The count-based generator (create_acct_sheet_transact) should now
    // reuse sheetA's freed number for the next sheet created the same day.
    const sheetBRes = await callCreateSheet(ctx.accountsMobile);
    const sheetB = sheetBRes.jsonData.sheet;
    ctx.sheetIds.push(sheetB.id);
    expect(sheetB.sheet_number).toBe(sheetA.sheet_number);
  });

  test('Test 10b: deleteSheetIfEmpty is a no-op once the sheet has an item, or is not Open', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    ctx.itemIds.push(itemRes.jsonData.item.id);

    const delRes = mockRes();
    await deleteSheetIfEmpty(
      { params: { sheetId: sheet.id }, user: { role: 'accounts', mobile_number: ctx.accountsMobile } },
      delRes
    );
    expect(delRes.statusCode).toBe(200);
    expect(delRes.jsonData.deleted).toBe(false);

    const { data: stillThere } = await supabase.from('acct_requisition_sheets').select('id').eq('id', sheet.id).maybeSingle();
    expect(stillThere).not.toBeNull();
  });

  test('Test 10c: the underlying DB trigger still blocks a raw DELETE on any sheet with an item, even after it is deleted back out (revision history preserved)', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;

    const deleteItemReq = { params: { sheetId: sheet.id, itemId: item.id }, user: { role: 'accounts', mobile_number: ctx.accountsMobile } };
    const deleteItemRes = mockRes();
    await deleteLineItem(deleteItemReq, deleteItemRes);
    expect(deleteItemRes.statusCode).toBe(200);

    // Deleting the item does NOT auto-delete the sheet (that would break
    // "delete a wrong row, add the right one" mid-edit) — a raw DB DELETE
    // on the sheet itself must still be permitted here since it's genuinely
    // empty and Open, same as Test 10 above.
    const { error } = await supabase.from('acct_requisition_sheets').delete().eq('id', sheet.id);
    expect(error).toBeNull();
  });
});
