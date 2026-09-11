import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const mockRes = require('../../helpers/mockRes');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  createSheet, addLineItem, submitSheet, actOnLineItem, getLineItems
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

async function callGetLineItems(query, mobile, role = 'accounts') {
  const req = { query, user: { role, mobile_number: mobile } };
  const res = mockRes();
  await getLineItems(req, res);
  return res;
}

describe('Accounts HO Approval — getLineItems combined filters + date range', () => {
  let ctx;
  let itemAlpha, itemBeta, itemGamma;
  let subTitleAlpha, subTitleBeta;
  let acAlpha, acBeta, acGamma;
  let day1, day2, day3;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();

    subTitleAlpha = `Freight Alpha ${ctx.id}`;
    subTitleBeta = `Rent Beta ${ctx.id}`;
    acAlpha = `1111${ctx.id}`;
    acBeta = `2222${ctx.id}`;
    acGamma = `3333${ctx.id}`;

    // Unique historical date range per test scenario to prevent cross-run collisions
    const seedNum = parseInt(ctx.id.replace(/\D/g, '').substring(0, 6) || '123456', 10);
    const uniqueYear = 2000 + (seedNum % 20); // 2000 - 2019
    const uniqueMonth = String(1 + (Math.floor(seedNum / 20) % 12)).padStart(2, '0');
    day1 = `${uniqueYear}-${uniqueMonth}-05`;
    day2 = `${uniqueYear}-${uniqueMonth}-10`;
    day3 = `${uniqueYear}-${uniqueMonth}-15`;

    const sheetRes = await callCreateSheet(ctx.accountsMobile);
    const sheet = sheetRes.jsonData.sheet;
    ctx.sheetIds.push(sheet.id);

    const itemARes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      account_sub_title_text: subTitleAlpha,
      beneficiary_ac_no: acAlpha,
      req_amount: 5000,
      payment_mode: 'NEFT',
      debit_bank_ac_type: ctx.bankName
    });
    itemAlpha = itemARes.jsonData.item;

    const itemBRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      account_sub_title_text: subTitleBeta,
      beneficiary_ac_no: acBeta,
      req_amount: 6000,
      payment_mode: 'NEFT',
      debit_bank_ac_type: ctx.bankName
    });
    itemBeta = itemBRes.jsonData.item;

    const itemGRes = await callAddLineItem(sheet.id, ctx.accountsMobile, {
      account_sub_title_text: subTitleAlpha,
      beneficiary_ac_no: acGamma,
      req_amount: 7000,
      payment_mode: 'NEFT',
      debit_bank_ac_type: ctx.bankName
    });
    itemGamma = itemGRes.jsonData.item;

    ctx.itemIds.push(itemAlpha.id, itemBeta.id, itemGamma.id);

    await callSubmitSheet(sheet.id, ctx.accountsMobile);

    // Approve two of them so requisition_status varies too (not required by
    // getLineItems's filters, but confirms the "requisition_status is not
    // null" gate doesn't accidentally exclude a still-Pending item).
    await callActOnLineItem(itemAlpha.id, ctx.ho1Mobile, { action: 'Approve' });
    await callActOnLineItem(itemBeta.id, ctx.ho1Mobile, { action: 'Approve' });
    // itemGamma stays Pending HO Review.

    // Backdate created_at directly — addLineItem always stamps "now", and
    // there's no API path to set a historical creation date, so the date
    // range test has to move the rows after the fact.
    await supabase.from('acct_requisition_line_items').update({ created_at: `${day1}T09:00:00.000Z` }).eq('id', itemAlpha.id);
    await supabase.from('acct_requisition_line_items').update({ created_at: `${day2}T09:00:00.000Z` }).eq('id', itemBeta.id);
    await supabase.from('acct_requisition_line_items').update({ created_at: `${day3}T09:00:00.000Z` }).eq('id', itemGamma.id);
  });

  afterAll(async () => {
    await cleanupAcctRequisitionScenario(ctx);
  });

  test('no filters: all three seeded items are present', async () => {
    const res = await callGetLineItems({ debit_bank_ac_type: ctx.bankName, limit: 100 }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([itemAlpha.id, itemBeta.id, itemGamma.id]));
  });

  test('single filter: account_sub_title alone matches both Alpha-titled items, not Beta', async () => {
    const res = await callGetLineItems({ account_sub_title: subTitleAlpha, limit: 100 }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([itemAlpha.id, itemGamma.id]));
    expect(ids).not.toContain(itemBeta.id);
  });

  test('combined filters (AND, not OR): account_sub_title + beneficiary_ac_no narrows to exactly one row', async () => {
    // Both Alpha and Gamma share the sub-title; only Gamma has this account
    // number. If the filters were OR'd instead of AND'd, Alpha would also
    // show up here (it matches the sub-title filter alone).
    const res = await callGetLineItems({
      account_sub_title: subTitleAlpha,
      beneficiary_ac_no: acGamma,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual([itemGamma.id]);
  });

  test('combined filters: account_sub_title + debit_bank_ac_type + date range all apply together', async () => {
    // All three items share debit_bank_ac_type and the sub-title filter
    // matches Alpha+Gamma, but the date range only covers day1 (Alpha) —
    // confirms all three filter types compose as a single AND query rather
    // than any one of them silently overriding the others.
    const res = await callGetLineItems({
      account_sub_title: subTitleAlpha,
      debit_bank_ac_type: ctx.bankName,
      date_from: day1,
      date_to: day1,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual([itemAlpha.id]);
  });

  test('a filter combination matching nothing returns an empty list, not an error or the unfiltered set', async () => {
    const res = await callGetLineItems({
      account_sub_title: subTitleBeta,
      beneficiary_ac_no: acGamma, // belongs to Gamma, not Beta
      limit: 100
    }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    expect(res.jsonData.items).toEqual([]);
  });

  test('date range: from/to spanning all three days includes all three', async () => {
    const res = await callGetLineItems({
      debit_bank_ac_type: ctx.bankName,
      date_from: day1,
      date_to: day3,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([itemAlpha.id, itemBeta.id, itemGamma.id]));
  });

  test('date range: from/to narrowed to just day2 includes only Beta', async () => {
    const res = await callGetLineItems({
      debit_bank_ac_type: ctx.bankName,
      date_from: day2,
      date_to: day2,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual([itemBeta.id]);
  });

  test('date range: date_to boundary is inclusive of the whole day (end-of-day, not midnight cutoff)', async () => {
    // itemGamma is stamped 09:00 UTC on day3. A naive lte('created_at', day3)
    // comparison (implicit cast to midnight 00:00:00) would exclude it —
    // the controller must push date_to to T23:59:59.999 to include it.
    const res = await callGetLineItems({
      debit_bank_ac_type: ctx.bankName,
      date_from: day3,
      date_to: day3,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual([itemGamma.id]);
  });

  test('date range: date_from-only excludes earlier days but includes later ones', async () => {
    const res = await callGetLineItems({
      debit_bank_ac_type: ctx.bankName,
      date_from: day2,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([itemBeta.id, itemGamma.id]));
    expect(ids).not.toContain(itemAlpha.id);
  });

  test('date range: date_to-only excludes later days but includes earlier ones', async () => {
    const res = await callGetLineItems({
      debit_bank_ac_type: ctx.bankName,
      date_to: day2,
      limit: 100
    }, ctx.accountsMobile);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([itemAlpha.id, itemBeta.id]));
    expect(ids).not.toContain(itemGamma.id);
  });

  test('a date range outside all seeded items returns an empty list', async () => {
    const res = await callGetLineItems({
      debit_bank_ac_type: ctx.bankName,
      date_from: '1995-02-01',
      date_to: '1995-02-28',
      limit: 100
    }, ctx.accountsMobile);
    expect(res.jsonData.items).toEqual([]);
  });

  test('export=true ignores pagination and returns matching rows without a pagination block', async () => {
    const res = await callGetLineItems({
      account_sub_title: subTitleAlpha,
      debit_bank_ac_type: ctx.bankName,
      export: 'true'
    }, ctx.accountsMobile);
    expect(res.statusCode).toBe(200);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual(expect.arrayContaining([itemAlpha.id, itemGamma.id]));
    expect(res.jsonData.pagination).toBeUndefined();
  });

  test('ho role can query the same endpoint and sees the same combined-filter results as accounts', async () => {
    const res = await callGetLineItems({
      account_sub_title: subTitleAlpha,
      beneficiary_ac_no: acGamma,
      limit: 100
    }, ctx.ho1Mobile, 'ho');
    expect(res.statusCode).toBe(200);
    const ids = res.jsonData.items.map(i => i.id);
    expect(ids).toEqual([itemGamma.id]);
  });

  test('each returned item carries its parent sheet_number/sheet_status for display', async () => {
    const res = await callGetLineItems({ account_sub_title: subTitleBeta, limit: 100 }, ctx.accountsMobile);
    const item = res.jsonData.items.find(i => i.id === itemBeta.id);
    expect(item.sheet_number).toBeTruthy();
    expect(item.sheet_status).toBeTruthy();
  });
});
