'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createFundRequestSchema, actOnFundRequestSchema, cancelFundRequestSchema } = require('../validation/fundRequest.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const VALID_STATUSES = ['Pending', 'Approved', 'Hold', 'Cancelled'];
const VALID_TRANSFER_ACCOUNTS = ['CC', 'OD', 'CR'];

// Role normalization (staff treated as zo for fund request purposes)
function getEffectiveFrRole(role) {
  return role === 'staff' ? 'zo' : role;
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
 * Creates a new fund request.
 */
async function createFundRequest(req, res) {
  if (!validate(req, res, createFundRequestSchema)) return;
  const { zo_fr_no, zo_fr_amount, zo_remarks } = req.body;
  const amount = zo_fr_amount;

  try {
    // Unique check
    const { count, error: countError } = await supabase
      .from('fund_requests')
      .select('zo_fr_no', { count: 'exact', head: true })
      .eq('zo_fr_no', zo_fr_no.trim());

    if (countError) throw countError;
    if (count && count > 0) {
      return res.status(409).json({ success: false, message: `A fund request with number ${zo_fr_no.trim()} already exists.` });
    }

    const { data: newFr, error: insertError } = await supabase
      .from('fund_requests')
      .insert([
        {
          zo_user_id: req.user.mobile_number,
          zo_fr_no: zo_fr_no.trim(),
          zo_fr_amount: amount,
          zo_remarks: zo_remarks?.trim() || null,
          created_by: req.user.mobile_number,
          request_status: 'Pending'
        }
      ])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({ success: false, message: `A fund request with number ${zo_fr_no.trim()} already exists.` });
      }
      throw insertError;
    }

    return res.status(201).json({
      success: true,
      fundRequest: newFr,
      message: 'Fund request created successfully.'
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

    const enriched = (fundRequests || []).map(fr => ({
      ...fr,
      zo_name: userMap[fr.zo_user_id] || fr.zo_user_id || null,
      approve_ho_name: userMap[fr.approve_ho_user_id] || fr.approve_ho_user_id || null,
      cancelled_by_name: userMap[fr.cancelled_by] || fr.cancelled_by || null
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

/**
 * PATCH /api/v1/auth/fund-requests/:id/action
 * Workflow action on a fund request (Approve or Hold) by HO or Admin.
 */
async function actOnFundRequest(req, res) {
  if (!validate(req, res, actOnFundRequestSchema)) return;
  const { id } = req.params;
  const { action, approve_ho_amount, transfer_from_account, ho_remarks } = req.body;

  try {
    const { data: fr, error: frError } = await supabase
      .from('fund_requests')
      .select('*')
      .eq('fund_request_id', id)
      .maybeSingle();

    if (frError) throw frError;
    if (!fr) return res.status(404).json({ success: false, message: 'Fund request not found.' });

    if (fr.request_status !== 'Pending') {
      return res.status(403).json({
        success: false,
        message: `Action can only be taken on Pending requests. Current status: ${fr.request_status}`
      });
    }

    let updatePayload = {
      approve_ho_user_id: req.user.mobile_number,
      approve_ho_date: new Date().toISOString(),
      ho_remarks: ho_remarks?.trim() || null
    };

    if (action === 'Hold') {
      updatePayload.request_status = 'Hold';
    }

    if (action === 'Approve') {
      const hoAmount = Number(approve_ho_amount);
      if (!approve_ho_amount || isNaN(hoAmount) || hoAmount <= 0) {
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

      if (!VALID_TRANSFER_ACCOUNTS.includes(transfer_from_account)) {
        return res.status(400).json({
          success: false,
          message: `transfer_from_account is required for approval. Valid values: ${VALID_TRANSFER_ACCOUNTS.join(', ')}.`
        });
      }

      updatePayload.request_status = 'Approved';
      updatePayload.approve_ho_amount = hoAmount;
      updatePayload.transfer_from_account = transfer_from_account;
    }

    const { data: updated, error: updateError } = await supabase
      .from('fund_requests')
      .update(updatePayload)
      .eq('fund_request_id', id)
      .eq('request_status', 'Pending') // optimistic lock
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: The fund request status was already changed by another action.'
      });
    }

    if (action === 'Approve') {
      const { notifyZoFundRequestApproved } = require('../services/telegram.service');
      notifyZoFundRequestApproved(fr, updated).catch(err => {
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

    if (fr.request_status !== 'Pending') {
      return res.status(403).json({
        success: false,
        message: `Only Pending fund requests can be cancelled. Current status: ${fr.request_status}`
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
      .eq('request_status', 'Pending') // optimistic lock
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
  actOnFundRequest,
  cancelFundRequest
};
