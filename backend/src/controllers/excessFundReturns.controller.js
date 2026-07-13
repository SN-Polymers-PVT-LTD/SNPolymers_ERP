'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createReturnSchema, actionReturnSchema } = require('../validation/excessFundReturns.schema');

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
 * Creates a new Pending excess fund return request. (ZO only)
 */
async function createExcessFundReturn(req, res) {
  if (req.user.role !== 'zo') {
    return res.status(403).json({
      success: false,
      message: 'Only Zonal Office users can request excess fund returns.'
    });
  }

  if (!validate(req, res, createReturnSchema)) return;

  const { requested_amount, remarks } = req.body;

  try {
    const { data: newReturn, error } = await supabase
      .from('excess_fund_returns')
      .insert({
        zo_user_id: req.user.mobile_number,
        requested_amount,
        remarks: remarks || null,
        status: 'Pending'
      })
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      returnRequest: newReturn,
      message: 'Excess fund return request submitted successfully.'
    });

  } catch (error) {
    console.error(`createExcessFundReturn failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit excess fund return request.' });
  }
}

/**
 * PATCH /api/v1/auth/excess-fund-returns/:id/action
 * Approves or Rejects an excess fund return request. (Admin/HO only)
 */
async function actionExcessFundReturn(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid return request ID format.' });
  }

  if (!validate(req, res, actionReturnSchema)) return;

  const { status, remarks } = req.body;

  try {
    const { data: actioned, error } = await supabase.rpc('action_excess_fund_return', {
      p_return_id: id,
      p_status: status,
      p_actioned_by: req.user.mobile_number,
      p_action_remarks: remarks || null
    });

    if (error) {
      if (error.message && error.message.includes('Insufficient Zonal Office balance')) {
        return res.status(400).json({ success: false, message: error.message });
      }
      if (error.message && error.message.includes('already been actioned')) {
        return res.status(409).json({ success: false, message: error.message });
      }
      if (error.message && error.message.includes('not found')) {
        return res.status(404).json({ success: false, message: error.message });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      returnRequest: actioned,
      message: `Excess fund return request ${status.toLowerCase()} successfully.`
    });

  } catch (error) {
    console.error(`actionExcessFundReturn failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to action excess fund return request.' });
  }
}

/**
 * GET /api/v1/auth/excess-fund-returns
 * Retrieves excess fund returns. (ZOs see own returns; Admin/HO see all)
 */
async function getExcessFundReturns(req, res) {
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
        mobiles.push(r.actioned_by);
      });
      const userMap = await resolveDisplayNames(mobiles);

      returns.forEach(r => {
        enriched.push({
          ...r,
          zo_name: userMap[r.zo_user_id] || r.zo_user_id,
          actioned_by_name: userMap[r.actioned_by] || r.actioned_by || null
        });
      });
    }

    return res.status(200).json({
      success: true,
      returns: enriched
    });

  } catch (error) {
    console.error(`getExcessFundReturns failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve excess fund returns.' });
  }
}

module.exports = {
  createExcessFundReturn,
  actionExcessFundReturn,
  getExcessFundReturns
};
