'use strict';

const { supabase } = require('../db/supabase');
const { getFinalApprovedEstimateMap, getFundRequestSubmittedTotal, getApprovedEstimateAmount } = require('../services/workOrderCapacity.service');
const crypto = require('crypto');
const validate = require('../validation/validate');
const {
  createFundRequestSchema,
  updateFundRequestDraftSchema,
  submitFundRequestSchema,
  cancelFundRequestSchema
} = require('../validation/fundRequest.schema');
const { BeneficiaryValidationError, resolveBeneficiaryBank } = require('../services/beneficiaryMaster.service');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_STATUSES = ['Draft', 'Pending', 'Approved', 'Hold', 'Returned', 'Rejected', 'Cancelled'];

function getEffectiveFrRole(role) {
  return role;
}

// Display name helper
async function resolveDisplayNames(mobiles) {
  const uniqueMobiles = Array.from(new Set(mobiles.filter(Boolean)));
  const userMap = {};

  if (uniqueMobiles.length > 0) {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', uniqueMobiles);

    if (!error && users) {
      users.forEach(u => {
        userMap[u.mobile_number] = u.display_name;
      });
    }
  }

  return userMap;
}

/**
 * POST /api/v1/auth/fund-requests
 * Creates a new fund request draft. Capacity reservation and notification
 * happen only in submitFundRequest.
 */
async function createFundRequest(req, res) {
  if (!validate(req, res, createFundRequestSchema)) return;
  const {
    zo_fr_no, work_order_no, zo_fr_amount, requested_amount, zo_remarks, remarks,
    beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id,
    submission_mode
  } = req.body;
  const amount = zo_fr_amount !== undefined && zo_fr_amount !== null ? Number(zo_fr_amount) : Number(requested_amount);
  const finalFrNo = (zo_fr_no || `FR-${crypto.randomUUID().substring(0, 8)}`).trim();
  const finalRemarks = (zo_remarks || remarks || '').trim() || null;

  try {
    if (submission_mode === 'submit' && (!beneficiary_name?.trim() || !beneficiary_ac_no?.trim() || !beneficiary_ifsc?.trim() || !beneficiary_bank_id)) {
      return res.status(400).json({ success: false, message: 'Complete beneficiary bank details are required before submission.' });
    }

    // Resolve a supplied bank for the draft snapshot, but do not mutate the
    // shared beneficiary directory until the draft is submitted.
    let resolvedBankName, validatedBankId;
    try {
      ({ validatedBankId, resolvedBankName } = await resolveBeneficiaryBank(beneficiary_bank_id, beneficiary_bank_name));
    } catch (err) {
      if (err instanceof BeneficiaryValidationError) {
        return res.status(err.status).json({ success: false, message: err.message });
      }
      throw err;
    }

    // Unique check
    const { count, error: countError } = await supabase
      .from('fund_requests')
      .select('zo_fr_no', { count: 'exact', head: true })
      .eq('zo_fr_no', finalFrNo);

    if (countError) throw countError;
    if (count && count > 0) {
      return res.status(409).json({ success: false, message: `A fund request with number ${finalFrNo} already exists.` });
    }

    // Verify work order matches ZO
    const { data: project, error: projErr } = await supabase
      .from('projects_master')
      .select('zo_user_id, status, work_order_value')
      .eq('work_order_no', work_order_no.trim())
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) {
      return res.status(400).json({ success: false, message: 'Work Order not found.' });
    }
    if (project.zo_user_id !== req.user.mobile_number) {
      return res.status(400).json({ success: false, message: 'Work Order mismatch with Zonal Office.' });
    }
    if (project.status !== 'Running' && project.status !== 'Complete Under Maintenance') {
      return res.status(400).json({ success: false, message: 'Work Order must be Active (Running) or Under Maintenance.' });
    }

    const { data: newFr, error: insertError } = await supabase
      .from('fund_requests')
      .insert([
        {
          zo_user_id: req.user.mobile_number,
          work_order_no: work_order_no.trim(),
          zo_fr_no: finalFrNo,
          zo_fr_amount: amount,
          zo_remarks: finalRemarks,
          created_by: req.user.mobile_number,
          request_status: 'Draft',
          beneficiary_id: null,
          beneficiary_name: beneficiary_name?.trim() || null,
          beneficiary_ac_no: beneficiary_ac_no?.trim() || null,
          beneficiary_ifsc: beneficiary_ifsc?.trim() || null,
          beneficiary_bank_name: resolvedBankName,
          beneficiary_bank_id: validatedBankId
        }
      ])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({ success: false, message: `A fund request with number ${finalFrNo} already exists.` });
      }
      throw insertError;
    }

    return res.status(201).json({
      success: true,
      fundRequest: newFr,
      request: {
        ...newFr,
        id: newFr.fund_request_id
      },
      id: newFr.fund_request_id,
      message: 'Fund request draft created.'
    });

  } catch (error) {
    console.error(`createFundRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create fund request.' });
  }
}

/**
 * GET /api/v1/auth/fund-requests
 * Retrieves a list of fund requests with role filtering and pagination.
 */
async function getFundRequests(req, res) {
  try {
    const query = req.query || {};
    const hasPagination = query.page !== undefined || query.limit !== undefined;

    const effectiveRole = getEffectiveFrRole(req.user.role);

    if (effectiveRole === 'je') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    let dbQuery = supabase
      .from('fund_requests')
      .select('*', { count: 'exact' });

    if (effectiveRole === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    } else if (effectiveRole === 'accounts' || effectiveRole === 'ho') {
      dbQuery = dbQuery.neq('request_status', 'Draft');
    }

    // Optional status filter
    if (query.status && VALID_STATUSES.includes(query.status)) {
      dbQuery = dbQuery.eq('request_status', query.status);
    }

    let result;
    let page = 1;
    let limit = 0;

    if (hasPagination) {
      page = Math.max(parseInt(query.page) || 1, 1);
      limit = parseInt(query.limit) || 50;
      if (limit < 1) limit = 50;
      limit = Math.min(limit, 1000);
      const offset = (page - 1) * limit;
      result = await dbQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    } else {
      result = await dbQuery
        .order('created_at', { ascending: false });
    }

    const { data: fundRequests, count, error } = result;

    if (error) throw error;

    // Resolve display names
    const mobiles = [];
    (fundRequests || []).forEach(fr => {
      mobiles.push(fr.zo_user_id);
      mobiles.push(fr.approve_ho_user_id);
      mobiles.push(fr.cancelled_by);
    });

    const userMap = await resolveDisplayNames(mobiles);

    // Base enrichment: display name fields
    const baseEnriched = (fundRequests || []).map(fr => ({
      ...fr,
      zo_name: userMap[fr.zo_user_id] || fr.zo_user_id || null,
      approve_ho_name: userMap[fr.approve_ho_user_id] || fr.approve_ho_user_id || null,
      cancelled_by_name: userMap[fr.cancelled_by] || fr.cancelled_by || null
    }));

    // Batch-fetch Work Order Value + Estimated Value for items 4(a), 4(b), 4(c)
    const uniqueWOs = [...new Set((fundRequests || []).map(fr => fr.work_order_no).filter(Boolean))];

    let woValueMap = {};
    let estimatedValueMap = {};

    if (uniqueWOs.length > 0) {
      // Fetch work_order_value from projects_master
      const { data: projects, error: projErr } = await supabase
        .from('projects_master')
        .select('work_order_no, work_order_value')
        .in('work_order_no', uniqueWOs);

      if (!projErr && projects) {
        projects.forEach(p => {
          woValueMap[p.work_order_no] = p.work_order_value != null ? Number(p.work_order_value) : null;
        });
      }

      // Fetch Final Approved cost estimate amount per WO (latest revision)
      estimatedValueMap = await getFinalApprovedEstimateMap(uniqueWOs);
    }

    // Merge WO Value + Estimated Value into each row
    const enriched = baseEnriched.map(fr => ({
      ...fr,
      work_order_value: woValueMap[fr.work_order_no] ?? null,
      estimated_value:
        fr.work_order_no && estimatedValueMap[fr.work_order_no] != null
          ? estimatedValueMap[fr.work_order_no]
          : null
    }));

    return res.status(200).json({
      success: true,
      fundRequests: enriched,
      pagination: {
        page,
        limit: hasPagination ? limit : (count || enriched.length),
        total: count || 0,
        totalPages: hasPagination ? Math.ceil((count || 0) / limit) : 1
      }
    });

  } catch (error) {
    console.error(`getFundRequests failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve fund requests.' });
  }
}

/**
 * GET /api/v1/auth/fund-requests/:id
 * Retrieves a single fund request by ID.
 */
async function getFundRequestById(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const effectiveRole = getEffectiveFrRole(req.user.role);

    if (effectiveRole === 'je') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const { data: fr, error } = await supabase
      .from('fund_requests')
      .select('*')
      .eq('fund_request_id', id)
      .maybeSingle();

    if (error) throw error;
    if (!fr) {
      return res.status(404).json({ success: false, message: 'Fund request not found.' });
    }

    if (effectiveRole === 'zo' && fr.zo_user_id !== req.user.mobile_number) {
      return res.status(404).json({ success: false, message: 'Fund request not found.' });
    }
    if ((effectiveRole === 'accounts' || effectiveRole === 'ho') && fr.request_status === 'Draft') {
      return res.status(404).json({ success: false, message: 'Fund request not found.' });
    }

    const userMap = await resolveDisplayNames([fr.zo_user_id, fr.approve_ho_user_id, fr.cancelled_by]);

    const enriched = {
      ...fr,
      zo_name: userMap[fr.zo_user_id] || fr.zo_user_id || null,
      approve_ho_name: userMap[fr.approve_ho_user_id] || fr.approve_ho_user_id || null,
      cancelled_by_name: userMap[fr.cancelled_by] || fr.cancelled_by || null
    };

    return res.status(200).json({
      success: true,
      fundRequest: enriched
    });

  } catch (error) {
    console.error(`getFundRequestById failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve fund request.' });
  }
}

/** PATCH /fund-requests/:id — update an unsubmitted draft. */
async function updateFundRequestDraft(req, res) {
  if (!validate(req, res, updateFundRequestDraftSchema)) return;
  const { id } = req.params;
  const patch = { ...req.body };
  if (patch.work_order_no !== undefined) patch.work_order_no = patch.work_order_no.trim();
  if (patch.zo_fr_no !== undefined) patch.zo_fr_no = patch.zo_fr_no.trim();
  if (patch.zo_remarks !== undefined) patch.zo_remarks = patch.zo_remarks?.trim() || null;
  if (patch.beneficiary_ifsc !== undefined) patch.beneficiary_ifsc = patch.beneficiary_ifsc?.trim().toUpperCase() || null;
  if (patch.beneficiary_bank_name !== undefined) patch.beneficiary_bank_name = patch.beneficiary_bank_name?.trim() || null;

  try {
    const { data, error } = await supabase
      .from('fund_requests')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('fund_request_id', id)
      .eq('zo_user_id', req.user.mobile_number)
      .eq('request_status', 'Draft')
      .is('accounts_line_item_id', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(409).json({ success: false, message: 'Only your unimported Draft fund requests can be edited.' });
    return res.status(200).json({ success: true, fundRequest: data, message: 'Fund request draft saved.' });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'A fund request with this number already exists.' });
    console.error(`updateFundRequestDraft failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save fund request draft.' });
  }
}

/** POST /fund-requests/:id/submit — reserve capacity and notify Accounts. */
async function submitFundRequest(req, res) {
  if (!validate(req, res, submitFundRequestSchema)) return;
  const { id } = req.params;
  try {
    const { data: draft, error: draftError } = await supabase
      .from('fund_requests').select('*').eq('fund_request_id', id).maybeSingle();
    if (draftError) throw draftError;
    if (!draft) return res.status(404).json({ success: false, message: 'Fund request not found.' });
    if (draft.zo_user_id !== req.user.mobile_number && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'You can only submit your own fund requests.' });
    }
    if (draft.request_status !== 'Draft') {
      return res.status(409).json({ success: false, message: `Only Draft fund requests can be submitted. Current status: ${draft.request_status}` });
    }
    if (draft.zo_fr_amount === null || draft.zo_fr_amount === undefined || Number(draft.zo_fr_amount) <= 0) {
      return res.status(422).json({ success: false, message: 'Fund request amount must be greater than zero.' });
    }

    let bankSnapshot;
    try {
      bankSnapshot = await resolveBeneficiaryBank(draft.beneficiary_bank_id, draft.beneficiary_bank_name);
      if (!draft.beneficiary_name || !draft.beneficiary_ac_no || !draft.beneficiary_ifsc || !bankSnapshot.validatedBankId) {
        return res.status(400).json({ success: false, message: 'Complete beneficiary bank details are required before submission.' });
      }
    } catch (err) {
      if (err instanceof BeneficiaryValidationError) return res.status(err.status).json({ success: false, message: err.message });
      throw err;
    }

    const { data: submitted, error: rpcError } = await supabase.rpc('submit_fund_request_transact', {
      p_fund_request_id: id, p_submitted_by: req.user.mobile_number
    });
    if (rpcError) {
      if (rpcError.code === 'BUD02') return res.status(422).json({ success: false, message: rpcError.message });
      if (rpcError.code === 'STA01' || rpcError.code === 'STA06') return res.status(409).json({ success: false, message: rpcError.message });
      if (rpcError.code === 'EST01' || rpcError.code === 'VAL01') return res.status(422).json({ success: false, message: rpcError.message });
      if (rpcError.code === 'AUT01' || rpcError.code === 'STA02' || rpcError.code === 'P0002') return res.status(400).json({ success: false, message: rpcError.message });
      throw rpcError;
    }
    const { notifyAccountsFundRequestSubmitted } = require('../services/telegram.service');
    notifyAccountsFundRequestSubmitted(submitted).catch(err => console.error(`[FUND REQUEST] Telegram notification failed: ${err.message}`));
    return res.status(200).json({ success: true, fundRequest: submitted, message: 'Fund request submitted to Accounts.' });
  } catch (error) {
    console.error(`submitFundRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit fund request.' });
  }
}

/* Legacy direct Fund Request action removed. The historical implementation is
 * retained in this comment only as migration context; no runtime caller or
 * route exposes it. */
/*
async function actOnFundRequest(req, res) {
  if (!validate(req, res, actOnFundRequestSchema)) return;
  const { id } = req.params;
  const { action, approve_ho_amount, approved_amount, transfer_from_account, ho_remarks, remarks } = req.body;
  const finalHoAmount = approve_ho_amount !== undefined && approve_ho_amount !== null ? approve_ho_amount : approved_amount;
  const finalRemarks = ho_remarks || remarks || null;
  const finalTransferAccount = transfer_from_account || 'CC';

  try {
    const { data: fr, error: frError } = await supabase
      .from('fund_requests')
      .select('*')
      .eq('fund_request_id', id)
      .maybeSingle();

    if (frError) throw frError;
    if (!fr) return res.status(404).json({ success: false, message: 'Fund request not found.' });

    if (fr.request_status !== 'Pending' && fr.request_status !== 'Hold') {
      return res.status(403).json({
        success: false,
        message: `Action can only be taken on Pending or Hold requests. Current status: ${fr.request_status}`
      });
    }

    // Once Accounts has imported a request, the Accounts Sheet is the sole source of
    // truth for approval. The sheet approval transaction debits the bank and credits
    // the ZO balance; allowing this legacy endpoint to approve the same request would
    // bypass that review and can result in a second balance credit.
    if (fr.accounts_line_item_id) {
      return res.status(409).json({
        success: false,
        message: 'This fund request is in an Accounts Requisition Sheet and must be actioned through that sheet.'
      });
    }

    let updated;

    if (action === 'Hold') {
      let updatePayload = {
        approve_ho_user_id: req.user.mobile_number,
        approve_ho_date: new Date().toISOString(),
        ho_remarks: finalRemarks?.trim() || null,
        request_status: 'Hold'
      };

      const { data: heldFr, error: updateError } = await supabase
        .from('fund_requests')
        .update(updatePayload)
        .eq('fund_request_id', id)
        .in('request_status', ['Pending', 'Hold'])
        .select()
        .maybeSingle();

      if (updateError) throw updateError;
      if (!heldFr) {
        return res.status(409).json({
          success: false,
          message: 'Conflict: The fund request status was already changed by another action.'
        });
      }
      updated = heldFr;
    }

    if (action === 'Approve') {
      const hoAmount = Number(finalHoAmount);
      if (finalHoAmount === undefined || finalHoAmount === null || isNaN(hoAmount) || hoAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'approve_ho_amount is required for approval and must be greater than zero.'
        });
      }
      if (hoAmount > Number(fr.zo_fr_amount)) {
        return res.status(400).json({
          success: false,
          message: `approve_ho_amount (₹${hoAmount.toLocaleString('en-IN')}) cannot exceed the requested amount (₹${Number(fr.zo_fr_amount).toLocaleString('en-IN')}).`
        });
      }

      if (!VALID_TRANSFER_ACCOUNTS.includes(finalTransferAccount)) {
        return res.status(400).json({
          success: false,
          message: `transfer_from_account is required for approval. Valid values: ${VALID_TRANSFER_ACCOUNTS.join(', ')}.`
        });
      }

      // Call database RPC to atomically increment balance, insert ledger entry, and update status under projects_master lock
      const { data: approvedFr, error: rpcErr } = await supabase.rpc('approve_fund_request_transact', {
        p_fund_request_id: id,
        p_approved_amount: hoAmount,
        p_transfer_from_account: finalTransferAccount,
        p_actioned_by: req.user.mobile_number,
        p_remarks: finalRemarks?.trim() || null
      });

      if (rpcErr) {
        if (rpcErr.code === 'BUD02' || rpcErr.message?.includes('exceeds the remaining Cost Estimate funding capacity')) {
          return res.status(422).json({ success: false, message: rpcErr.message });
        }
        if (rpcErr.code === 'EST01' || rpcErr.message?.includes('No Final Approved cost estimate found')) {
          return res.status(422).json({ success: false, message: rpcErr.message });
        }
        if (rpcErr.message && rpcErr.message.includes('not found')) {
          return res.status(404).json({ success: false, message: rpcErr.message });
        }
        if (rpcErr.message && rpcErr.message.includes('status must be Pending or Hold')) {
          return res.status(400).json({ success: false, message: rpcErr.message });
        }
        throw rpcErr;
      }
      updated = approvedFr;
    }

    if (action === 'Approve') {
      const { notifyZoFundRequestApproved } = require('../services/telegram.service');
      notifyZoFundRequestApproved(fr, updated).catch(err => {
        console.error(`[FUND REQUEST] Telegram notification failed: ${err.message}`);
      });
    } else if (action === 'Hold') {
      const { notifyZoFundRequestHeld } = require('../services/telegram.service');
      notifyZoFundRequestHeld(fr, updated).catch(err => {
        console.error(`[FUND REQUEST] Telegram notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({
      success: true,
      fundRequest: updated,
      message: `Fund request has been ${action === 'Approve' ? 'approved' : 'placed on hold'}.`
    });

  } catch (error) {
    console.error(`actOnFundRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to process fund request action.' });
  }
}

*/
/**
 * PATCH /api/v1/auth/fund-requests/:id/cancel
 * Cancels a fund request. Restricted to creator ZO or Admin.
 */
async function cancelFundRequest(req, res) {
  if (!validate(req, res, cancelFundRequestSchema)) return;
  const { id } = req.params;

  try {
    const { data: fr, error: frError } = await supabase
      .from('fund_requests')
      .select('*')
      .eq('fund_request_id', id)
      .maybeSingle();

    if (frError) throw frError;
    if (!fr) return res.status(404).json({ success: false, message: 'Fund request not found.' });

    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && fr.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only cancel your own fund requests.'
      });
    }

    if (!['Draft', 'Pending'].includes(fr.request_status) || fr.accounts_line_item_id) {
      return res.status(403).json({
        success: false,
        message: `Only unimported Draft or Pending fund requests can be cancelled. Current status: ${fr.request_status}`
      });
    }

    const { data: updated, error: updateError } = await supabase
      .from('fund_requests')
      .update({
        request_status: 'Cancelled',
        cancelled_by: req.user.mobile_number,
        cancelled_at: new Date().toISOString()
      })
      .eq('fund_request_id', id)
      .in('request_status', ['Draft', 'Pending'])
      .is('accounts_line_item_id', null)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: The fund request was already acted upon.'
      });
    }

    return res.status(200).json({
      success: true,
      fundRequest: updated,
      message: 'Fund request cancelled successfully.'
    });

  } catch (error) {
    console.error(`cancelFundRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to cancel fund request.' });
  }
}

module.exports = {
  createFundRequest,
  getFundRequests,
  getFundRequestById,
  updateFundRequestDraft,
  submitFundRequest,
  cancelFundRequest
};
