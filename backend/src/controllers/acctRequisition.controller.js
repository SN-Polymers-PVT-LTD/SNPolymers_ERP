'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema,
  resubmitLineItemSchema, reopenLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  exportNeftSchema
} = require('../validation/acctRequisition.schema');

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
    case 'STA02':
    case 'STA03':
    case 'STA04':
      return { status: 409, message: rpcErr.message };
    case 'VAL01':
    case 'VAL02':
    case 'VAL03':
    case 'VAL04':
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
 * GET /acct-requisitions/sheets
 */
async function getSheets(req, res) {
  try {
    const query = req.query || {};
    let dbQuery = supabase.from('acct_requisition_sheets').select('*');

    if (query.sheet_status && ['Open', 'Submitted'].includes(query.sheet_status)) {
      dbQuery = dbQuery.eq('sheet_status', query.sheet_status);
    }

    const { data: sheets, error } = await dbQuery.order('created_at', { ascending: false });
    if (error) throw error;

    return res.status(200).json({ success: true, sheets: sheets || [] });
  } catch (error) {
    console.error(`getSheets failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisition sheets.' });
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
    const { data: sheet, error: sheetErr } = await supabase
      .from('acct_requisition_sheets')
      .select('id, sheet_status')
      .eq('id', sheetId)
      .maybeSingle();

    if (sheetErr) throw sheetErr;
    if (!sheet) return res.status(404).json({ success: false, message: 'Requisition sheet not found.' });
    if (sheet.sheet_status !== 'Open') {
      return res.status(403).json({ success: false, message: 'Line items can only be added while the sheet is Open.' });
    }

    const { data: item, error: insertErr } = await supabase
      .from('acct_requisition_line_items')
      .insert([{ ...req.body, sheet_id: sheetId, created_by: req.user.mobile_number }])
      .select()
      .single();

    if (insertErr) throw insertErr;

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
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

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
 * Gate (§4c): fast-path check requisition_status IN ('Pending HO Review','On Hold') before RPC.
 */
async function actOnLineItem(req, res) {
  if (!validate(req, res, actOnLineItemSchema)) return;
  const { itemId } = req.params;
  const { action, ho_pass_amount, ho_remarks } = req.body;

  try {
    const { data: item, error: itemErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id, requisition_status')
      .eq('id', itemId)
      .maybeSingle();

    if (itemErr) throw itemErr;
    if (!item) return res.status(404).json({ success: false, message: 'Line item not found.' });

    if (!['Pending HO Review', 'On Hold'].includes(item.requisition_status)) {
      return res.status(409).json({
        success: false,
        message: `HO can only act on Pending HO Review or On Hold items. Current: ${item.requisition_status}`
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
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    return res.status(200).json({ success: true, item: data, message: `Line item action '${action}' applied.` });
  } catch (error) {
    console.error(`actOnLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to act on line item.' });
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

    return res.status(200).json({ success: true, item: data, message: 'Line item resubmitted.' });
  } catch (error) {
    console.error(`resubmitLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to resubmit line item.' });
  }
}

/**
 * POST /acct-requisitions/items/:itemId/reopen
 * Gate (§4c): req.user.permissions?.['ho.requisition.reopen'] === true, checked BEFORE any DB write.
 */
async function reopenLineItem(req, res) {
  if (req.user.permissions?.['ho.requisition.reopen'] !== true) {
    return res.status(403).json({ success: false, message: 'Access denied. Reopen permission required.' });
  }

  if (!validate(req, res, reopenLineItemSchema)) return;
  const { itemId } = req.params;
  const { reopen_remark } = req.body;

  try {
    const { data, error: rpcErr } = await supabase.rpc('reopen_acct_line_item_transact', {
      p_line_item_id: itemId,
      p_reopened_by: req.user.mobile_number,
      p_reopen_remark: reopen_remark
    });

    if (rpcErr) {
      const mapped = mapAcctRpcError(rpcErr);
      if (mapped) return res.status(mapped.status).json({ success: false, message: mapped.message });
      throw rpcErr;
    }

    return res.status(200).json({ success: true, item: data, message: 'Line item reopened.' });
  } catch (error) {
    console.error(`reopenLineItem failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to reopen line item.' });
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
  const { bank_name, balance_date, available_balance } = req.body;

  try {
    const { data, error } = await supabase
      .from('bank_balance_master')
      .upsert(
        {
          bank_name,
          balance_date,
          available_balance,
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'bank_name' }
      )
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({ success: true, bankBalance: data, message: 'Bank balance saved.' });
  } catch (error) {
    console.error(`upsertBankBalance failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save bank balance.' });
  }
}

// ============================================================================
// Master data — Beneficiary
// ============================================================================

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
    const { data, error } = await supabase
      .from('account_sub_title_master')
      .select('*')
      .eq('is_active', true)
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
// Bulk NEFT export
// ============================================================================

/**
 * POST /acct-requisitions/sheets/:sheetId/export-neft
 * §4c: 3 explicit validations before file generation.
 * NOTE: real bank-format .xlsx generation is out of scope for this session
 * (no xlsx-writing library installed; accounts/BULK NEFT.xlsx format-matching
 * deferred to a follow-up session). On success this marks neft_exported and
 * returns a placeholder JSON payload instead of a binary file.
 */
async function exportBulkNeft(req, res) {
  if (!validate(req, res, exportNeftSchema)) return;
  const { sheetId } = req.params;
  const { item_ids } = req.body;

  try {
    const { data: items, error: itemsErr } = await supabase
      .from('acct_requisition_line_items')
      .select('id, sheet_id, payment_mode, requisition_status')
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

    const { data: updated, error: updateErr } = await supabase
      .from('acct_requisition_line_items')
      .update({
        neft_exported: true,
        neft_exported_at: new Date().toISOString(),
        neft_exported_by: req.user.mobile_number
      })
      .in('id', item_ids)
      .select('id');

    if (updateErr) throw updateErr;

    return res.status(200).json({
      success: true,
      exportedItemIds: (updated || []).map(i => i.id),
      message: 'Bulk NEFT export validated and marked exported. File generation not yet implemented.'
    });
  } catch (error) {
    console.error(`exportBulkNeft failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to export Bulk NEFT.' });
  }
}

module.exports = {
  createSheet, getSheets, getSheetById,
  addLineItem, updateLineItem, deleteLineItem, submitSheet,
  actOnLineItem, resubmitLineItem, reopenLineItem,
  getBankBalances, upsertBankBalance,
  lookupBeneficiary, upsertBeneficiary,
  getAccountSubTitles, upsertAccountSubTitle,
  exportBulkNeft
};
