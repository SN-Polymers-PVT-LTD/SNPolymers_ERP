'use strict';

const { supabase } = require('../db/supabase');
const crypto = require('crypto');
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

  const { zo_user_id, requested_amount, remarks_ho } = req.body;

  try {
    // Verify zo_user_id matches a Zonal Office user
    const { data: zoUser, error: userErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, role')
      .eq('mobile_number', zo_user_id)
      .eq('role', 'zo')
      .maybeSingle();

    if (userErr) throw userErr;
    if (!zoUser) {
      return res.status(400).json({ success: false, message: 'Zonal Office user not found.' });
    }

    const { data: newReturn, error } = await supabase
      .from('excess_fund_returns')
      .insert({
        zo_user_id,
        requested_amount,
        remarks_ho: remarks_ho || null,
        status: 'Requested',
        requested_by: req.user.mobile_number
      })
      .select()
      .single();

    if (error) throw error;

    const { notifyZoExcessReturnRequested } = require('../services/telegram.service');
    notifyZoExcessReturnRequested(newReturn).catch(err => {
      console.error(`[EXCESS RETURN] Telegram notification failed: ${err.message}`);
    });

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

  const { client_updated_at, breakdown } = req.body;

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

    // 3. Validate status
    if (!['Requested', 'Awaiting HO Review'].includes(returnRequest.status)) {
      return res.status(400).json({ success: false, message: 'Excess fund return request cannot be accepted in its current status.' });
    }

    // 4. Concurrency check
    if (new Date(returnRequest.updated_at).getTime() !== new Date(client_updated_at).getTime()) {
      return res.status(409).json({ success: false, message: 'Stale acceptance request.' });
    }

    // 5. Verify breakdown sum matches requested_amount
    const totalAllocated = breakdown.reduce((sum, item) => sum + Number(item.amount), 0);
    if (Math.abs(totalAllocated - Number(returnRequest.requested_amount)) > 0.01) {
      return res.status(400).json({
        success: false,
        message: `Total breakdown allocation (₹${totalAllocated.toLocaleString('en-IN')}) does not match the requested amount (₹${Number(returnRequest.requested_amount).toLocaleString('en-IN')}).`
      });
    }

    // 6. Verify ZO has sufficient available balance for each Work Order in the breakdown
    for (const item of breakdown) {
      const { data: ledgerEntries, error: ledgerErr } = await supabase
        .from('zo_fund_ledger')
        .select('amount')
        .eq('zo_user_id', returnRequest.zo_user_id)
        .eq('work_order_no', item.work_order_no);

      if (ledgerErr) throw ledgerErr;

      const currentWoBalance = (ledgerEntries || []).reduce((sum, entry) => sum + Number(entry.amount), 0);
      if (item.amount > currentWoBalance) {
        return res.status(422).json({
          success: false,
          message: `Insufficient available balance on Work Order ${item.work_order_no}. Available: ₹${currentWoBalance.toLocaleString('en-IN')}, Requested: ₹${item.amount.toLocaleString('en-IN')}.`
        });
      }
    }

    // 7. Lock and check ZO total balance
    const { data: zoBal, error: balErr } = await supabase
      .from('zo_balances')
      .select('available_balance')
      .eq('zo_user_id', returnRequest.zo_user_id)
      .maybeSingle();

    if (balErr) throw balErr;
    if (!zoBal || Number(zoBal.available_balance) < returnRequest.requested_amount) {
      return res.status(422).json({ success: false, message: 'Insufficient total available balance.' });
    }

    // 8. Deduct from total ZO balance
    const newTotalBalance = Number(zoBal.available_balance) - Number(returnRequest.requested_amount);
    const { error: updateBalErr } = await supabase
      .from('zo_balances')
      .update({ available_balance: newTotalBalance, updated_at: new Date().toISOString() })
      .eq('zo_user_id', returnRequest.zo_user_id);

    if (updateBalErr) throw updateBalErr;

    // 9. Insert ledger entries for each breakdown item
    let ledgerInserts;
    if (breakdown && breakdown.length > 0) {
      ledgerInserts = breakdown.map(item => ({
        zo_user_id: returnRequest.zo_user_id,
        transaction_type: 'RETURN',
        reference_type: 'RETURN',
        reference_id: crypto.randomUUID(), // unique UUID to prevent idx_zo_fund_ledger_ref_unique violation
        amount: -Number(item.amount),
        work_order_no: item.work_order_no,
        created_by: req.user.mobile_number
      }));
    } else {
      // Fallback: single entry using the request's work_order_no
      if (!returnRequest.work_order_no) {
        return res.status(400).json({ success: false, message: 'Breakdown is required when the return request does not specify a Work Order.' });
      }
      ledgerInserts = [{
        zo_user_id: returnRequest.zo_user_id,
        transaction_type: 'RETURN',
        reference_type: 'RETURN',
        reference_id: id,
        amount: -Number(returnRequest.requested_amount),
        work_order_no: returnRequest.work_order_no,
        created_by: req.user.mobile_number
      }];
    }

    const { error: ledgerInsertErr } = await supabase
      .from('zo_fund_ledger')
      .insert(ledgerInserts);

    if (ledgerInsertErr) throw ledgerInsertErr;

    // 10. Update the return request
    const { data: updatedRequest, error: updateReqErr } = await supabase
      .from('excess_fund_returns')
      .update({
        status: 'Completed',
        actioned_by: req.user.mobile_number,
        breakdown,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (updateReqErr) throw updateReqErr;

    const { notifyHoExcessReturnAccepted } = require('../services/telegram.service');
    notifyHoExcessReturnAccepted(updatedRequest).catch(err => {
      console.error(`[EXCESS RETURN] Telegram notification failed: ${err.message}`);
    });

    return res.status(200).json({
      success: true,
      returnRequest: updatedRequest,
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
