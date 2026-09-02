import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  createSheet, addLineItem, submitSheet, actOnLineItem, closeSheetReview,
  getImportEligibleItems, importLineItem
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

async function callActOnLineItem(itemId, mobile, body) {
  const req = { params: { itemId }, body, user: { role: 'ho', mobile_number: mobile, permissions: {} } };
  const res = mockRes();
  await actOnLineItem(req, res);
  return res;
}

async function callCloseSheetReview(sheetId, mobile) {
  const req = { params: { sheetId }, user: { role: 'ho', mobile_number: mobile, permissions: {} } };
  const res = mockRes();
  await closeSheetReview(req, res);
  return res;
}

async function callGetEligible(query, mobile) {
  const req = { query, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await getImportEligibleItems(req, res);
  return res;
}

async function callImportLineItem(itemId, targetSheetId, mobile) {
  const req = { params: { itemId }, body: { target_sheet_id: targetSheetId }, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await importLineItem(req, res);
  return res;
}

async function getItem(itemId) {
  const { data } = await supabase.from('acct_requisition_line_items').select('*').eq('id', itemId).single();
  return data;
}

async function getSheetStatus(sheetId) {
  const { data } = await supabase.from('acct_requisition_sheets').select('sheet_status').eq('id', sheetId).single();
  return data.sheet_status;
}

// Creates and submits a sheet with `count` fresh line items, all left at
// 'Pending HO Review' (i.e. nothing decided yet) — the starting point for
// most Close Review scenarios below.
async function makeSubmittedSheet(ctx, count = 1) {
  const sheetRes = await callCreateSheet(ctx.accountsMobile);
  const sheet = sheetRes.jsonData.sheet;
  ctx.sheetIds.push(sheet.id);

  const items = [];
  for (let i = 0; i < count; i++) {
    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 1000 + i, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;
    ctx.itemIds.push(item.id);
    items.push(item);
  }

  await callSubmitSheet(sheet.id, ctx.accountsMobile);
  return { sheet, items };
}

describe('Accounts HO Approval — Close Review & Pending Review rollover (041)', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
  });

  test('closing review on an Open sheet is rejected (STA08/409)', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    ctx.sheetIds.push(sheetRes.jsonData.sheet.id);

    const res = await callCloseSheetReview(sheetRes.jsonData.sheet.id, ctx.ho1Mobile);
    expect(res.statusCode).toBe(409);
  });

  test('closing review on an already-Reviewed sheet is rejected (STA08/409)', async () => {
    const { sheet, items } = await makeSubmittedSheet(ctx, 1);
    await callActOnLineItem(items[0].id, ctx.ho1Mobile, { action: 'Approve' });
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');

    const res = await callCloseSheetReview(sheet.id, ctx.ho1Mobile);
    expect(res.statusCode).toBe(409);
  });

  test('core sweep: Approved/On Hold items are untouched, the still-pending item becomes Pending Review, sheet becomes Reviewed', async () => {
    const { sheet, items } = await makeSubmittedSheet(ctx, 3);
    await callActOnLineItem(items[0].id, ctx.ho1Mobile, { action: 'Approve' });
    await callActOnLineItem(items[1].id, ctx.ho1Mobile, { action: 'Hold', ho_remarks: 'need info' });
    // items[2] left untouched at 'Pending HO Review'.

    const res = await callCloseSheetReview(sheet.id, ctx.ho1Mobile);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.sheet.sheet_status).toBe('Reviewed');

    const approved = await getItem(items[0].id);
    const held = await getItem(items[1].id);
    const swept = await getItem(items[2].id);
    expect(approved.requisition_status).toBe('Approved');
    expect(held.requisition_status).toBe('On Hold');
    expect(swept.requisition_status).toBe('Pending Review');
  });

  test('zero-remaining edge case: every item already decided — closing review still succeeds as a no-op', async () => {
    const { sheet, items } = await makeSubmittedSheet(ctx, 1);
    await callActOnLineItem(items[0].id, ctx.ho1Mobile, { action: 'Approve' });
    expect(await getSheetStatus(sheet.id)).toBe('Reviewed');

    // Force the sheet back to Submitted so the STA08 guard doesn't fire —
    // isolates the "0 rows swept" branch of the RPC itself.
    await supabase.from('acct_requisition_sheets').update({ sheet_status: 'Submitted' }).eq('id', sheet.id);

    const res = await callCloseSheetReview(sheet.id, ctx.ho1Mobile);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.sheet.sheet_status).toBe('Reviewed');

    const item = await getItem(items[0].id);
    expect(item.requisition_status).toBe('Approved');
  });

  test('swept item appears in the import-eligible queue', async () => {
    const { sheet, items } = await makeSubmittedSheet(ctx, 1);
    await callCloseSheetReview(sheet.id, ctx.ho1Mobile);

    const res = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const eligible = res.jsonData.items.find(i => i.id === items[0].id);
    expect(eligible).toBeTruthy();
    expect(eligible.requisition_status).toBe('Pending Review');
  });

  test('swept item can be imported into a new sheet, same as On Hold/Rejected', async () => {
    const { sheet, items } = await makeSubmittedSheet(ctx, 1);
    const source = items[0];
    await callCloseSheetReview(sheet.id, ctx.ho1Mobile);

    const targetSheetRes = await callCreateSheet(ctx.accountsMobile);
    const targetSheet = targetSheetRes.jsonData.sheet;
    ctx.sheetIds.push(targetSheet.id);

    const importRes = await callImportLineItem(source.id, targetSheet.id, ctx.accountsMobile);
    expect(importRes.statusCode).toBe(201);

    const newItem = importRes.jsonData.item;
    ctx.itemIds.push(newItem.id);
    expect(newItem.sheet_id).toBe(targetSheet.id);
    expect(newItem.imported_from_item_id).toBe(source.id);
    expect(Number(newItem.req_amount)).toBe(Number(source.req_amount));

    const refetchedSource = await getItem(source.id);
    expect(refetchedSource.imported_to_sheet_id).toBe(targetSheet.id);
    expect(refetchedSource.requisition_status).toBe('Pending Review');
  });

  test("Returned for Correction isolation: close-review doesn't touch a Returned item, and it can still be resubmitted to reopen the sheet", async () => {
    const { sheet, items } = await makeSubmittedSheet(ctx, 2);
    await callActOnLineItem(items[0].id, ctx.ho1Mobile, { action: 'Return', ho_remarks: 'fix beneficiary' });
    // items[1] left untouched at 'Pending HO Review'.

    const res = await callCloseSheetReview(sheet.id, ctx.ho1Mobile);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.sheet.sheet_status).toBe('Reviewed');

    const returned = await getItem(items[0].id);
    const swept = await getItem(items[1].id);
    expect(returned.requisition_status).toBe('Returned for Correction');
    expect(swept.requisition_status).toBe('Pending Review');

    await supabase.rpc('resubmit_acct_line_item_transact', {
      p_line_item_id: items[0].id, p_resubmitted_by: ctx.accountsMobile,
      p_req_amount: 100, p_payment_mode: 'NEFT', p_debit_bank_ac_type: ctx.bankName
    });
    expect(await getSheetStatus(sheet.id)).toBe('Submitted');
  });

  test('status filter: only Pending Review rows are returned, not other eligible statuses', async () => {
    const { sheet: sweptSheet, items: sweptItems } = await makeSubmittedSheet(ctx, 1);
    await callCloseSheetReview(sweptSheet.id, ctx.ho1Mobile);

    const { sheet: heldSheet, items: heldItems } = await makeSubmittedSheet(ctx, 1);
    await callActOnLineItem(heldItems[0].id, ctx.ho1Mobile, { action: 'Hold', ho_remarks: 'test' });

    const res = await callGetEligible({ status: 'Pending Review', limit: 100 }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toContain(sweptItems[0].id);
    expect(ids).not.toContain(heldItems[0].id);
    expect(res.jsonData.items.every(i => i.requisition_status === 'Pending Review')).toBe(true);
  });

  test('particulars filter: case-insensitive substring match on the new trigram index', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 500, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName,
      particulars: `CloseReviewParticularsSearch-${ctx.id}`
    });
    const item = itemRes.jsonData.item;
    ctx.itemIds.push(item.id);
    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    await callCloseSheetReview(sheet.id, ctx.ho1Mobile);

    const res = await callGetEligible({ particulars: `closereviewparticularssearch-${ctx.id}`, limit: 100 }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual([item.id]);
  });
});
