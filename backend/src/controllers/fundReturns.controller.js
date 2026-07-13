'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const {
  createReturnSchema,
  acceptReturnSchema,
  actionReturnSchema,
  hoActionReturnSchema
} = require('../validation/fundReturns.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Display name resolver helper
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
 * POST /api/v1/auth/excess-fund-returns
 * Creates a new return request. (Admin/HO only)
 */
async function createReturnRequest(req, res) {
  if (!validate(req, res, createReturnSchema)) return;

  const { work_order_no, zo_user_id, requested_amount, remarks_ho } = req.body;

  try {
    // Verify work order matches ZO
    const { data: project, error: projErr } = await supabase
      .from('projects_master')
      .select('work_order_no, zo_user_id, status')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) {
      return res.status(400).json({ success: false, message: 'Work Order not found.' });
    }
    if (project.zo_user_id !== zo_user_id) {
      return res.status(400).json({ success: false, message: 'Work Order mismatch with Zonal Office.' });
    }
    if (project.status === 'Closed') {
      return res.status(400).json({ success: false, message: 'Cannot request funds from a closed Work Order.' });
    }

    const { data: newReturn, error } = await supabase
      .from('excess_fund_returns')
      .insert({
        work_order_no,
        zo_user_id,
        requested_amount,
        remarks_ho: remarks_ho || null,
        status: 'Requested',
        requested_by: req.user.mobile_number
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      returnRequest: newReturn,
      message: 'Excess fund return request created successfully.'
    });

  } catch (error) {
    console.error(`createReturnRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create return request.' });
  }
}

/**
 * POST /api/v1/auth/excess-fund-returns/:id/accept
 * Accepts a return request and deducts balance. (ZO only)
 */
async function acceptReturnRequest(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid return request ID.' });
  }

  if (!validate(req, res, acceptReturnSchema)) return;

  const { client_updated_at } = req.body;

  try {
    // 1. Retrieve the return request
    const { data: returnRequest, error: fetchErr } = await supabase
      .from('excess_fund_returns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: 'Excess fund return request not found.' });
    }

    // 2. Validate ownership
    if (returnRequest.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    // 3. Call the database RPC
    const { data: actioned, error: rpcErr } = await supabase.rpc('accept_excess_fund_return', {
      p_return_id: id,
      p_client_updated_at: client_updated_at,
      p_actioned_by: req.user.mobile_number
    });

    if (rpcErr) {
      if (rpcErr.message && rpcErr.message.includes('Stale acceptance request')) {
        return res.status(409).json({ success: false, message: 'Stale acceptance request.' });
      }
      if (rpcErr.message && rpcErr.message.includes('Insufficient available balance')) {
        return res.status(422).json({ success: false, message: 'Insufficient available balance.' });
      }
      if (rpcErr.message && rpcErr.message.includes('cannot be accepted in its current status')) {
        return res.status(400).json({ success: false, message: rpcErr.message });
      }
      throw rpcErr;
    }

    return res.status(200).json({
      success: true,
      returnRequest: actioned,
      message: 'Excess fund return accepted and processed successfully.'
    });

  } catch (error) {
    console.error(`acceptReturnRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to accept return request.' });
  }
}

/**
 * PATCH /api/v1/auth/excess-fund-returns/:id/reject
 * Rejects a return request. (ZO only)
 */
async function rejectReturnRequest(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid return request ID.' });
  }

  if (!validate(req, res, actionReturnSchema)) return;

  const { remarks_zo } = req.body;

  try {
    const { data: returnRequest, error: fetchErr } = await supabase
      .from('excess_fund_returns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: 'Excess fund return request not found.' });
    }

    if (returnRequest.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (!['Requested', 'Awaiting HO Review'].includes(returnRequest.status)) {
      return res.status(400).json({ success: false, message: 'Return request cannot be rejected in its current status.' });
    }

    const { data: updated, error } = await supabase
      .from('excess_fund_returns')
      .update({
        status: 'Rejected',
        remarks_zo,
        actioned_by: req.user.mobile_number,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      returnRequest: updated,
      message: 'Excess fund return request rejected successfully.'
    });

  } catch (error) {
    console.error(`rejectReturnRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to reject return request.' });
  }
}

/**
 * PATCH /api/v1/auth/excess-fund-returns/:id/modify
 * Requests a revision/modification to a return request. (ZO only)
 */
async function modifyReturnRequest(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid return request ID.' });
  }

  if (!validate(req, res, actionReturnSchema)) return;

  const { remarks_zo } = req.body;

  try {
    const { data: returnRequest, error: fetchErr } = await supabase
      .from('excess_fund_returns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: 'Excess fund return request not found.' });
    }

    if (returnRequest.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    if (!['Requested', 'Awaiting HO Review'].includes(returnRequest.status)) {
      return res.status(400).json({ success: false, message: 'Return request cannot be modified in its current status.' });
    }

    const { data: updated, error } = await supabase
      .from('excess_fund_returns')
      .update({
        status: 'Awaiting HO Review',
        remarks_zo,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      returnRequest: updated,
      message: 'Excess fund return modification request submitted successfully.'
    });

  } catch (error) {
    console.error(`modifyReturnRequest failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to request modification.' });
  }
}

/**
 * PATCH /api/v1/auth/excess-fund-returns/:id/ho-action
 * Action on return request modifications. (Admin/HO only)
 */
async function hoActionOnReturn(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid return request ID.' });
  }

  if (!validate(req, res, hoActionReturnSchema)) return;

  const { status, requested_amount, remarks_ho } = req.body;

  try {
    const { data: returnRequest, error: fetchErr } = await supabase
      .from('excess_fund_returns')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!returnRequest) {
      return res.status(404).json({ success: false, message: 'Excess fund return request not found.' });
    }

    if (!['Awaiting HO Review', 'Rejected'].includes(returnRequest.status)) {
      return res.status(400).json({ success: false, message: 'Return request cannot be revised/cancelled in its current status.' });
    }

    const updatePayload = {
      status,
      updated_at: new Date().toISOString()
    };
    if (requested_amount !== undefined) {
      updatePayload.requested_amount = requested_amount;
    }
    if (remarks_ho !== undefined) {
      updatePayload.remarks_ho = remarks_ho;
    }

    const { data: updated, error } = await supabase
      .from('excess_fund_returns')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      returnRequest: updated,
      message: `Return request ${status.toLowerCase()} successfully.`
    });

  } catch (error) {
    console.error(`hoActionOnReturn failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to process HO action.' });
  }
}

/**
 * GET /api/v1/auth/excess-fund-returns
 * Retrieves return requests list.
 */
async function getReturnRequests(req, res) {
  try {
    let dbQuery = supabase
      .from('excess_fund_returns')
      .select('*');

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    }

    const { data: returns, error } = await dbQuery.order('created_at', { ascending: false });

    if (error) throw error;

    const enriched = [];
    if (returns && returns.length > 0) {
      const mobiles = [];
      returns.forEach(r => {
        mobiles.push(r.zo_user_id);
        mobiles.push(r.requested_by);
        mobiles.push(r.actioned_by);
      });
      const userMap = await resolveDisplayNames(mobiles);

      returns.forEach(r => {
        enriched.push({
          ...r,
          zo_name: userMap[r.zo_user_id] || r.zo_user_id,
          requested_by_name: userMap[r.requested_by] || r.requested_by,
          actioned_by_name: userMap[r.actioned_by] || r.actioned_by || null
        });
      });
    }

    return res.status(200).json({
      success: true,
      returns: enriched
    });

  } catch (error) {
    console.error(`getReturnRequests failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve return requests.' });
  }
}

module.exports = {
  createReturnRequest,
  acceptReturnRequest,
  rejectReturnRequest,
  modifyReturnRequest,
  hoActionOnReturn,
  getReturnRequests
};
