const { supabase } = require('../db/supabase');
const ESTIMATE_STATUS = require('../constants/estimate-status');
const APPROVAL_STATUS = require('../constants/approval-status');
const { SUBMITTABLE_STATUSES } = require('../workflow/estimate-rules');
const {
  getEstimateById,
  isOwnerOrAdmin,
  getEffectiveRole,
  canViewEstimate,
  resolveDisplayNames,
  uuidRegex
} = require('./estimates.helpers');

/**
 * POST /api/v1/auth/estimates/:id/submit
 * Submits an estimate header (Draft, ZO Revision Requested, or HO Revision Requested) atomically.
 */
async function submitEstimate(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Gating & Ownership check
    if (!(await isOwnerOrAdmin(estimate, req.user))) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this estimate.' });
    }

    if (!SUBMITTABLE_STATUSES.includes(estimate.estimate_status)) {
      return res.status(403).json({ success: false, message: 'Estimate cannot be submitted in its current status.' });
    }

    // Verify that no other active estimate exists for this work order
    const { data: otherActive, error: otherActiveErr } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .eq('work_order_no', estimate.work_order_no)
      .neq('estimate_id', id)
      .not('estimate_status', 'in', `("${ESTIMATE_STATUS.FINAL_APPROVED}","${ESTIMATE_STATUS.REJECTED_BY_ZO}","${ESTIMATE_STATUS.REJECTED_BY_HO}")`);

    if (otherActiveErr) throw otherActiveErr;
    if (otherActive && otherActive.length > 0) {
      return res.status(409).json({
        success: false,
        message: 'An estimate already exists for the selected Work Order.'
      });
    }

    // Fetch all items associated with this estimate
    const { data: items, error: itemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', id);

    if (itemsError) throw itemsError;

    // Zero-item check
    if (!items || items.length === 0) {
      return res.status(422).json({
        success: false,
        message: 'Estimate must contain at least one line item.'
      });
    }

    // Work Order Value budget limit check
    const { data: project, error: projectError } = await supabase
      .from('projects_master')
      .select('work_order_value')
      .eq('work_order_no', estimate.work_order_no)
      .maybeSingle();

    if (projectError) throw projectError;
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Associated Work Order not found.'
      });
    }

    const totalEstimateAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    const workOrderValue = Number(project.work_order_value) || 0;

    if (totalEstimateAmount > workOrderValue) {
      return res.status(422).json({
        success: false,
        message: `Estimate submission rejected. Total estimate cost (₹${totalEstimateAmount.toFixed(2)}) exceeds the Work Order Value (₹${workOrderValue.toFixed(2)}).`
      });
    }

    // Completeness validation
    const errors = [];
    items.forEach((item, index) => {
      const missing_fields = [];
      if (!item.material_main_head || String(item.material_main_head).trim() === '') missing_fields.push('material_main_head');
      if (!item.material_sub_head || String(item.material_sub_head).trim() === '') missing_fields.push('material_sub_head');
      if (!item.material_details || String(item.material_details).trim() === '') missing_fields.push('material_details');
      if (!item.unit || String(item.unit).trim() === '') missing_fields.push('unit');
      if (item.qty === null || item.qty === undefined || Number(item.qty) <= 0) missing_fields.push('qty');
      if (item.rate === null || item.rate === undefined || Number(item.rate) <= 0) missing_fields.push('rate');
      if (!item.rate_reference || String(item.rate_reference).trim() === '') missing_fields.push('rate_reference');

      if (missing_fields.length > 0) {
        errors.push({
          item_id: item.item_id,
          item_index: index,
          missing_fields
        });
      }
    });

    if (errors.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'Estimate is incomplete.',
        errors
      });
    }

    // Status Transitions & Transactions
    const isFirstSubmit = estimate.estimate_status === ESTIMATE_STATUS.DRAFT;
    const isZoResubmit = estimate.estimate_status === ESTIMATE_STATUS.ZO_REVISION_REQUESTED;
    const new_revision = estimate.estimate_revision + 1;

    const p_stage = isFirstSubmit ? 'FirstSubmit' : (isZoResubmit ? 'ZO' : 'HO');

    // Call public.submit_estimate RPC
    const { error: rpcError } = await supabase.rpc('submit_estimate', {
      p_estimate_id: id,
      p_stage,
      p_mobile_number: req.user.mobile_number,
      p_new_revision: new_revision
    });

    if (rpcError) throw rpcError;

    // Fetch the updated estimate
    const { data: updatedEstimate, error: fetchError } = await supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)')
      .eq('estimate_id', id)
      .single();

    if (fetchError) throw fetchError;

    // Non-blocking Telegram notification (async)
    const { notifyZoEstimateSubmitted } = require('../services/telegram.service');
    notifyZoEstimateSubmitted(updatedEstimate).catch(err => {
      console.error(`Telegram notification failed: ${err.message}`);
    });

    return res.status(200).json({
      success: true,
      estimate: updatedEstimate,
      message: 'Estimate submitted successfully.'
    });

  } catch (error) {
    console.error(`submitEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit cost estimate.' });
  }
}

/**
 * PATCH /api/v1/auth/estimates/:id/review
 * Opens an estimate for review. Transitions Submitted -> Under ZO Review or ZO Approved -> Under HO Review.
 * Also handles revision deadline expiration atomically via RPC.
 */
async function reviewEstimate(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Workflow actor and status check
    const effectiveRole = getEffectiveRole(req.user.role);
    const isZoOrAdmin = ['zo', 'admin'].includes(effectiveRole);
    const isHoOrAdmin = ['ho', 'admin'].includes(effectiveRole);

    let allowed = false;
    if (estimate.estimate_status === ESTIMATE_STATUS.SUBMITTED) {
      allowed = isZoOrAdmin;
    } else if (estimate.estimate_status === ESTIMATE_STATUS.ZO_APPROVED) {
      allowed = isHoOrAdmin;
    } else if (estimate.estimate_status === ESTIMATE_STATUS.ZO_REVISION_REQUESTED) {
      allowed = isZoOrAdmin;
    } else if (estimate.estimate_status === ESTIMATE_STATUS.HO_REVISION_REQUESTED) {
      allowed = isHoOrAdmin;
    }

    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied for this workflow stage.' });
    }

    // Revision Deadline Check (Auto-Resubmit)
    const { data: openLog, error: logError } = await supabase
      .from('estimate_revision_log')
      .select('*')
      .eq('estimate_id', id)
      .is('resubmitted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (logError) throw logError;

    if (openLog) {
      const now = new Date();
      const deadline = new Date(openLog.revision_deadline);
      if (now > deadline) {
        // Deadline expired! Perform auto-resubmission via SQL RPC
        const { error: rpcError } = await supabase.rpc('auto_resubmit_estimate', {
          p_estimate_id: id,
          p_stage: openLog.stage
        });

        if (rpcError) throw rpcError;

        // Fetch updated estimate header to return
        const { data: updatedEst, error: fetchError } = await supabase
          .from('project_cost_estimates')
          .select('*, projects_master(*)')
          .eq('estimate_id', id)
          .single();

        if (fetchError) throw fetchError;

        return res.status(200).json({
          success: true,
          estimate: updatedEst,
          message: 'Revision deadline expired. Estimate auto-resubmitted.'
        });
      } else {
        return res.status(400).json({
          success: false,
          message: 'Estimate is currently in revision and the deadline has not expired.'
        });
      }
    }

    // Standard Flow Transition
    let targetStatus = null;
    if (estimate.estimate_status === ESTIMATE_STATUS.SUBMITTED) {
      targetStatus = ESTIMATE_STATUS.UNDER_ZO_REVIEW;
    } else if (estimate.estimate_status === ESTIMATE_STATUS.ZO_APPROVED) {
      targetStatus = ESTIMATE_STATUS.UNDER_HO_REVIEW;
    } else {
      return res.status(400).json({
        success: false,
        message: `Invalid status for starting review: ${estimate.estimate_status}`
      });
    }

    const { data: updatedEstimate, error: updateError } = await supabase
      .from('project_cost_estimates')
      .update({
        estimate_status: targetStatus,
        last_modified_by: req.user.mobile_number,
        updated_at: new Date().toISOString()
      })
      .eq('estimate_id', id)
      .eq('estimate_status', estimate.estimate_status)
      .select('*, projects_master(*)')
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updatedEstimate) {
      return res.status(409).json({ success: false, message: 'Conflict: The estimate status has already been changed by another action.' });
    }

    return res.status(200).json({
      success: true,
      estimate: updatedEstimate,
      message: `Estimate is now ${targetStatus}.`
    });

  } catch (error) {
    console.error(`reviewEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to open estimate for review.' });
  }
}

/**
 * POST /api/v1/auth/estimates/:id/submit-review
 * Submits the final review decision for ZO or HO.
 */
async function submitReview(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Stage Guard
    const effectiveRole = getEffectiveRole(req.user.role);
    let rpcResult = null;

    if (estimate.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW) {
      if (!['zo', 'admin'].includes(effectiveRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. Only ZO or Admin can submit reviews.' });
      }

      // Call the transactional RPC submit_zo_review
      const { error: rpcError } = await supabase.rpc('submit_zo_review', {
        p_estimate_id: id,
        p_reviewer: req.user.mobile_number,
        p_remarks: req.body?.remarks || null
      });
      rpcResult = rpcError;
    } else if (estimate.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW) {
      if (!['ho', 'admin'].includes(effectiveRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. Only HO or Admin can submit reviews.' });
      }

      // Call the transactional RPC submit_ho_review
      const { error: rpcError } = await supabase.rpc('submit_ho_review', {
        p_estimate_id: id,
        p_reviewer: req.user.mobile_number,
        p_remarks: req.body?.remarks || null
      });
      rpcResult = rpcError;
    } else {
      const conflictStatuses = [ESTIMATE_STATUS.ZO_APPROVED, ESTIMATE_STATUS.REJECTED_BY_ZO, ESTIMATE_STATUS.FINAL_APPROVED, ESTIMATE_STATUS.REJECTED_BY_HO];
      if (conflictStatuses.includes(estimate.estimate_status)) {
        return res.status(409).json({ success: false, message: `submitReview transition conflict: Expected Under ZO Review or Under HO Review, found ${estimate.estimate_status}` });
      }
      return res.status(403).json({ success: false, message: 'Reviews can only be submitted for estimates under ZO Review or Under HO Review.' });
    }

    if (rpcResult) {
      // If RPC failed due to undecided rows check, return 422
      if (rpcResult.message && rpcResult.message.includes('undecided')) {
        return res.status(422).json({ success: false, message: 'All rows must be decided.' });
      }
      if (rpcResult.message && rpcResult.message.includes('no line items')) {
        return res.status(422).json({ success: false, message: 'Estimate contains no line items.' });
      }
      if (rpcResult.message && rpcResult.message.includes('Inconsistent review state')) {
        return res.status(400).json({ success: false, message: rpcResult.message });
      }
      throw rpcResult;
    }

    // Fetch the updated estimate header
    const { data: updatedEstimate, error: fetchError } = await supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)')
      .eq('estimate_id', id)
      .single();

    if (fetchError) throw fetchError;

    // Trigger Telegram notification if ZO Approved
    if (updatedEstimate.estimate_status === ESTIMATE_STATUS.ZO_APPROVED) {
      const { notifyHoEstimateApproved, notifyJeEstimateZoApproved } = require('../services/telegram.service');
      notifyHoEstimateApproved(updatedEstimate).catch(err => {
        console.error(`Telegram notification failed: ${err.message}`);
      });
      notifyJeEstimateZoApproved(updatedEstimate).catch(err => {
        console.error(`Telegram notification failed: ${err.message}`);
      });
    }

    // Trigger Telegram notification if Final Approved
    if (updatedEstimate.estimate_status === ESTIMATE_STATUS.FINAL_APPROVED) {
      const { notifyAllEstimateFinalApproved } = require('../services/telegram.service');
      notifyAllEstimateFinalApproved(updatedEstimate).catch(err => {
        console.error(`Telegram notification failed: ${err.message}`);
      });
    }

    // Trigger Telegram notification if Rejected by ZO or Rejected by HO
    if (
      updatedEstimate.estimate_status === ESTIMATE_STATUS.REJECTED_BY_ZO ||
      updatedEstimate.estimate_status === ESTIMATE_STATUS.REJECTED_BY_HO
    ) {
      const { notifyJeEstimateRejected } = require('../services/telegram.service');
      notifyJeEstimateRejected(updatedEstimate).catch(err => {
        console.error(`Telegram notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({
      success: true,
      estimate: updatedEstimate,
      message: `Review submitted successfully. Final Status: ${updatedEstimate.estimate_status}`
    });

  } catch (error) {
    if (error.message && error.message.includes('Unauthorized')) {
      console.info(`submitReview authorization conflict: ${error.message}`);
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message && (
      error.message.includes('Expected Under ZO Review') ||
      error.message.includes('Expected Under HO Review') ||
      error.message.includes('All rows must be decided')
    )) {
      console.info(`submitReview transition conflict: ${error.message}`);
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error(`submitReview failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit final review.' });
  }
}

/**
 * POST /api/v1/auth/estimates/:id/request-revision
 * Request JE revision of specific line items.
 */
async function requestRevision(req, res) {
  const { id } = req.params;
  const { deadline_hours } = req.body;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  // Strict integer validation for deadline_hours if provided
  let durationHours = 24;
  if (deadline_hours !== undefined) {
    if (typeof deadline_hours !== 'number' || !Number.isInteger(deadline_hours) || deadline_hours < 1 || deadline_hours > 168) {
      return res.status(400).json({
        success: false,
        message: 'deadline_hours must be an integer between 1 and 168.'
      });
    }
    durationHours = deadline_hours;
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Prevent multiple active revision requests (Pre-emptive check)
    const { data: activeRevision, error: activeRevError } = await supabase
      .from('estimate_revision_log')
      .select('id')
      .eq('estimate_id', id)
      .is('resubmitted_at', null)
      .limit(1)
      .maybeSingle();

    if (activeRevError) throw activeRevError;
    if (activeRevision) {
      return res.status(409).json({
        success: false,
        message: 'A revision request is already active for this estimate.'
      });
    }

    // Stage/Status and Role checks
    const effectiveRole = getEffectiveRole(req.user.role);
    let stage = null;
    let targetStatus = null;

    if (estimate.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW) {
      if (!['zo', 'admin'].includes(effectiveRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. ZO review stage requires ZO or Admin role.' });
      }
      stage = 'ZO';
      targetStatus = ESTIMATE_STATUS.ZO_REVISION_REQUESTED;
    } else if (estimate.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW) {
      if (!['ho', 'admin'].includes(effectiveRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. HO review stage requires HO or Admin role.' });
      }
      stage = 'HO';
      targetStatus = ESTIMATE_STATUS.HO_REVISION_REQUESTED;
    } else {
      return res.status(403).json({
        success: false,
        message: `Revision request cannot be initiated for estimate in '${estimate.estimate_status}' status.`
      });
    }

    // Require at least one row to be 'Not Approve' (NULL/Approve do not qualify)
    const approveField = stage === 'ZO' ? 'zo_office_approve' : 'ho_office_approve';
    const { data: disapprovedItems, error: itemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('item_id')
      .eq('estimate_id', id)
      .eq(approveField, APPROVAL_STATUS.REJECTED)
      .limit(1);

    if (itemsError) throw itemsError;
    if (!disapprovedItems || disapprovedItems.length === 0) {
      return res.status(422).json({
        success: false,
        message: `At least one row must be marked ${APPROVAL_STATUS.REJECTED} before requesting a revision. NULL (unreviewed) rows do not qualify.`
      });
    }

    // Calculate cycle number
    const { data: lastLog, error: lastLogError } = await supabase
      .from('estimate_revision_log')
      .select('revision_cycle')
      .eq('estimate_id', id)
      .eq('stage', stage)
      .order('revision_cycle', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLogError) throw lastLogError;
    const cycle = lastLog ? lastLog.revision_cycle + 1 : 1;

    // Calculate deadline timestamp
    const revision_deadline = new Date(Date.now() + durationHours * 60 * 60 * 1000).toISOString();

    // Insert revision log (omitting modified_item_ids so DB defaults to '{}')
    const { data: logEntry, error: insertError } = await supabase
      .from('estimate_revision_log')
      .insert([
        {
          estimate_id: id,
          revision_cycle: cycle,
          stage,
          requested_by: req.user.mobile_number,
          revision_deadline,
          resubmitted_at: null,
          is_auto_resubmitted: false
        }
      ])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'A revision request is already active for this estimate.'
        });
      }
      throw insertError;
    }

    // Update estimate header in a single database operation (status + last_modified_by)
    const { data: updatedEstimate, error: updateError } = await supabase
      .from('project_cost_estimates')
      .update({
        estimate_status: targetStatus,
        last_modified_by: req.user.mobile_number
      })
      .eq('estimate_id', id)
      .select('*, projects_master(*)')
      .single();

    if (updateError) throw updateError;

    // Trigger Telegram notification to JE asynchronously
    const { notifyJeRevisionRequested } = require('../services/telegram.service');
    notifyJeRevisionRequested(updatedEstimate, logEntry).catch(err => {
      console.error(`Telegram notification failed: ${err.message}`);
    });

    return res.status(200).json({
      success: true,
      estimate: updatedEstimate,
      revisionLog: logEntry,
      message: 'Revision request initiated successfully.'
    });

  } catch (error) {
    console.error(`requestRevision failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to request revision.' });
  }
}

/**
 * GET /api/v1/auth/estimates/:id/revisions
 * Get revision logs for an estimate.
 */
async function getRevisionLog(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    const isAuthorized = await canViewEstimate(estimate, req.user);
    if (!isAuthorized) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Fetch revision log entries
    const { data: logs, error: logsError } = await supabase
      .from('estimate_revision_log')
      .select('*')
      .eq('estimate_id', id)
      .order('created_at', { ascending: true });

    if (logsError) throw logsError;

    // Resolve display names for requested_by and resubmitted_by
    const enrichedLogs = [];
    if (logs && logs.length > 0) {
      const mobiles = [];
      logs.forEach(log => {
        if (log.requested_by) mobiles.push(log.requested_by);
        if (log.resubmitted_by && !log.is_auto_resubmitted) mobiles.push(log.resubmitted_by);
      });

      const userMap = await resolveDisplayNames(mobiles);

      logs.forEach(log => {
        const requested_by_name = userMap[log.requested_by] || log.requested_by || null;
        let resubmitted_by_name = null;
        if (log.is_auto_resubmitted) {
          resubmitted_by_name = 'Auto-resubmitted by system';
        } else if (log.resubmitted_by) {
          resubmitted_by_name = userMap[log.resubmitted_by] || log.resubmitted_by;
        }

        enrichedLogs.push({
          ...log,
          requested_by_name,
          resubmitted_by_name
        });
      });
    }

    return res.status(200).json({
      success: true,
      revisions: enrichedLogs
    });

  } catch (error) {
    console.error(`getRevisionLog failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve revision logs.' });
  }
}

/**
 * POST /api/v1/auth/estimates/:id/reopen
 * Reopens an estimate in a terminal/final status back to revision cycle.
 * Restricted to HO and Admin.
 */
async function reopenEstimate(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Role check: Only HO and Admin can reopen
    const effectiveRole = getEffectiveRole(req.user.role);
    if (!['ho', 'admin'].includes(effectiveRole)) {
      return res.status(403).json({ success: false, message: 'Access denied. Only HO or Admin can reopen estimates.' });
    }

    // Check if there's already an active revision log
    const { data: activeRevision, error: activeRevError } = await supabase
      .from('estimate_revision_log')
      .select('id')
      .eq('estimate_id', id)
      .is('resubmitted_at', null)
      .limit(1)
      .maybeSingle();

    if (activeRevError) throw activeRevError;
    if (activeRevision) {
      return res.status(409).json({
        success: false,
        message: 'A revision request is already active for this estimate.'
      });
    }

    // Calculate cycle number
    const { data: lastLog, error: lastLogError } = await supabase
      .from('estimate_revision_log')
      .select('revision_cycle')
      .eq('estimate_id', id)
      .eq('stage', 'HO')
      .order('revision_cycle', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastLogError) throw lastLogError;
    const cycle = lastLog ? lastLog.revision_cycle + 1 : 1;

    // Create a new HO revision log cycle with a far-future sentinel deadline to disable countdown & auto-resubmission
    const revision_deadline = '9999-12-31T23:59:59.000Z';

    const { data: logEntry, error: insertError } = await supabase
      .from('estimate_revision_log')
      .insert([
        {
          estimate_id: id,
          revision_cycle: cycle,
          stage: 'HO',
          requested_by: req.user.mobile_number,
          revision_deadline,
          resubmitted_at: null,
          is_auto_resubmitted: false
        }
      ])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'A revision request is already active for this estimate.'
        });
      }
      throw insertError;
    }

    // Reset all item-level ZO/HO approvals/remarks to null
    const { error: itemsUpdateError } = await supabase
      .from('project_cost_estimate_items')
      .update({
        zo_office_approve: null,
        zo_remarks: null,
        ho_office_approve: null,
        ho_remarks: null,
        updated_at: new Date().toISOString()
      })
      .eq('estimate_id', id);

    if (itemsUpdateError) throw itemsUpdateError;

    // Update estimate header: status to Estimate Reopened and nullify approvals/remarks
    const { data: updatedEstimate, error: updateError } = await supabase
      .from('project_cost_estimates')
      .update({
        estimate_status: ESTIMATE_STATUS.ESTIMATE_REOPENED,
        zo_approved_by: null,
        zo_approval_date: null,
        zo_remarks: null,
        ho_approved_by: null,
        ho_approval_date: null,
        ho_remarks: null,
        last_modified_by: req.user.mobile_number,
        updated_at: new Date().toISOString()
      })
      .eq('estimate_id', id)
      .select('*, projects_master(*)')
      .single();

    if (updateError) throw updateError;

    // Trigger Telegram notification to JE asynchronously
    const { notifyJeRevisionRequested } = require('../services/telegram.service');
    notifyJeRevisionRequested(updatedEstimate, logEntry).catch(err => {
      console.error(`Telegram notification failed: ${err.message}`);
    });

    return res.status(200).json({
      success: true,
      estimate: updatedEstimate,
      revisionLog: logEntry,
      message: 'Estimate reopened successfully.'
    });

  } catch (error) {
    console.error(`reopenEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to reopen estimate.' });
  }
}

module.exports = {
  submitEstimate,
  reviewEstimate,
  submitReview,
  requestRevision,
  getRevisionLog,
  reopenEstimate
};
