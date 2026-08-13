'use strict';

const { supabase } = require('../db/supabase');

const DUPLICATE_BREAK_MESSAGE =
  'A non-terminal activity break already exists for this work order.';

const NON_TERMINAL_STATUSES = [
  'Pending ZO Review',
  'Pending HO Review',
  'Active',
  'Reopen Requested'
];

const ACTION_ROLES = {
  Cancel: ['je'],
  Accept: ['zo'],
  Reject: ['zo'],
  RequestReopen: ['zo'],
  Approve: ['ho', 'admin'],
  ApproveReopen: ['ho', 'admin']
};

const TRANSITIONS = {
  Cancel: { from: 'Pending ZO Review', to: 'Cancelled by JE' },
  Accept: { from: 'Pending ZO Review', to: 'Pending HO Review' },
  Reject: { from: 'Pending ZO Review', to: 'Rejected by ZO' },
  Approve: { from: 'Pending HO Review', to: 'Active' },
  RequestReopen: { from: 'Active', to: 'Reopen Requested' },
  ApproveReopen: { from: 'Reopen Requested', to: 'Ended' }
};

const JE_PUBLIC_FIELDS = [
  'id',
  'work_order_no',
  'status',
  'start_date',
  'expected_end_date',
  'je_remarks',
  'zo_remarks',
  'reopen_remarks',
  'created_at'
];

function refreshAnalyticsInBackground() {
  (async () => {
    try {
      await supabase.rpc('refresh_analytics_views');
    } catch (err) {
      console.warn('[ACTIVITY BREAK] refresh_analytics_views failed:', err?.message || err);
    }
  })();
}

function sanitizeBreakForRole(row, role) {
  if (role !== 'je' || !row) return row;
  const sanitized = {};
  JE_PUBLIC_FIELDS.forEach((key) => {
    sanitized[key] = row[key];
  });
  return sanitized;
}

async function getVisibleWorkOrderNos(user) {
  if (user.role === 'ho' || user.role === 'admin') {
    return null; // unrestricted
  }

  if (user.role === 'je') {
    const { data, error } = await supabase
      .from('work_order_mappings')
      .select('work_order_no')
      .eq('je_user_id', user.mobile_number)
      .eq('is_active', true);
    if (error) throw error;
    return (data || []).map((r) => r.work_order_no);
  }

  if (user.role === 'zo') {
    const { data, error } = await supabase
      .from('projects_master')
      .select('work_order_no')
      .eq('zo_user_id', user.mobile_number);
    if (error) throw error;
    return (data || []).map((r) => r.work_order_no);
  }

  return [];
}

async function assertZoOwnsWorkOrder(zoMobile, workOrderNo) {
  const { data: project, error } = await supabase
    .from('projects_master')
    .select('zo_user_id')
    .eq('work_order_no', workOrderNo)
    .maybeSingle();
  if (error) throw error;
  if (!project || project.zo_user_id !== zoMobile) {
    const err = new Error('ZONE_FORBIDDEN');
    throw err;
  }
}

/**
 * POST /api/v1/auth/activity-breaks
 */
async function createBreakRequest(req, res) {
  const { work_order_no, start_date, expected_end_date, je_remarks } = req.body;
  const wo = work_order_no.trim();

  try {
    const { data: project, error: projectErr } = await supabase
      .from('projects_master')
      .select('status')
      .eq('work_order_no', wo)
      .maybeSingle();

    if (projectErr) throw projectErr;
    if (!project) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }
    if (project.status !== 'Running') {
      return res.status(409).json({
        success: false,
        message: 'Activity breaks can only be requested for Running work orders.'
      });
    }

    const { data: woMapping, error: woMapErr } = await supabase
      .from('work_order_mappings')
      .select('id')
      .eq('je_user_id', req.user.mobile_number)
      .eq('work_order_no', wo)
      .eq('is_active', true)
      .maybeSingle();

    if (woMapErr) throw woMapErr;
    if (!woMapping) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not mapped to this Work Order.'
      });
    }

    const { data: existing, error: existingErr } = await supabase
      .from('work_order_activity_breaks')
      .select('id')
      .eq('work_order_no', wo)
      .in('status', NON_TERMINAL_STATUSES)
      .limit(1);

    if (existingErr) throw existingErr;
    if (existing && existing.length > 0) {
      return res.status(409).json({ success: false, message: DUPLICATE_BREAK_MESSAGE });
    }

    const { data: created, error: insertErr } = await supabase
      .from('work_order_activity_breaks')
      .insert([
        {
          work_order_no: wo,
          status: 'Pending ZO Review',
          start_date,
          expected_end_date,
          je_user_id: req.user.mobile_number,
          je_remarks: je_remarks.trim()
        }
      ])
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({ success: false, message: DUPLICATE_BREAK_MESSAGE });
      }
      throw insertErr;
    }

    refreshAnalyticsInBackground();

    const { notifyBreakRequestSubmitted } = require('../services/telegram.service');
    notifyBreakRequestSubmitted(created).catch((err) => {
      console.error(`[ACTIVITY BREAK] Telegram notification failed: ${err.message}`);
    });

    return res.status(201).json({ success: true, break: sanitizeBreakForRole(created, req.user.role) });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('createBreakRequest failed:', error);
    } else {
      console.error(`createBreakRequest failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to create activity break request.' });
  }
}

/**
 * GET /api/v1/auth/activity-breaks
 */
async function getBreakRequests(req, res) {
  try {
    const query = req.query || {};
    const visibleWos = await getVisibleWorkOrderNos(req.user);

    if (Array.isArray(visibleWos) && visibleWos.length === 0) {
      return res.status(200).json({
        success: true,
        breaks: [],
        pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
      });
    }

    let dbQuery = supabase.from('work_order_activity_breaks').select('*', { count: 'exact' });

    if (Array.isArray(visibleWos)) {
      dbQuery = dbQuery.in('work_order_no', visibleWos);
    }

    if (query.work_order_no) {
      const requestedWo = String(query.work_order_no).trim();
      if (Array.isArray(visibleWos) && !visibleWos.includes(requestedWo)) {
        return res.status(200).json({
          success: true,
          breaks: [],
          pagination: { page: 1, limit: 20, total: 0, totalPages: 0 }
        });
      }
      dbQuery = dbQuery.eq('work_order_no', requestedWo);
    }

    if (query.status) {
      dbQuery = dbQuery.eq('status', String(query.status).trim());
    }

    dbQuery = dbQuery.order('created_at', { ascending: false });

    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit, 10) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { data: rows, count, error } = await dbQuery.range(offset, offset + limit - 1);
    if (error) throw error;

    const total = count || 0;
    return res.status(200).json({
      success: true,
      breaks: (rows || []).map((row) => sanitizeBreakForRole(row, req.user.role)),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getBreakRequests failed:', error);
    } else {
      console.error(`getBreakRequests failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to fetch activity breaks.' });
  }
}

/**
 * GET /api/v1/auth/activity-breaks/:id
 */
async function getBreakRequestById(req, res) {
  try {
    const { data: row, error } = await supabase
      .from('work_order_activity_breaks')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) throw error;
    if (!row) {
      return res.status(404).json({ success: false, message: 'Activity break not found.' });
    }

    const visibleWos = await getVisibleWorkOrderNos(req.user);
    if (Array.isArray(visibleWos) && !visibleWos.includes(row.work_order_no)) {
      return res.status(404).json({ success: false, message: 'Activity break not found.' });
    }

    return res.status(200).json({
      success: true,
      break: sanitizeBreakForRole(row, req.user.role)
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getBreakRequestById failed:', error);
    } else {
      console.error(`getBreakRequestById failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to fetch activity break.' });
  }
}

/**
 * PATCH /api/v1/auth/activity-breaks/:id/action
 */
async function actOnBreakRequest(req, res) {
  const { action, remarks } = req.body;
  const role = req.user.role;

  try {
    const allowedRoles = ACTION_ROLES[action];
    if (!allowedRoles || !allowedRoles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not allowed to perform this action.'
      });
    }

    const { data: existing, error: fetchErr } = await supabase
      .from('work_order_activity_breaks')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Activity break not found.' });
    }

    const transition = TRANSITIONS[action];
    if (!transition || existing.status !== transition.from) {
      return res.status(409).json({
        success: false,
        message: `Invalid state transition for current status '${existing.status}'.`
      });
    }

    if (action === 'Cancel' && existing.je_user_id !== req.user.mobile_number) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You can only cancel your own break request.'
      });
    }

    if (['Accept', 'Reject', 'RequestReopen'].includes(action)) {
      try {
        await assertZoOwnsWorkOrder(req.user.mobile_number, existing.work_order_no);
      } catch (zoneErr) {
        if (zoneErr.message === 'ZONE_FORBIDDEN') {
          return res.status(403).json({
            success: false,
            message: 'Access denied. This work order is not in your zone.'
          });
        }
        throw zoneErr;
      }
    }

    if (action === 'Reject' && (!remarks || !String(remarks).trim())) {
      return res.status(400).json({
        success: false,
        message: 'Remarks are required when rejecting an activity break request.'
      });
    }

    const now = new Date().toISOString();
    const patch = {
      status: transition.to,
      updated_at: now
    };

    if (action === 'Accept' || action === 'Reject') {
      patch.zo_user_id = req.user.mobile_number;
      patch.zo_actioned_at = now;
      if (remarks) patch.zo_remarks = remarks.trim();
    }
    if (action === 'Approve') {
      patch.ho_user_id = req.user.mobile_number;
      patch.ho_actioned_at = now;
    }
    if (action === 'RequestReopen') {
      patch.reopen_requested_by = req.user.mobile_number;
      patch.reopen_requested_at = now;
      if (remarks) patch.reopen_remarks = remarks.trim();
    }
    if (action === 'ApproveReopen') {
      patch.reopen_ho_user_id = req.user.mobile_number;
      patch.reopen_ho_actioned_at = now;
    }

    const { data: updated, error: updateErr } = await supabase
      .from('work_order_activity_breaks')
      .update(patch)
      .eq('id', existing.id)
      .select()
      .single();

    if (updateErr) throw updateErr;

    refreshAnalyticsInBackground();

    const {
      notifyBreakZoActed,
      notifyBreakHoApproved,
      notifyBreakReopenRequested,
      notifyBreakStatusChanged
    } = require('../services/telegram.service');

    if (action === 'Accept' || action === 'Reject') {
      notifyBreakZoActed(updated).catch((err) => {
        console.error(`[ACTIVITY BREAK] Telegram notification failed: ${err.message}`);
      });
    } else if (action === 'Approve') {
      notifyBreakHoApproved(updated).catch((err) => {
        console.error(`[ACTIVITY BREAK] Telegram notification failed: ${err.message}`);
      });
    } else if (action === 'RequestReopen') {
      notifyBreakReopenRequested(updated).catch((err) => {
        console.error(`[ACTIVITY BREAK] Telegram notification failed: ${err.message}`);
      });
    } else if (action === 'ApproveReopen') {
      notifyBreakStatusChanged(updated, 'Ended').catch((err) => {
        console.error(`[ACTIVITY BREAK] Telegram notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({
      success: true,
      break: sanitizeBreakForRole(updated, req.user.role)
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('actOnBreakRequest failed:', error);
    } else {
      console.error(`actOnBreakRequest failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to update activity break.' });
  }
}

module.exports = {
  createBreakRequest,
  getBreakRequests,
  getBreakRequestById,
  actOnBreakRequest
};
