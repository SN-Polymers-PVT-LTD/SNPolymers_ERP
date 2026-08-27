'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema, actOnLineItemsBatchSchema,
  resubmitLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  upsertParticularsSchema,
  upsertIndianBankSchema,
  exportNeftSchema,
  refreshIndianBanksCache
} = require('../validation/acctRequisition.schema');
const { buildBulkNeftWorkbook } = require('../services/bulkNeftExport.service');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Maps the custom ERRCODEs raised by the acct_requisition_* RPCs
 * (021_create_accounts_ho_approval.sql) to an HTTP status. Same inline-mapping
 * convention as fundRequests.controller.js's BUD02/EST01 handling — no shared
 * cross-controller helper in this codebase.
 */
function mapAcctRpcError(rpcErr) {
  switch (rpcErr.code) {
    case 'STA01':
    case 'STA03':
    case 'STA05':
    case 'STA06':
    case 'STA07':
      return { status: 409, message: rpcErr.message };
    case 'VAL01':
    case 'VAL02':
    case 'VAL03':
    case 'VAL04':
    case 'VAL05':
      return { status: 400, message: rpcErr.message };
    case 'BNK01':
      return { status: 404, message: rpcErr.message };
    case 'BAL01':
      return { status: 422, message: rpcErr.message };
    default:
      if (rpcErr.message && rpcErr.message.includes('not found')) {
        return { status: 404, message: rpcErr.message };
      }
      return null; // unmapped — caller should throw and fall through to 500
  }
}

// ============================================================================
// Sheets
// ============================================================================

/**
 * POST /acct-requisitions/sheets
 */
async function createSheet(req, res) {
  try {
    const p_date = req.body?.date || undefined;
    const { data, error: rpcErr } = await supabase.rpc('create_acct_sheet_transact', {
      p_created_by: req.user.mobile_number,
      ...(p_date ? { p_date } : {})
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    return res.status(201).json({ success: true, sheet: data, message: 'Requisition sheet created.' });
  } catch (error) {
    console.error(`createSheet failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create requisition sheet.' });
  }
}

/**
 * DELETE /acct-requisitions/sheets/:sheetId
 * Best-effort cleanup, called when the frontend leaves a sheet that's still
 * Open with zero line items — whether it was never touched or every item on
 * it was added then deleted. Deliberately NOT hooked into deleteLineItem
 * itself: deleting a row and then immediately adding a replacement in the
 * same session is normal editing, not abandonment, so the sheet must not
 * disappear out from under that flow. The DB trigger
 * (030_allow_empty_open_sheet_delete.sql) only permits deletion for this
 * exact still-Open-zero-items case, so this silently no-ops (still 200)
 * rather than erroring if the sheet is already gone, not Open, or no longer
 * empty by the time this runs.
 */
async function deleteSheetIfEmpty(req, res) {
  const { sheetId } = req.params;
  if (!uuidRegex.test(sheetId)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data: sheet, error: sheetErr } = await supabase
      .from('acct_requisition_sheets')
      .select('id, sheet_status')
      .eq('id', sheetId)
      .maybeSingle();
    if (sheetErr) throw sheetErr;
    // Distinct from "still exists but no longer eligible" below —
    // `alreadyGone: true` lets the caller tell "someone else discarded it
    // already" (a harmless race, not really a failure) apart from "it's not
    // empty/Open anymore" (a real reason this specific attempt can't do
    // anything). The auto-cleanup on leaving a sheet's own detail page and
    // this manual list-row Discard button can race exactly this way.
    if (!sheet) {
      return res.status(200).json({ success: true, deleted: false, alreadyGone: true });
    }
    if (sheet.sheet_status !== 'Open') {
      return res.status(200).json({ success: true, deleted: false, alreadyGone: false });
    }

    const { count, error: countErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('sheet_id', sheetId);
    if (countErr) throw countErr;
    if (count > 0) {
      return res.status(200).json({ success: true, deleted: false, alreadyGone: false });
    }

    // Restores eligibility on any item imported into this sheet before
    // deleting it (039_delete_empty_sheet_restores_imports.sql) — this
    // sheet has 0 current items, but if an imported copy was added and then
    // removed again before submit, the source item elsewhere still points
    // imported_to_sheet_id here, which would otherwise block the delete
    // outright (ON DELETE RESTRICT).
    const { data: restoredCount, error: deleteErr } = await supabase.rpc('delete_empty_acct_sheet_transact', {
      p_sheet_id: sheetId
    });
    if (deleteErr) throw deleteErr;

    return res.status(200).json({ success: true, deleted: true, restoredImportCount: restoredCount || 0 });
  } catch (error) {
    console.error(`deleteSheetIfEmpty failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to clean up empty sheet.' });
  }
}

/**
 * GET /acct-requisitions/sheets
 */
async function getSheets(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase.from('acct_requisition_sheets').select('*', { count: 'exact' });

    if (query.sheet_status && ['Open', 'Submitted', 'Reviewed'].includes(query.sheet_status)) {
      dbQuery = dbQuery.eq('sheet_status', query.sheet_status);
    }

    if (query.sheet_number) {
      dbQuery = dbQuery.ilike('sheet_number', `%${query.sheet_number}%`);
    }

    if (query.date_from) {
      dbQuery = dbQuery.gte('created_at', query.date_from);
    }

    if (query.date_to) {
      // date_to is a plain date (YYYY-MM-DD); push to end-of-day so the
      // filter includes the whole day rather than cutting off at midnight.
      dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);
    }

    const { data: sheets, count, error } = await dbQuery
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const sheetIds = (sheets || []).map(s => s.id);
    let statsMap = {};

    if (sheetIds.length > 0) {
      const { data: items, error: itemsErr } = await supabase
        .from('acct_requisition_line_items')
        .select('sheet_id, req_amount')
        .in('sheet_id', sheetIds);

      if (itemsErr) throw itemsErr;

      statsMap = (items || []).reduce((acc, item) => {
        const entry = acc[item.sheet_id] || { item_count: 0, total_req_amount: 0 };
        entry.item_count += 1;
        entry.total_req_amount += Number(item.req_amount) || 0;
        acc[item.sheet_id] = entry;
        return acc;
      }, {});
    }

    const enrichedSheets = (sheets || []).map(sheet => ({
      ...sheet,
      item_count: statsMap[sheet.id]?.item_count || 0,
      total_req_amount: statsMap[sheet.id]?.total_req_amount || 0
    }));

    const total = count || 0;
    return res.status(200).json({
      success: true,
      sheets: enrichedSheets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1)
      }
    });
  } catch (error) {
    console.error(`getSheets failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisition sheets.' });
  }
}

/**
 * GET /acct-requisitions/line-items
 * Flattened, cross-sheet search over requisition line items for the
 * "Requisition Details" filter view (Account Sub-title, Beneficiary A/c No.,
 * Debit Bank Account, date range) — shared by accounts and ho, unlike
 * getSheets/getSheetById which are sheet-scoped. Only items that have left
 * an Open sheet (requisition_status is set) count as "requisitions" here.
 *
 * `export=true` skips pagination and returns up to 5000 matching rows in one
 * shot, for the frontend's "export all filtered rows" button — same filters,
 * no page window.
 */
async function getLineItems(req, res) {
  try {
    const query = req.query || {};
    const isExport = query.export === 'true' || query.export === true;

    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('acct_requisition_line_items')
      .select('*', { count: 'exact' })
      .not('requisition_status', 'is', null);

    if (query.account_sub_title) {
      dbQuery = dbQuery.ilike('account_sub_title_text', `%${query.account_sub_title}%`);
    }

    if (query.beneficiary_ac_no) {
      dbQuery = dbQuery.ilike('beneficiary_ac_no', `%${query.beneficiary_ac_no}%`);
    }

    if (query.debit_bank_ac_type) {
      dbQuery = dbQuery.eq('debit_bank_ac_type', query.debit_bank_ac_type);
    }

    if (query.date_from) {
      dbQuery = dbQuery.gte('created_at', query.date_from);
    }

    if (query.date_to) {
      // date_to is a plain date (YYYY-MM-DD); push to end-of-day so the
      // filter includes the whole day rather than cutting off at midnight.
      dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);
    }

    dbQuery = dbQuery.order('created_at', { ascending: false });
    dbQuery = isExport ? dbQuery.limit(5000) : dbQuery.range(offset, offset + limit - 1);

    const { data: items, count, error } = await dbQuery;
    if (error) throw error;

    const sheetIds = [...new Set((items || []).map(i => i.sheet_id))];
    let sheetMap = {};

    if (sheetIds.length > 0) {
      const { data: sheets, error: sheetsErr } = await supabase
        .from('acct_requisition_sheets')
        .select('id, sheet_number, sheet_status')
        .in('id', sheetIds);
      if (sheetsErr) throw sheetsErr;

      sheetMap = (sheets || []).reduce((acc, s) => {
        acc[s.id] = s;
        return acc;
      }, {});
    }

    const enrichedItems = (items || []).map(item => ({
      ...item,
      sheet_number: sheetMap[item.sheet_id]?.sheet_number || null,
      sheet_status: sheetMap[item.sheet_id]?.sheet_status || null
    }));

    if (isExport) {
      return res.status(200).json({ success: true, items: enrichedItems });
    }

    const total = count || 0;
    return res.status(200).json({
      success: true,
      items: enrichedItems,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1)
      }
    });
  } catch (error) {
    console.error(`getLineItems failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisition line items.' });
  }
}

/**
 * GET /acct-requisitions/sheets/:sheetId
 */
async function getSheetById(req, res) {
  const { sheetId } = req.params;
  if (!uuidRegex.test(sheetId)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data: sheet, error: sheetErr } = await supabase
      .from('acct_requisition_sheets')
      .select('*')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetErr) throw sheetErr;
    if (!sheet) return res.status(404).json({ success: false, message: 'Requisition sheet not found.' });

    const { data: items, error: itemsErr } = await supabase
      .from('acct_requisition_line_items')
      .select('*')
      .eq('sheet_id', sheetId)
      .order('created_at', { ascending: true });

    if (itemsErr) throw itemsErr;

    return res.status(200).json({ success: true, sheet: { ...sheet, items: items || [] } });
  } catch (error) {
    console.error(`getSheetById failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisition sheet.' });
  }
}

// ============================================================================
// Line items — Accounts side
// ============================================================================

/**
 * POST /acct-requisitions/sheets/:sheetId/items
 * Gate (§4c): sheet_status === 'Open'.
 */
async function addLineItem(req, res) {
  if (!validate(req, res, addLineItemSchema)) return;
  const { sheetId } = req.params;

  try {
    // add_acct_line_item_transact (033_add_line_item_transact_and_neft_beneficiary_check.sql)
    // locks the sheet row FOR UPDATE before checking sheet_status, closing the race where a
    // concurrent submit could flip the sheet to 'Submitted' between a separate SELECT check
    // and this INSERT, stranding the new item with requisition_status = NULL.
    const { data: item, error: rpcErr } = await supabase.rpc('add_acct_line_item_transact', {
      p_sheet_id: sheetId,
      p_created_by: req.user.mobile_number,
      p_item: req.body
    });

    if (rpcErr) {
      if (rpcErr.message && rpcErr.message.includes('Sheet not found')) {
        return res.status(404).json({ success: false, message: 'Requisition sheet not found.' });
      }
      if (rpcErr.code === 'STA01') {
        return res.status(403).json({ success: false, message: rpcErr.message });
      }
      throw rpcErr;
    }

    return res.status(201).json({ success: true, item, message: 'Line item added.' });
  } catch (error) {
    console.error(`addLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to add line item.' });
  }
}

/**
 * PATCH /acct-requisitions/sheets/:sheetId/items/:itemId
 * Gate (§4c, B3 fix): sheet_status === 'Open' OR item.requisition_status === 'Returned for Correction'.
 * These are mutually exclusive by definition. In both cases only Accounts-side fields are
 * writable — accountsLineItemBody never contains ho_process, ho_actioned_by, last_ho_* fields, or is_reopened,
 * and validate() replaces req.body with the parsed (stripped-of-unknown-keys) Zod output, so
 * those fields can never reach this UPDATE regardless of what the caller sends.
 */
async function updateLineItem(req, res) {
  if (!validate(req, res, updateLineItemSchema)) return;
  const { sheetId, itemId } = req.params;

  try {
    const { data: sheet, error: sheetErr } = await supabase
      .from('acct_requisition_sheets')
      .select('id, sheet_status')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetErr) throw sheetErr;
    if (!sheet) return res.status(404).json({ success: false, message: 'Requisition sheet not found.' });

    const { data: item, error: itemErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id, sheet_id, requisition_status')
      .eq('id', itemId)
      .eq('sheet_id', sheetId)
      .maybeSingle();

    if (itemErr) throw itemErr;
    if (!item) return res.status(404).json({ success: false, message: 'Line item not found.' });

    const openPath = sheet.sheet_status === 'Open';
    const returnedPath = item.requisition_status === 'Returned for Correction';
    if (!openPath && !returnedPath) {
      return res.status(403).json({
        success: false,
        message: 'Line item can only be updated while its sheet is Open, or while the item is Returned for Correction.'
      });
    }

    const { data: updated, error: updateErr } = await supabase
      .from('acct_requisition_line_items')
      .update(req.body)
      .eq('id', itemId)
      .select()
      .single();

    if (updateErr) throw updateErr;

    return res.status(200).json({ success: true, item: updated, message: 'Line item updated.' });
  } catch (error) {
    console.error(`updateLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update line item.' });
  }
}

/**
 * DELETE /acct-requisitions/sheets/:sheetId/items/:itemId
 * Gate (§4c): sheet_status === 'Open'. (The DB trigger, NB3, additionally blocks any
 * DELETE once requisition_status IS NOT NULL — this app-layer gate keeps that state
 * unreachable via this endpoint, but the trigger remains the real backstop.)
 */
async function deleteLineItem(req, res) {
  const { sheetId, itemId } = req.params;
  if (!uuidRegex.test(sheetId) || !uuidRegex.test(itemId)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data: sheet, error: sheetErr } = await supabase
      .from('acct_requisition_sheets')
      .select('id, sheet_status')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetErr) throw sheetErr;
    if (!sheet) return res.status(404).json({ success: false, message: 'Requisition sheet not found.' });
    if (sheet.sheet_status !== 'Open') {
      return res.status(403).json({ success: false, message: 'Line items can only be deleted while the sheet is Open.' });
    }

    const { error: deleteErr } = await supabase
      .from('acct_requisition_line_items')
      .delete()
      .eq('id', itemId)
      .eq('sheet_id', sheetId);

    if (deleteErr) throw deleteErr;

    return res.status(200).json({ success: true, message: 'Line item deleted.' });
  } catch (error) {
    console.error(`deleteLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to delete line item.' });
  }
}

/**
 * POST /acct-requisitions/sheets/:sheetId/submit
 */
async function submitSheet(req, res) {
  const { sheetId } = req.params;
  if (!uuidRegex.test(sheetId)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data, error: rpcErr } = await supabase.rpc('submit_acct_sheet_transact', {
      p_sheet_id: sheetId,
      p_submitted_by: req.user.mobile_number
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) {
        // VAL02 here means some row's edits were only ever typed into the
        // form and never actually saved — submit_acct_sheet_transact
        // validates against the persisted row data, not whatever's still
        // sitting unsaved in the browser. Spelling that out avoids the
        // confusing "it failed, then I saved a draft, then it worked" loop.
        const message = rpcErr.code === 'VAL02'
          ? `${mapped.message} Click "Save Draft" first to persist any unsaved edits, then Submit Sheet again.`
          : mapped.message;
        return res.status(mapped.status).json({ success: false, message });
      }
      throw rpcErr;
    }

    const { notifyHoAcctSheetSubmitted } = require('../services/telegram.service');
    notifyHoAcctSheetSubmitted(data).catch(err => {
      console.error(`[ACCT SHEET] Telegram notification failed: ${err.message}`);
    });

    return res.status(200).json({ success: true, sheet: data, message: 'Requisition sheet submitted.' });
  } catch (error) {
    console.error(`submitSheet failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit requisition sheet.' });
  }
}

// ============================================================================
// Line items — HO side
// ============================================================================

/**
 * PATCH /acct-requisitions/items/:itemId/action
 * Gate (§4c, tightened by 037_terminal_hold_and_rejected.sql): fast-path
 * check requisition_status = 'Pending HO Review' before RPC. On Hold and
 * Rejected are terminal on their original sheet — re-import into a new
 * sheet (import_acct_line_item_transact) is the only way forward from
 * either, not a repeat action here.
 */
async function actOnLineItem(req, res) {
  if (!validate(req, res, actOnLineItemSchema)) return;
  const { itemId } = req.params;
  const { action, ho_pass_amount, ho_remarks } = req.body;

  try {
    const { data: item, error: itemErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id, requisition_status, debit_bank_ac_type, req_amount')
      .eq('id', itemId)
      .maybeSingle();

    if (itemErr) throw itemErr;
    if (!item) return res.status(404).json({ success: false, message: 'Line item not found.' });

    if (item.requisition_status !== 'Pending HO Review') {
      return res.status(409).json({
        success: false,
        message: `HO can only act on Pending HO Review items. Current: ${item.requisition_status}`
      });
    }

    let data, rpcErr;

    if (action === 'Approve' || action === 'PartiallyApprove') {
      ({ data, error: rpcErr } = await supabase.rpc('approve_acct_line_item_transact', {
        p_line_item_id: itemId,
        p_ho_process: action === 'Approve' ? 'Approved' : 'Partially Approved',
        p_ho_pass_amount: ho_pass_amount ?? null,
        p_actioned_by: req.user.mobile_number,
        p_ho_remarks: ho_remarks?.trim() || null
      }));
    } else {
      // Hold | Return | Reject
      ({ data, error: rpcErr } = await supabase.rpc('act_acct_line_item_non_approve_transact', {
        p_line_item_id: itemId,
        p_action: action,
        p_actioned_by: req.user.mobile_number,
        p_ho_remarks: ho_remarks?.trim() || null
      }));
    }

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) {
        if (rpcErr.code === 'BAL01') {
          const { data: bbm } = await supabase
            .from('bank_balance_master')
            .select('available_balance')
            .eq('bank_name', item.debit_bank_ac_type)
            .maybeSingle();
          const { notifyAcctBankBalanceInsufficient } = require('../services/telegram.service');
          notifyAcctBankBalanceInsufficient(
            item.debit_bank_ac_type,
            bbm?.available_balance ?? 0,
            ho_pass_amount ?? item.req_amount
          ).catch(err => {
            console.error(`[ACCT BANK] Telegram notification failed: ${err.message}`);
          });
        }
        return res.status(mapped.status).json({ success: false, message: mapped.message });
      }
      throw rpcErr;
    }

    const { notifyAcctSheetReviewComplete } = require('../services/telegram.service');

    // Returned/Rejected items no longer get their own immediate Telegram
    // message here — on a large sheet that meant one ping per item as HO
    // worked through the queue. They're folded into the single
    // review-complete summary below instead (which already collects every
    // Returned/Rejected item's particulars/amount/remarks), fired once per
    // review session rather than once per action.
    //
    // Event 2 — fires once HO has no more Pending HO Review items left on
    // this sheet. On Hold is a terminal state now (037_terminal_hold_and_rejected.sql,
    // no further in-place action possible), not "still needs a decision", so
    // it no longer holds this boundary open.
    const { count: pendingCount, error: pendingErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('sheet_id', data.sheet_id)
      .eq('requisition_status', 'Pending HO Review');

    if (!pendingErr && pendingCount === 0) {
      notifyAcctSheetReviewComplete(data.sheet_id).catch(err => {
        console.error(`[ACCT SHEET] Telegram notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({ success: true, item: data, message: `Line item action '${action}' applied.` });
  } catch (error) {
    console.error(`actOnLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to act on line item.' });
  }
}

/**
 * POST /acct-requisitions/sheets/:sheetId/items/batch-action
 * Batch counterpart of actOnLineItem — one request carrying every HO
 * decision for a review session (mirrors the cost-estimate HO review's
 * submit_row_approvals), instead of one PATCH per line item per click.
 *
 * act_acct_line_items_batch_transact (migration 027) runs every action in
 * one transaction but isolates each item behind its own savepoint, so one
 * item failing (e.g. insufficient bank balance) doesn't roll back the
 * others — the response reports success/failure per item rather than
 * succeeding or failing as a whole.
 */
async function actOnLineItemsBatch(req, res) {
  if (!validate(req, res, actOnLineItemsBatchSchema)) return;
  const { sheetId } = req.params;
  const { actions } = req.body;

  try {
    const itemIds = actions.map(a => a.line_item_id);
    const { data: items, error: itemsErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id, debit_bank_ac_type, req_amount')
      .eq('sheet_id', sheetId)
      .in('id', itemIds);
    if (itemsErr) throw itemsErr;

    const foundIds = new Set((items || []).map(i => i.id));
    const notInSheet = itemIds.filter(id => !foundIds.has(id));
    if (notInSheet.length > 0) {
      return res.status(400).json({
        success: false,
        message: `${notInSheet.length} item(s) do not belong to this sheet.`
      });
    }
    const itemById = new Map((items || []).map(i => [i.id, i]));

    const { data: results, error: rpcErr } = await supabase.rpc('act_acct_line_items_batch_transact', {
      p_actions: actions.map(a => ({
        line_item_id: a.line_item_id,
        action: a.action,
        ho_pass_amount: a.ho_pass_amount ?? null,
        ho_remarks: a.ho_remarks?.trim() || null
      })),
      p_actioned_by: req.user.mobile_number
    });
    if (rpcErr) throw rpcErr;

    const { notifyAcctBankBalanceInsufficient, notifyAcctSheetReviewComplete } = require('../services/telegram.service');

    const failed = results.filter(r => !r.success);
    // Fire-and-forget, same as the single-item path — one message per bank
    // that hit BAL01 in this batch, not deduped, matching existing behavior.
    for (const r of failed) {
      if (r.error_code === 'BAL01') {
        const item = itemById.get(r.line_item_id);
        const action = actions.find(a => a.line_item_id === r.line_item_id);
        supabase.from('bank_balance_master')
          .select('available_balance')
          .eq('bank_name', item?.debit_bank_ac_type)
          .maybeSingle()
          .then(({ data: bbm }) => notifyAcctBankBalanceInsufficient(
            item?.debit_bank_ac_type,
            bbm?.available_balance ?? 0,
            action?.ho_pass_amount ?? item?.req_amount
          ))
          .catch(err => console.error(`[ACCT BANK] Telegram notification failed: ${err.message}`));
      }
    }

    // Same "review session complete" boundary as the single-item path, just
    // checked once after the whole batch instead of after every action.
    const { count: pendingCount, error: pendingErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id', { count: 'exact', head: true })
      .eq('sheet_id', sheetId)
      .eq('requisition_status', 'Pending HO Review');

    if (!pendingErr && pendingCount === 0) {
      notifyAcctSheetReviewComplete(sheetId).catch(err => {
        console.error(`[ACCT SHEET] Telegram notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({
      success: true,
      results,
      message: `${results.length - failed.length} of ${results.length} action(s) applied.`
    });
  } catch (error) {
    console.error(`actOnLineItemsBatch failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to apply batch actions.' });
  }
}

/**
 * POST /acct-requisitions/items/:itemId/resubmit
 */
async function resubmitLineItem(req, res) {
  if (!validate(req, res, resubmitLineItemSchema)) return;
  const { itemId } = req.params;
  const b = req.body;

  try {
    const { data, error: rpcErr } = await supabase.rpc('resubmit_acct_line_item_transact', {
      p_line_item_id: itemId,
      p_resubmitted_by: req.user.mobile_number,
      p_account_sub_title_id: b.account_sub_title_id ?? null,
      p_account_sub_title_text: b.account_sub_title_text ?? null,
      p_particulars: b.particulars ?? null,
      p_beneficiary_ac_no: b.beneficiary_ac_no ?? null,
      p_beneficiary_name: b.beneficiary_name ?? null,
      p_beneficiary_ifsc: b.beneficiary_ifsc ?? null,
      p_beneficiary_bank_name: b.beneficiary_bank_name ?? null,
      p_debit_bank_ac_type: b.debit_bank_ac_type ?? null,
      p_req_amount: b.req_amount ?? null,
      p_payment_mode: b.payment_mode ?? null,
      p_cheque_no: b.cheque_no ?? null,
      p_cheque_date: b.cheque_date ?? null
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    const { notifyHoAcctItemResubmitted } = require('../services/telegram.service');
    notifyHoAcctItemResubmitted(data).catch(err => {
      console.error(`[ACCT ITEM] Telegram notification failed: ${err.message}`);
    });

    return res.status(200).json({ success: true, item: data, message: 'Line item resubmitted.' });
  } catch (error) {
    console.error(`resubmitLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to resubmit line item.' });
  }
}

/**
 * GET /acct-requisitions/import-eligible-items
 * On Hold/Rejected line items across ALL sheets that have not yet been
 * imported into a later sheet or dismissed — same filter/pagination/
 * sheet-join shape as getLineItems, narrowed to the importable subset
 * (034_add_line_item_import.sql's idx_arli_importable backs this query).
 */
async function getImportEligibleItems(req, res) {
  try {
    const query = req.query || {};
    const isExport = query.export === 'true' || query.export === true;

    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('acct_requisition_line_items')
      .select('*', { count: 'exact' })
      .in('requisition_status', ['On Hold', 'Rejected'])
      .is('imported_to_sheet_id', null)
      .eq('import_dismissed', false);

    if (query.account_sub_title) {
      dbQuery = dbQuery.ilike('account_sub_title_text', `%${query.account_sub_title}%`);
    }

    if (query.beneficiary_ac_no) {
      dbQuery = dbQuery.ilike('beneficiary_ac_no', `%${query.beneficiary_ac_no}%`);
    }

    if (query.debit_bank_ac_type) {
      dbQuery = dbQuery.eq('debit_bank_ac_type', query.debit_bank_ac_type);
    }

    if (query.date_from) {
      dbQuery = dbQuery.gte('created_at', query.date_from);
    }

    if (query.date_to) {
      dbQuery = dbQuery.lte('created_at', `${query.date_to}T23:59:59.999`);
    }

    dbQuery = dbQuery.order('created_at', { ascending: false });
    dbQuery = isExport ? dbQuery.limit(5000) : dbQuery.range(offset, offset + limit - 1);

    const { data: items, count, error } = await dbQuery;
    if (error) throw error;

    const sheetIds = [...new Set((items || []).map(i => i.sheet_id))];
    let sheetMap = {};

    if (sheetIds.length > 0) {
      const { data: sheets, error: sheetsErr } = await supabase
        .from('acct_requisition_sheets')
        .select('id, sheet_number, sheet_status')
        .in('id', sheetIds);
      if (sheetsErr) throw sheetsErr;

      sheetMap = (sheets || []).reduce((acc, s) => {
        acc[s.id] = s;
        return acc;
      }, {});
    }

    const enrichedItems = (items || []).map(item => ({
      ...item,
      sheet_number: sheetMap[item.sheet_id]?.sheet_number || null,
      sheet_status: sheetMap[item.sheet_id]?.sheet_status || null
    }));

    if (isExport) {
      return res.status(200).json({ success: true, items: enrichedItems });
    }

    return res.status(200).json({
      success: true,
      items: enrichedItems,
      pagination: { page, limit, total: count || 0, totalPages: Math.ceil((count || 0) / limit) }
    });
  } catch (error) {
    console.error(`getImportEligibleItems failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve importable line items.' });
  }
}

/**
 * POST /acct-requisitions/import-eligible-items/:itemId/import
 * body: { target_sheet_id }
 * Copies an On Hold/Rejected item into target_sheet_id as a brand-new line
 * item and marks the source as imported (import_acct_line_item_transact,
 * 034_add_line_item_import.sql) — the source row's requisition_status and
 * every other field are left untouched.
 */
async function importLineItem(req, res) {
  const { itemId } = req.params;
  const { target_sheet_id } = req.body;

  try {
    const { data, error: rpcErr } = await supabase.rpc('import_acct_line_item_transact', {
      p_source_item_id: itemId,
      p_target_sheet_id: target_sheet_id,
      p_imported_by: req.user.mobile_number
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    return res.status(201).json({ success: true, item: data, message: 'Line item imported.' });
  } catch (error) {
    console.error(`importLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to import line item.' });
  }
}

/**
 * POST /acct-requisitions/import-eligible-items/:itemId/dismiss
 * Soft-hides an eligible item from the import list without touching its
 * real data — no hard delete, per this table's append-only guarantee
 * (prevent_acct_sheet_hard_delete, 030_allow_empty_open_sheet_delete.sql).
 */
async function dismissImportEligibleItem(req, res) {
  const { itemId } = req.params;

  try {
    const { data, error } = await supabase
      .from('acct_requisition_line_items')
      .update({
        import_dismissed: true,
        import_dismissed_at: new Date().toISOString(),
        import_dismissed_by: req.user.mobile_number,
        updated_at: new Date().toISOString()
      })
      .eq('id', itemId)
      .is('imported_to_sheet_id', null)
      .eq('import_dismissed', false)
      .select()
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return res.status(409).json({
        success: false,
        message: 'Item does not exist, or is already imported or dismissed.'
      });
    }

    return res.status(200).json({ success: true, item: data, message: 'Line item dismissed.' });
  } catch (error) {
    console.error(`dismissImportEligibleItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to dismiss line item.' });
  }
}

// ============================================================================
// Master data — Bank balances
// ============================================================================

/**
 * GET /acct-requisitions/bank-balances
 */
async function getBankBalances(req, res) {
  try {
    const { data, error } = await supabase
      .from('bank_balance_master')
      .select('*')
      .order('bank_name', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, bankBalances: data || [] });
  } catch (error) {
    console.error(`getBankBalances failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve bank balances.' });
  }
}

/**
 * PUT /acct-requisitions/bank-balances
 * True upsert on bank_name (§3a design decision).
 */
async function upsertBankBalance(req, res) {
  if (!validate(req, res, upsertBankBalanceSchema)) return;
  const { bank_name, balance_date, available_balance, account_number } = req.body;

  try {
    // Read the pre-upsert balance so the audit_log entry below can record a real
    // delta (credit/debit) rather than just the new absolute figure — this table
    // has no dedicated ledger, so audit_log is the only place that history lives.
    const { data: before } = await supabase
      .from('bank_balance_master')
      .select('available_balance')
      .eq('bank_name', bank_name)
      .maybeSingle();

    const payload = {
      bank_name,
      balance_date,
      available_balance,
      created_by: req.user.mobile_number,
      updated_by: req.user.mobile_number
    };
    // Omit entirely (rather than send null) when not provided, so an upsert that only
    // means to update available_balance doesn't clobber an already-set account_number.
    if (account_number !== undefined) payload.account_number = account_number;

    const { data, error } = await supabase
      .from('bank_balance_master')
      .upsert(payload, { onConflict: 'bank_name' })
      .select()
      .single();

    if (error) throw error;

    const oldBalance = Number(before?.available_balance ?? 0);
    const newBalance = Number(available_balance);
    const delta = newBalance - oldBalance;

    await supabase.from('audit_log').insert({
      user_id: req.user.mobile_number,
      action: !before ? 'BANK_ADDED' : delta > 0 ? 'BANK_CREDITED' : delta < 0 ? 'BANK_DEBITED' : 'BANK_RECONCILED',
      module_name: 'Bank Balance Master',
      record_identifier: bank_name,
      old_value: before ? { available_balance: oldBalance } : null,
      new_value: { available_balance: newBalance, delta, account_number: data.account_number }
    });

    // Event 8 — only for adjustments to an existing bank, not for a brand-new
    // bank being added (that's just setup, not a debit/credit worth alerting on).
    if (before && delta !== 0) {
      const { notifyAcctBankBalanceAdjusted } = require('../services/telegram.service');
      notifyAcctBankBalanceAdjusted(
        bank_name,
        delta > 0 ? 'Credited' : 'Debited',
        delta,
        newBalance,
        req.user.mobile_number
      ).catch(err => {
        console.error(`[ACCT BANK] Telegram notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({ success: true, bankBalance: data, message: 'Bank balance saved.' });
  } catch (error) {
    console.error(`upsertBankBalance failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save bank balance.' });
  }
}

/**
 * GET /acct-requisitions/bank-ledger
 * Paginated ledger of bank_balance_master reconciliation events, sourced from
 * audit_log (no dedicated ledger table exists). Optional ?bank_name= filter.
 */
async function getBankBalanceLedger(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '10', 10)));
    const offset = (page - 1) * limit;

    let query = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .eq('module_name', 'Bank Balance Master');

    if (req.query.bank_name) {
      query = query.eq('record_identifier', req.query.bank_name);
    }

    const { data, error, count } = await query
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const userIds = [...new Set((data || []).map(log => log.user_id).filter(Boolean))];
    let userMap = {};
    if (userIds.length > 0) {
      const { data: users } = await supabase
        .from('authorised_users')
        .select('mobile_number, display_name')
        .in('mobile_number', userIds);
      (users || []).forEach(u => { userMap[u.mobile_number] = u.display_name; });
    }

    const entries = (data || []).map(log => ({ ...log, user_name: userMap[log.user_id] || log.user_id || 'System' }));

    return res.status(200).json({
      success: true,
      entries,
      totalCount: count || 0,
      page,
      totalPages: Math.ceil((count || 0) / limit)
    });
  } catch (error) {
    console.error(`getBankBalanceLedger failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve bank balance ledger.' });
  }
}

// ============================================================================
// Master data — Beneficiary
// ============================================================================

/**
 * GET /acct-requisitions/beneficiary-master
 * Paginated/searchable list, distinct from lookupBeneficiary's single
 * (account_number, ifsc) lookup below — this backs the Beneficiary Master
 * management page rather than the line-item form's autofill.
 */
async function getBeneficiaries(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase.from('beneficiary_master').select('*', { count: 'exact' });

    if (query.search) {
      const term = query.search.replace(/[%,]/g, '');
      dbQuery = dbQuery.or(`account_number.ilike.%${term}%,beneficiary_name.ilike.%${term}%`);
    }

    const { data: beneficiaries, count, error } = await dbQuery
      .order('beneficiary_name', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const total = count || 0;
    return res.status(200).json({
      success: true,
      beneficiaries: beneficiaries || [],
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1)
      }
    });
  } catch (error) {
    console.error(`getBeneficiaries failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve beneficiaries.' });
  }
}

/**
 * GET /acct-requisitions/beneficiary?account_number=...&ifsc=...
 */
async function lookupBeneficiary(req, res) {
  const { account_number, ifsc } = req.query || {};
  if (!account_number || !ifsc) {
    return res.status(400).json({ success: false, message: 'account_number and ifsc are required.' });
  }

  try {
    const { data, error } = await supabase
      .from('beneficiary_master')
      .select('*')
      .eq('account_number', account_number)
      .eq('ifsc', ifsc)
      .maybeSingle();

    if (error) throw error;

    return res.status(200).json({ success: true, beneficiary: data || null });
  } catch (error) {
    console.error(`lookupBeneficiary failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to look up beneficiary.' });
  }
}

/**
 * GET /acct-requisitions/beneficiary-suggestions?prefix=...&limit=...
 * Live typeahead for the line-item entry row's A/C No. field — left-anchored
 * prefix match only (not getBeneficiaries' substring/alphabetical search,
 * which backs the Beneficiary Master management page instead), most
 * recently used first, so the suggestion the user actually wants surfaces
 * near the top instead of getting buried alphabetically by name.
 * idx_beneficiary_master_acno_prefix (038) backs this query.
 */
async function searchBeneficiariesByAcNo(req, res) {
  // Strip LIKE metacharacters (% and _) so a caller can't wildcard-expand
  // the match — same convention as getBeneficiaries' `search` sanitization.
  const prefix = (req.query?.prefix || '').trim().replace(/[%_]/g, '');
  if (prefix.length < 3) {
    return res.status(200).json({ success: true, beneficiaries: [] });
  }
  const limit = Math.min(parseInt(req.query?.limit) || 8, 20);

  try {
    // .like(), not .ilike(): idx_beneficiary_master_acno_prefix (038) uses
    // varchar_pattern_ops, which only accelerates case-sensitive LIKE, not
    // ILIKE. Account numbers are digits-only (chk/regex-enforced elsewhere),
    // so a case-sensitive match is exactly as correct and actually uses the
    // index instead of falling back to a sequential scan on every keystroke.
    const { data, error } = await supabase
      .from('beneficiary_master')
      .select('account_number, ifsc, beneficiary_name, beneficiary_bank_name')
      .like('account_number', `${prefix}%`)
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(limit);
    if (error) throw error;

    return res.status(200).json({ success: true, beneficiaries: data || [] });
  } catch (error) {
    console.error(`searchBeneficiariesByAcNo failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to search beneficiaries.' });
  }
}

/**
 * PUT /acct-requisitions/beneficiary
 */
async function upsertBeneficiary(req, res) {
  if (!validate(req, res, upsertBeneficiarySchema)) return;
  const { account_number, ifsc, beneficiary_name, beneficiary_bank_name } = req.body;

  try {
    const { data, error } = await supabase
      .from('beneficiary_master')
      .upsert(
        {
          account_number,
          ifsc,
          beneficiary_name,
          beneficiary_bank_name,
          last_used_at: new Date().toISOString(),
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'account_number,ifsc' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, beneficiary: data, message: 'Beneficiary saved.' });
  } catch (error) {
    console.error(`upsertBeneficiary failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save beneficiary.' });
  }
}

// ============================================================================
// Master data — Account sub-titles
// ============================================================================

/**
 * GET /acct-requisitions/account-sub-titles
 */
async function getAccountSubTitles(req, res) {
  try {
    // Returns both active and inactive rows — the line-item dropdown
    // (LineItemRow.jsx) filters to active ones client-side where needed;
    // the sub-titles master page needs to see/reactivate inactive rows too.
    const { data, error } = await supabase
      .from('account_sub_title_master')
      .select('*')
      .order('title', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, accountSubTitles: data || [] });
  } catch (error) {
    console.error(`getAccountSubTitles failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve account sub-titles.' });
  }
}

/**
 * PUT /acct-requisitions/account-sub-titles
 */
async function upsertAccountSubTitle(req, res) {
  if (!validate(req, res, upsertAccountSubTitleSchema)) return;
  const { title, is_active } = req.body;

  try {
    const { data, error } = await supabase
      .from('account_sub_title_master')
      .upsert(
        {
          title,
          is_active: is_active !== undefined ? is_active : true,
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'title' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, accountSubTitle: data, message: 'Account sub-title saved.' });
  } catch (error) {
    console.error(`upsertAccountSubTitle failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save account sub-title.' });
  }
}

// ============================================================================
// Master data — Particulars
// ============================================================================

/**
 * GET /acct-requisitions/particulars
 */
async function getParticulars(req, res) {
  try {
    // Returns both active and inactive rows — the line-item dropdown
    // (LineItemRow.jsx) filters to active ones client-side where needed;
    // the particulars master page needs to see/reactivate inactive rows too.
    const { data, error } = await supabase
      .from('particulars_master')
      .select('*')
      .order('title', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, particulars: data || [] });
  } catch (error) {
    console.error(`getParticulars failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve particulars.' });
  }
}

/**
 * PUT /acct-requisitions/particulars
 */
async function upsertParticular(req, res) {
  if (!validate(req, res, upsertParticularsSchema)) return;
  const { title, is_active } = req.body;

  try {
    const { data, error } = await supabase
      .from('particulars_master')
      .upsert(
        {
          title,
          is_active: is_active !== undefined ? is_active : true,
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'title' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, particular: data, message: 'Particular saved.' });
  } catch (error) {
    console.error(`upsertParticular failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save particular.' });
  }
}

// ============================================================================
// Master data — Indian banks
// ============================================================================

/**
 * GET /acct-requisitions/indian-banks
 */
async function getIndianBanks(req, res) {
  try {
    const { data, error } = await supabase
      .from('indian_bank_master')
      .select('*')
      .order('bank_name', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, indianBanks: data || [] });
  } catch (error) {
    console.error(`getIndianBanks failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Indian banks.' });
  }
}

/**
 * PUT /acct-requisitions/indian-banks
 * Updates the DB row, then patches the in-memory INDIAN_BANKS_SET used by
 * beneficiary_bank_name's Zod validation (acctRequisition.schema.js) so a
 * newly-added/renamed bank is immediately usable without a server restart.
 */
async function upsertIndianBank(req, res) {
  if (!validate(req, res, upsertIndianBankSchema)) return;
  const { bank_name, is_active } = req.body;

  try {
    const { data, error } = await supabase
      .from('indian_bank_master')
      .upsert(
        {
          bank_name,
          is_active: is_active !== undefined ? is_active : true,
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'bank_name' }
      )
      .select()
      .single();

    if (error) throw error;

    // Full requery rather than a single add — table is tiny (~30-100 rows,
    // an admin-only write path) and this also correctly drops a bank from
    // validation the moment it's deactivated, which an add-only patch can't.
    await refreshIndianBanksCache();

    return res.status(200).json({ success: true, indianBank: data, message: 'Indian bank saved.' });
  } catch (error) {
    console.error(`upsertIndianBank failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save Indian bank.' });
  }
}

// ============================================================================
// Bulk NEFT export
// ============================================================================

/**
 * POST /acct-requisitions/sheets/:sheetId/export-neft
 * §4c: 3 explicit validations before file generation (unchanged from the
 * prior session — do not modify; covered by Test 6 in
 * acctRequisitionLifecycle.test.js). Beyond those three, two more checks are
 * specific to *file generation* and were added this session: all selected
 * items must share one debit account (the letter states a single account in
 * prose — "our XXX A/c" — so a mixed-account batch can't be represented
 * faithfully), and that account must have account_number on file.
 * On success this streams the real 'Bulk Sheet 1'-format .xlsx
 * (bulkNeftExport.service.js) and marks neft_exported exactly as before.
 */
async function exportBulkNeft(req, res) {
  if (!validate(req, res, exportNeftSchema)) return;
  const { sheetId } = req.params;
  const { item_ids } = req.body;

  try {
    const { data: items, error: itemsErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id, sheet_id, payment_mode, requisition_status, beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name, ho_pass_amount, debit_bank_ac_type')
      .in('id', item_ids);

    if (itemsErr) throw itemsErr;

    if (!items || items.length !== item_ids.length) {
      return res.status(400).json({ success: false, message: 'One or more item_ids do not exist.' });
    }

    const wrongSheet = items.filter(i => i.sheet_id !== sheetId);
    if (wrongSheet.length > 0) {
      return res.status(400).json({ success: false, message: 'All item_ids must belong to the specified sheet.' });
    }

    const notBulkNeft = items.filter(i => i.payment_mode !== 'Bulk NEFT');
    if (notBulkNeft.length > 0) {
      return res.status(400).json({ success: false, message: 'All items must have payment_mode = Bulk NEFT.' });
    }

    const notApproved = items.filter(i => !['Approved', 'Partially Approved'].includes(i.requisition_status));
    if (notApproved.length > 0) {
      return res.status(400).json({ success: false, message: 'All items must be Approved or Partially Approved.' });
    }

    const debitAccounts = new Set(items.map(i => i.debit_bank_ac_type));
    if (debitAccounts.size !== 1) {
      return res.status(400).json({ success: false, message: 'All selected items must debit the same bank account to generate a single Bulk NEFT letter.' });
    }
    const debitBankAcType = items[0].debit_bank_ac_type;

    const { data: bankBalance, error: bbErr } = await supabase
      .from('bank_balance_master')
      .select('account_number')
      .eq('bank_name', debitBankAcType)
      .maybeSingle();

    if (bbErr) throw bbErr;
    if (!bankBalance?.account_number) {
      return res.status(422).json({
        success: false,
        message: `No account number on file for ${debitBankAcType}. Set it via Bank Balance Master before exporting.`
      });
    }

    const workbook = buildBulkNeftWorkbook({
      items: items.map(i => ({
        beneficiary_name: i.beneficiary_name,
        beneficiary_ac_no: i.beneficiary_ac_no,
        beneficiary_bank_name: i.beneficiary_bank_name,
        beneficiary_ifsc: i.beneficiary_ifsc,
        amount: i.ho_pass_amount
      })),
      debitBankAcType,
      debitAccountNumber: bankBalance.account_number
    });

    const { error: updateErr } = await supabase
      .from('acct_requisition_line_items')
      .update({
        neft_exported: true,
        neft_exported_at: new Date().toISOString(),
        neft_exported_by: req.user.mobile_number
      })
      .in('id', item_ids);

    if (updateErr) throw updateErr;

    const { notifyAcctBulkNeftExported } = require('../services/telegram.service');
    const totalAmount = items.reduce((sum, i) => sum + Number(i.ho_pass_amount || 0), 0);
    notifyAcctBulkNeftExported(sheetId, items.length, totalAmount, req.user.mobile_number).catch(err => {
      console.error(`[ACCT NEFT] Telegram notification failed: ${err.message}`);
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const filename = `Bulk_NEFT_${sheetId}_${Date.now()}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.end(Buffer.from(buffer));
  } catch (error) {
    console.error(`exportBulkNeft failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to export Bulk NEFT.' });
  }
}

module.exports = {
  createSheet, getSheets, getSheetById, getLineItems, deleteSheetIfEmpty,
  addLineItem, updateLineItem, deleteLineItem, submitSheet,
  actOnLineItem, actOnLineItemsBatch, resubmitLineItem,
  getImportEligibleItems, importLineItem, dismissImportEligibleItem,
  getBankBalances, upsertBankBalance, getBankBalanceLedger,
  lookupBeneficiary, searchBeneficiariesByAcNo, upsertBeneficiary, getBeneficiaries,
  getAccountSubTitles, upsertAccountSubTitle,
  getParticulars, upsertParticular,
  getIndianBanks, upsertIndianBank,
  exportBulkNeft
};
