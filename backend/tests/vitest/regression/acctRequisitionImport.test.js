import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  createSheet, addLineItem, submitSheet, actOnLineItem,
  getImportEligibleItems, importLineItem, dismissImportEligibleItem
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

async function callDismissLineItem(itemId, mobile) {
  const req = { params: { itemId }, user: { role: 'accounts', mobile_number: mobile } };
  const res = mockRes();
  await dismissImportEligibleItem(req, res);
  return res;
}

async function getItem(itemId) {
  const { data } = await supabase.from('acct_requisition_line_items').select('*').eq('id', itemId).single();
  return data;
}

// Puts a fresh line item through submit + a non-approve HO action (Hold or
// Reject) so it lands in the eligible-for-import state this suite exercises.
async function makeDecidedItem(ctx, action, body) {
  const sheetRes = await callCreateSheet(ctx.accountsMobile);
  const sheet = sheetRes.jsonData.sheet;
  ctx.sheetIds.push(sheet.id);

  const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
    req_amount: 5000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName, ...body
  });
  const item = itemRes.jsonData.item;
  ctx.itemIds.push(item.id);

  await callSubmitSheet(sheet.id, ctx.accountsMobile);
  await callActOnLineItem(item.id, ctx.ho1Mobile, { action, ho_remarks: `${action} for import test` });

  return { sheet, item: await getItem(item.id) };
}

describe('Accounts HO Approval — import On Hold/Rejected items into a new sheet', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
  });

  test('On Hold and Rejected items appear in the eligible list; Pending/Approved items do not', async () => {
    const { item: onHoldItem } = await makeDecidedItem(ctx, 'Hold');
    const { item: rejectedItem } = await makeDecidedItem(ctx, 'Reject');

    const pendingSheetRes = await callCreateSheet(ctx.accountsMobile);
    const pendingSheet = pendingSheetRes.jsonData.sheet;
    ctx.sheetIds.push(pendingSheet.id);
    const pendingItemRes = await callAddLineItem(pendingSheet.id, ctx.accountsMobile, {
      req_amount: 2000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    ctx.itemIds.push(pendingItemRes.jsonData.item.id);
    await callSubmitSheet(pendingSheet.id, ctx.accountsMobile);

    const res = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toContain(onHoldItem.id);
    expect(ids).toContain(rejectedItem.id);
    expect(ids).not.toContain(pendingItemRes.jsonData.item.id);
  });

  test('successful import copies all fields, sets imported_from_item_id, and marks the source imported', async () => {
    const { item: source } = await makeDecidedItem(ctx, 'Hold', {
      particulars: 'Import test particulars',
      account_sub_title_text: 'Import Sub Title'
    });

    const targetSheetRes = await callCreateSheet(ctx.accountsMobile);
    const targetSheet = targetSheetRes.jsonData.sheet;
    ctx.sheetIds.push(targetSheet.id);

    const importRes = await callImportLineItem(source.id, targetSheet.id, ctx.accountsMobile);
    expect(importRes.statusCode).toBe(201);

    const newItem = importRes.jsonData.item;
    ctx.itemIds.push(newItem.id);
    expect(newItem.sheet_id).toBe(targetSheet.id);
    expect(newItem.imported_from_item_id).toBe(source.id);
    expect(newItem.requisition_status).toBeNull();
    expect(Number(newItem.req_amount)).toBe(Number(source.req_amount));
    expect(newItem.payment_mode).toBe(source.payment_mode);
    expect(newItem.debit_bank_ac_type).toBe(source.debit_bank_ac_type);
    expect(newItem.particulars).toBe(source.particulars);
    expect(newItem.account_sub_title_text).toBe(source.account_sub_title_text);

    const refetchedSource = await getItem(source.id);
    expect(refetchedSource.imported_to_sheet_id).toBe(targetSheet.id);
    expect(refetchedSource.imported_at).toBeTruthy();
    expect(refetchedSource.imported_by).toBe(ctx.accountsMobile);
    // Source stays exactly as it was, HO decision included.
    expect(refetchedSource.requisition_status).toBe('On Hold');
    expect(refetchedSource.ho_process).toBe(source.ho_process);
    expect(Number(refetchedSource.req_amount)).toBe(Number(source.req_amount));
  });

  test('double-import on the same source is rejected (STA06/409)', async () => {
    const { item: source } = await makeDecidedItem(ctx, 'Reject');

    const sheetARes = await callCreateSheet(ctx.accountsMobile);
    ctx.sheetIds.push(sheetARes.jsonData.sheet.id);
    const firstImport = await callImportLineItem(source.id, sheetARes.jsonData.sheet.id, ctx.accountsMobile);
    expect(firstImport.statusCode).toBe(201);
    ctx.itemIds.push(firstImport.jsonData.item.id);

    const sheetBRes = await callCreateSheet(ctx.accountsMobile);
    ctx.sheetIds.push(sheetBRes.jsonData.sheet.id);
    const secondImport = await callImportLineItem(source.id, sheetBRes.jsonData.sheet.id, ctx.accountsMobile);
    expect(secondImport.statusCode).toBe(409);
  });

  test('import into a non-Open sheet is rejected (STA05/409)', async () => {
    const { item: source } = await makeDecidedItem(ctx, 'Hold');

    const targetSheetRes = await callCreateSheet(ctx.accountsMobile);
    const targetSheet = targetSheetRes.jsonData.sheet;
    ctx.sheetIds.push(targetSheet.id);
    // Give the target sheet an item and submit it so it's no longer Open.
    const fillerItemRes = await callAddLineItem(targetSheet.id, ctx.accountsMobile, {
      req_amount: 1000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    ctx.itemIds.push(fillerItemRes.jsonData.item.id);
    await callSubmitSheet(targetSheet.id, ctx.accountsMobile);

    const res = await callImportLineItem(source.id, targetSheet.id, ctx.accountsMobile);
    expect(res.statusCode).toBe(409);
  });

  test('import of an ineligible-status item is rejected (VAL05/400)', async () => {
    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);
    const itemRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      req_amount: 3000, payment_mode: 'NEFT', debit_bank_ac_type: ctx.bankName
    });
    const item = itemRes.jsonData.item;
    ctx.itemIds.push(item.id);
    await callSubmitSheet(sheet.id, ctx.accountsMobile);
    // item.requisition_status is now 'Pending HO Review', not On Hold/Rejected.

    const targetSheetRes = await callCreateSheet(ctx.accountsMobile);
    ctx.sheetIds.push(targetSheetRes.jsonData.sheet.id);

    const res = await callImportLineItem(item.id, targetSheetRes.jsonData.sheet.id, ctx.accountsMobile);
    expect(res.statusCode).toBe(400);
  });

  test('dismiss removes an item from the eligible list without changing its other fields', async () => {
    const { item: source } = await makeDecidedItem(ctx, 'Hold');

    const beforeDismiss = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    expect(beforeDismiss.jsonData.items.map(i => i.id)).toContain(source.id);

    const dismissRes = await callDismissLineItem(source.id, ctx.accountsMobile);
    expect(dismissRes.statusCode).toBe(200);
    expect(dismissRes.jsonData.item.import_dismissed).toBe(true);
    expect(dismissRes.jsonData.item.import_dismissed_by).toBe(ctx.accountsMobile);
    expect(Number(dismissRes.jsonData.item.req_amount)).toBe(Number(source.req_amount));
    expect(dismissRes.jsonData.item.requisition_status).toBe('On Hold');

    const afterDismiss = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    expect(afterDismiss.jsonData.items.map(i => i.id)).not.toContain(source.id);
  });

  test('a dismissed item cannot be imported (STA07/409)', async () => {
    const { item: source } = await makeDecidedItem(ctx, 'Reject');
    await callDismissLineItem(source.id, ctx.accountsMobile);

    const targetSheetRes = await callCreateSheet(ctx.accountsMobile);
    ctx.sheetIds.push(targetSheetRes.jsonData.sheet.id);

    const res = await callImportLineItem(source.id, targetSheetRes.jsonData.sheet.id, ctx.accountsMobile);
    expect(res.statusCode).toBe(409);
  });

  test('dismissing an already-imported or already-dismissed item is rejected, not silently accepted', async () => {
    const { item: importedSource } = await makeDecidedItem(ctx, 'Hold');
    const targetSheetRes = await callCreateSheet(ctx.accountsMobile);
    ctx.sheetIds.push(targetSheetRes.jsonData.sheet.id);
    const importRes = await callImportLineItem(importedSource.id, targetSheetRes.jsonData.sheet.id, ctx.accountsMobile);
    ctx.itemIds.push(importRes.jsonData.item.id);

    const dismissAfterImport = await callDismissLineItem(importedSource.id, ctx.accountsMobile);
    expect(dismissAfterImport.statusCode).toBe(409);

    const { item: dismissedSource } = await makeDecidedItem(ctx, 'Reject');
    await callDismissLineItem(dismissedSource.id, ctx.accountsMobile);
    const dismissAgain = await callDismissLineItem(dismissedSource.id, ctx.accountsMobile);
    expect(dismissAgain.statusCode).toBe(409);
  });

  test('eligible list accumulates items from multiple distinct historical sheets in one call', async () => {
    const { sheet: sheetA, item: itemA } = await makeDecidedItem(ctx, 'Hold');
    const { sheet: sheetB, item: itemB } = await makeDecidedItem(ctx, 'Reject');
    expect(sheetA.id).not.toBe(sheetB.id);

    const res = await callGetEligible({ limit: 100 }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toContain(itemA.id);
    expect(ids).toContain(itemB.id);
  });
});
