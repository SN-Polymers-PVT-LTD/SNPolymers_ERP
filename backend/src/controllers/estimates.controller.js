const crypto = require('crypto');
const { supabase } = require('../db/supabase');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * Shared Helper: Recalculates the estimate amount based on its current status.
 * Note: Does not update last_modified_by.
 */
async function _recalculateEstimateAmount(estimateId, currentStatus) {
  const { data: items, error } = await supabase
    .from('project_cost_estimate_items')
    .select('amount, zo_office_approve, ho_office_approve')
    .eq('estimate_id', estimateId);

  if (error) throw error;

  let newAmount = 0;

  if (
    ['Draft', 'Submitted', 'Under ZO Review', 'ZO Revision Requested',
     'Rejected by ZO', 'Rejected by HO'].includes(currentStatus)
  ) {
    newAmount = (items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  } else if (
    ['ZO Approved', 'Under HO Review', 'HO Revision Requested'].includes(currentStatus)
  ) {
    newAmount = (items || [])
      .filter(item => item.zo_office_approve === 'Approve')
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  } else if (currentStatus === 'Final Approved') {
    newAmount = (items || [])
      .filter(item => item.zo_office_approve === 'Approve' && item.ho_office_approve === 'Approve')
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  } else {
    newAmount = (items || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  }

  newAmount = Math.round(newAmount * 100) / 100;

  const { error: updateError } = await supabase
    .from('project_cost_estimates')
    .update({ estimate_amount: newAmount })
    .eq('estimate_id', estimateId);

  if (updateError) throw updateError;

  return newAmount;
}

/**
 * POST /api/v1/auth/estimates
 * Creates a new estimate header (Draft).
 */
async function createEstimate(req, res) {
  const { work_order_no, zonal_office_no, je_remarks } = req.body;

  if (!work_order_no || typeof work_order_no !== 'string' || work_order_no.trim() === '') {
    return res.status(400).json({ success: false, message: 'work_order_no is required.' });
  }

  if (!zonal_office_no || typeof zonal_office_no !== 'string' || zonal_office_no.trim() === '') {
    return res.status(400).json({ success: false, message: 'zonal_office_no is required and cannot be blank.' });
  }

  try {
    const { data: project, error: projectError } = await supabase
      .from('projects_master')
      .select('*')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (projectError) throw projectError;

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    if (project.status === 'Closed') {
      return res.status(403).json({ success: false, message: 'Cannot create estimates for Closed projects.' });
    }

    const { data: activeEstimates, error: activeError } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .eq('work_order_no', work_order_no)
      .not('estimate_status', 'in', '("Final Approved","Rejected by ZO","Rejected by HO")');

    if (activeError) throw activeError;

    if (activeEstimates && activeEstimates.length > 0) {
      return res.status(409).json({ success: false, message: 'An active estimate already exists for this work order.' });
    }

    const { data: newEstimate, error: insertError } = await supabase
      .from('project_cost_estimates')
      .insert([
        {
          work_order_no,
          estimate_no: project.estimate_no,
          area_code: project.zone,
          estimate_revision: 0,
          zonal_office_no: zonal_office_no.trim(),
          estimate_amount: 0,
          estimate_status: 'Draft',
          je_remarks: je_remarks || null,
          created_by: req.user.mobile_number,
          last_modified_by: req.user.mobile_number
        }
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      success: true,
      estimate: newEstimate,
      message: 'Cost estimate created successfully.'
    });

  } catch (error) {
    console.error(`createEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create cost estimate.' });
  }
}

/**
 * PUT /api/v1/auth/estimates/:id/items
 * Full replacement logic for line items.
 */
async function saveDraftItems(req, res) {
  const { id } = req.params;
  const { items } = req.body;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  if (!Array.isArray(items)) {
    return res.status(400).json({ success: false, message: 'items must be an array.' });
  }

  try {
    const { data: estimate, error: estError } = await supabase
      .from('project_cost_estimates')
      .select('*')
      .eq('estimate_id', id)
      .maybeSingle();

    if (estError) throw estError;

    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    const isOwner = estimate.created_by === req.user.mobile_number;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this estimate.' });
    }

    const allowedStatuses = ['Draft', 'ZO Revision Requested', 'HO Revision Requested'];
    if (!allowedStatuses.includes(estimate.estimate_status)) {
      return res.status(403).json({ success: false, message: 'Estimate cannot be edited in its current status.' });
    }

    const { data: existingItems, error: itemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', id);

    if (itemsError) throw itemsError;

    const existingMap = {};
    (existingItems || []).forEach(item => {
      existingMap[item.item_id] = item;
    });

    const isZoRevision = estimate.estimate_status === 'ZO Revision Requested';
    const isHoRevision = estimate.estimate_status === 'HO Revision Requested';

    for (const item of items) {
      if (!item.material_main_head || !item.material_sub_head || !item.material_details || !item.unit) {
        return res.status(400).json({ success: false, message: 'Material heads, details, and unit are required.' });
      }

      const qtyNum = Number(item.qty);
      const rateNum = Number(item.rate);
      if (isNaN(qtyNum) || isNaN(rateNum) || qtyNum < 0 || rateNum < 0) {
        return res.status(400).json({ success: false, message: 'Quantity and rate must be non-negative numbers.' });
      }

      const { data: masterMat, error: masterErr } = await supabase
        .from('material_master')
        .select('M_Unit')
        .eq('Material_Main_Head', item.material_main_head)
        .eq('Material_Sub_Head', item.material_sub_head)
        .eq('Material_Details', item.material_details)
        .maybeSingle();

      if (masterErr) throw masterErr;
      if (!masterMat || masterMat.M_Unit !== item.unit) {
        return res.status(400).json({ success: false, message: `Unit mismatch for item: ${item.material_details}. Expected: ${masterMat ? masterMat.M_Unit : 'N/A'}` });
      }

      if (isZoRevision || isHoRevision) {
        if (!item.item_id || !existingMap[item.item_id]) {
          return res.status(403).json({ success: false, message: 'New items cannot be added during revision.' });
        }

        const prevItem = existingMap[item.item_id];
        if (isZoRevision && prevItem.zo_office_approve === 'Approve') {
          const isModified =
            String(prevItem.qty) !== String(item.qty) ||
            String(prevItem.rate) !== String(item.rate) ||
            prevItem.material_main_head !== item.material_main_head ||
            prevItem.material_sub_head !== item.material_sub_head ||
            prevItem.material_details !== item.material_details ||
            prevItem.unit !== item.unit ||
            (prevItem.source_of_purchase || null) !== (item.source_of_purchase || null);

          if (isModified) {
            return res.status(403).json({ success: false, message: 'Approved items cannot be modified during revision.' });
          }
        }

        if (isHoRevision && prevItem.ho_office_approve === 'Approve') {
          const isModified =
            String(prevItem.qty) !== String(item.qty) ||
            String(prevItem.rate) !== String(item.rate) ||
            prevItem.material_main_head !== item.material_main_head ||
            prevItem.material_sub_head !== item.material_sub_head ||
            prevItem.material_details !== item.material_details ||
            prevItem.unit !== item.unit ||
            (prevItem.source_of_purchase || null) !== (item.source_of_purchase || null);

          if (isModified) {
            return res.status(403).json({ success: false, message: 'Approved items cannot be modified during revision.' });
          }
        }
      }
    }

    const payloadItems = items.map(item => {
      let item_id = item.item_id;
      if (!item_id) {
        item_id = crypto.randomUUID();
      }
      return {
        item_id,
        estimate_id: id,
        material_main_head: item.material_main_head,
        material_sub_head: item.material_sub_head,
        material_details: item.material_details,
        unit: item.unit,
        qty: Number(item.qty) || 0,
        rate: Number(item.rate) || 0,
        amount: Math.round((Number(item.qty) || 0) * (Number(item.rate) || 0) * 100) / 100,
        rate_reference: item.rate_reference || null,
        source_of_purchase: item.source_of_purchase || null,
        zo_office_approve: existingMap[item_id]?.zo_office_approve || null,
        zo_remarks: existingMap[item_id]?.zo_remarks || null,
        ho_office_approve: existingMap[item_id]?.ho_office_approve || null,
        ho_remarks: existingMap[item_id]?.ho_remarks || null
      };
    });

    const payloadIds = payloadItems.map(item => item.item_id);
    const toDeleteIds = Object.keys(existingMap).filter(itemId => !payloadIds.includes(itemId));

    if (toDeleteIds.length > 0) {
      let deleteQuery = supabase
        .from('project_cost_estimate_items')
        .delete()
        .in('item_id', toDeleteIds);

      if (isZoRevision) {
        deleteQuery = deleteQuery.or('zo_office_approve.is.null,zo_office_approve.eq.Not Approve');
      } else if (isHoRevision) {
        deleteQuery = deleteQuery.or('ho_office_approve.is.null,ho_office_approve.eq.Not Approve');
      }

      const { error: deleteError } = await deleteQuery;
      if (deleteError) throw deleteError;
    }

    if (payloadItems.length > 0) {
      const { error: upsertError } = await supabase
        .from('project_cost_estimate_items')
        .upsert(payloadItems, { onConflict: 'item_id' });

      if (upsertError) throw upsertError;
    }

    await _recalculateEstimateAmount(id, estimate.estimate_status);

    const { error: headerUpdateError } = await supabase
      .from('project_cost_estimates')
      .update({
        last_modified_by: req.user.mobile_number,
        updated_at: new Date().toISOString()
      })
      .eq('estimate_id', id);

    if (headerUpdateError) throw headerUpdateError;

    const { data: finalItems, error: fetchFinalError } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', id)
      .order('created_at', { ascending: true });

    if (fetchFinalError) throw fetchFinalError;

    return res.status(200).json({
      success: true,
      items: finalItems,
      message: 'Draft items saved successfully.'
    });

  } catch (error) {
    console.error(`saveDraftItems failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save draft items.' });
  }
}

/**
 * GET /api/v1/auth/estimates
 * Role-filtered cost estimates list view.
 */
async function getEstimates(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 50;
    if (limit < 1) limit = 50;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    const effectiveRole = req.user.role === 'staff' ? 'je' : req.user.role;
    let dbQuery = supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)', { count: 'exact' });

    if (effectiveRole === 'je') {
      dbQuery = dbQuery.eq('created_by', req.user.mobile_number);
    } else if (effectiveRole === 'zo') {
      dbQuery = dbQuery.in('estimate_status', ['Submitted', 'Under ZO Review', 'ZO Revision Requested', 'ZO Approved', 'Rejected by ZO']);
    } else if (effectiveRole === 'ho') {
      if (query.view === 'history') {
        dbQuery = dbQuery.in('estimate_status', ['Final Approved', 'Rejected by HO']);
      } else {
        dbQuery = dbQuery.in('estimate_status', ['ZO Approved', 'Under HO Review', 'HO Revision Requested']);
      }
    }

    const { data: estimates, count, error } = await dbQuery
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const estimateIds = (estimates || []).map(e => e.estimate_id);
    let deadlinesMap = {};

    if (estimateIds.length > 0) {
      const { data: logs, error: logsError } = await supabase
        .from('estimate_revision_log')
        .select('estimate_id, revision_deadline, is_auto_resubmitted')
        .in('estimate_id', estimateIds)
        .is('resubmitted_at', null)
        .order('created_at', { ascending: false });

      if (!logsError && logs) {
        logs.forEach(log => {
          if (!deadlinesMap[log.estimate_id]) {
            deadlinesMap[log.estimate_id] = log;
          }
        });
      }
    }

    const enrichedEstimates = (estimates || []).map(est => {
      const log = deadlinesMap[est.estimate_id];
      const deadline = log ? log.revision_deadline : null;
      const isOverdue = deadline ? new Date() > new Date(deadline) : false;
      return {
        ...est,
        active_revision_deadline: deadline,
        is_deadline_overdue: isOverdue
      };
    });

    return res.status(200).json({
      success: true,
      estimates: enrichedEstimates,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error(`getEstimates failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve cost estimates.' });
  }
}

/**
 * GET /api/v1/auth/estimates/:id
 * Single cost estimate retrieval with detail fields, summary, and name resolution.
 */
async function getEstimateById(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const { data: estimate, error: estError } = await supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)')
      .eq('estimate_id', id)
      .maybeSingle();

    if (estError) throw estError;

    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Role-based visibility check matching getEstimates filters exactly
    const effectiveRole = req.user.role === 'staff' ? 'je' : req.user.role;
    let allowed = false;

    if (effectiveRole === 'admin') {
      allowed = true;
    } else if (effectiveRole === 'je') {
      allowed = estimate.created_by === req.user.mobile_number;
    } else if (effectiveRole === 'zo') {
      const zoStatuses = ['Submitted', 'Under ZO Review', 'ZO Revision Requested', 'ZO Approved', 'Rejected by ZO'];
      allowed = zoStatuses.includes(estimate.estimate_status);
    } else if (effectiveRole === 'ho') {
      const hoStatuses = ['ZO Approved', 'Under HO Review', 'HO Revision Requested', 'Final Approved', 'Rejected by HO'];
      allowed = hoStatuses.includes(estimate.estimate_status);
    }

    if (!allowed) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    const { data: items, error: itemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', id)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    const { data: log, error: logError } = await supabase
      .from('estimate_revision_log')
      .select('revision_deadline, is_auto_resubmitted')
      .eq('estimate_id', id)
      .is('resubmitted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const active_revision_deadline = log ? log.revision_deadline : null;
    const is_deadline_overdue = active_revision_deadline ? new Date() > new Date(active_revision_deadline) : false;

    const mobiles = [estimate.je_user_id, estimate.zo_approved_by, estimate.ho_approved_by].filter(Boolean);
    const userMap = {};

    if (mobiles.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from('authorised_users')
        .select('mobile_number, display_name')
        .in('mobile_number', mobiles);

      if (!usersError && users) {
        users.forEach(u => {
          userMap[u.mobile_number] = u.display_name;
        });
      }
    }

    const je_name = userMap[estimate.je_user_id] || estimate.je_user_id || null;
    const zo_name = userMap[estimate.zo_approved_by] || estimate.zo_approved_by || null;
    const ho_name = userMap[estimate.ho_approved_by] || estimate.ho_approved_by || null;

    let gross_labour_cost = 0;
    let gross_transport_cost = 0;
    let gross_misc_cost = 0;
    let gross_material_cost = 0;
    let gross_total = 0;

    (items || []).forEach(item => {
      const amt = Number(item.amount) || 0;
      gross_total += amt;
      if (item.material_main_head === 'Labour') {
        gross_labour_cost += amt;
      } else if (item.material_main_head === 'Transport') {
        gross_transport_cost += amt;
      } else if (item.material_main_head === 'Miscellaneous') {
        gross_misc_cost += amt;
      } else {
        gross_material_cost += amt;
      }
    });

    const summary = {
      gross_material_cost: Number(gross_material_cost.toFixed(2)),
      gross_labour_cost: Number(gross_labour_cost.toFixed(2)),
      gross_transport_cost: Number(gross_transport_cost.toFixed(2)),
      gross_misc_cost: Number(gross_misc_cost.toFixed(2)),
      gross_total: Number(gross_total.toFixed(2)),
      approved_grand_total: Number((Number(estimate.estimate_amount) || 0).toFixed(2))
    };

    const enrichedEstimate = {
      ...estimate,
      je_name,
      zo_name,
      ho_name,
      active_revision_deadline,
      is_deadline_overdue
    };

    return res.status(200).json({
      success: true,
      estimate: enrichedEstimate,
      items: items || [],
      summary
    });

  } catch (error) {
    console.error(`getEstimateById failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve cost estimate details.' });
  }
}

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
    // 1. Fetch estimate header
    const { data: estimate, error: estError } = await supabase
      .from('project_cost_estimates')
      .select('*')
      .eq('estimate_id', id)
      .maybeSingle();

    if (estError) throw estError;

    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Gating & Ownership check
    const isOwner = estimate.created_by === req.user.mobile_number;
    const isAdmin = req.user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this estimate.' });
    }

    const allowedStatuses = ['Draft', 'ZO Revision Requested', 'HO Revision Requested'];
    if (!allowedStatuses.includes(estimate.estimate_status)) {
      return res.status(403).json({ success: false, message: 'Estimate cannot be submitted in its current status.' });
    }

    // 2. Fetch all items associated with this estimate
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

    // 3. Status Transitions & Transactions
    const isFirstSubmit = estimate.estimate_status === 'Draft';
    const isZoResubmit = estimate.estimate_status === 'ZO Revision Requested';
    const isHoResubmit = estimate.estimate_status === 'HO Revision Requested';
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

    // 4. Fetch the updated estimate
    const { data: updatedEstimate, error: fetchError } = await supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)')
      .eq('estimate_id', id)
      .single();

    if (fetchError) throw fetchError;

    // 5. Non-blocking Telegram notification (async)
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
    // 1. Fetch estimate header
    const { data: estimate, error: estError } = await supabase
      .from('project_cost_estimates')
      .select('*')
      .eq('estimate_id', id)
      .maybeSingle();

    if (estError) throw estError;

    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Workflow actor and status check
    const effectiveRole = req.user.role === 'staff' ? 'je' : req.user.role;
    const isZoOrAdmin = ['zo', 'admin'].includes(effectiveRole);
    const isHoOrAdmin = ['ho', 'admin'].includes(effectiveRole);

    let allowed = false;
    if (estimate.estimate_status === 'Submitted') {
      allowed = isZoOrAdmin;
    } else if (estimate.estimate_status === 'ZO Approved') {
      allowed = isHoOrAdmin;
    } else if (estimate.estimate_status === 'ZO Revision Requested') {
      allowed = isZoOrAdmin;
    } else if (estimate.estimate_status === 'HO Revision Requested') {
      allowed = isHoOrAdmin;
    }

    if (!allowed) {
      return res.status(403).json({ success: false, message: 'Access denied for this workflow stage.' });
    }

    // 2. Revision Deadline Check (Auto-Resubmit)
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

    // 3. Standard Flow Transition
    let targetStatus = null;
    if (estimate.estimate_status === 'Submitted') {
      targetStatus = 'Under ZO Review';
    } else if (estimate.estimate_status === 'ZO Approved') {
      targetStatus = 'Under HO Review';
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
 * POST /api/v1/auth/estimates/:id/row-approvals
 * Saves row-level decisions (Approve/Not Approve) atomically.
 */
async function submitRowApprovals(req, res) {
  const { id } = req.params;
  const { approvals } = req.body;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  if (!Array.isArray(approvals)) {
    return res.status(400).json({ success: false, message: 'approvals must be an array.' });
  }

  try {
    // 1. Fetch estimate header
    const { data: estimate, error: estError } = await supabase
      .from('project_cost_estimates')
      .select('*')
      .eq('estimate_id', id)
      .maybeSingle();

    if (estError) throw estError;

    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Stage guard: Under ZO Review and user is zo/admin
    const effectiveRole = req.user.role === 'staff' ? 'je' : req.user.role;
    if (estimate.estimate_status !== 'Under ZO Review') {
      return res.status(403).json({ success: false, message: 'Row approvals can only be submitted during Under ZO Review status.' });
    }

    if (!['zo', 'admin'].includes(effectiveRole)) {
      return res.status(403).json({ success: false, message: 'Access denied. Only ZO or Admin can approve rows.' });
    }

    // 2. Validate Approvals Array
    const itemIds = approvals.map(a => a.item_id);
    if (new Set(itemIds).size !== itemIds.length) {
      return res.status(400).json({ success: false, message: 'Duplicate item_id detected.' });
    }

    for (const approval of approvals) {
      if (!uuidRegex.test(approval.item_id)) {
        return res.status(400).json({ success: false, message: `Invalid item UUID: ${approval.item_id}` });
      }

      if (!['Approve', 'Not Approve'].includes(approval.approve_status)) {
        return res.status(400).json({ success: false, message: `Invalid approve_status for item ${approval.item_id}. Must be Approve or Not Approve.` });
      }

      if (approval.approve_status === 'Not Approve') {
        if (!approval.remarks || typeof approval.remarks !== 'string' || approval.remarks.trim() === '') {
          return res.status(400).json({ success: false, message: `Remarks are required for rejected item: ${approval.item_id}` });
        }
      }
    }

    // 3. Verify all items exist and belong to this estimate
    const { data: dbItems, error: itemsFetchError } = await supabase
      .from('project_cost_estimate_items')
      .select('item_id')
      .eq('estimate_id', id)
      .in('item_id', itemIds);

    if (itemsFetchError) throw itemsFetchError;

    const dbItemIds = (dbItems || []).map(item => item.item_id);
    const missingIds = itemIds.filter(id => !dbItemIds.includes(id));
    if (missingIds.length > 0) {
      return res.status(404).json({ success: false, message: `Item IDs not found or do not belong to this estimate: ${missingIds.join(', ')}` });
    }

    // 4. Call submit_row_approvals RPC
    const { error: rpcError } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: id,
      p_approvals: approvals,
      p_stage: 'ZO',
      p_modified_by: req.user.mobile_number
    });

    if (rpcError) throw rpcError;

    // 5. Fetch updated items array
    const { data: finalItems, error: fetchFinalError } = await supabase
      .from('project_cost_estimate_items')
      .select('*')
      .eq('estimate_id', id)
      .order('created_at', { ascending: true });

    if (fetchFinalError) throw fetchFinalError;

    return res.status(200).json({
      success: true,
      items: finalItems,
      message: 'Row approvals updated successfully.'
    });

  } catch (error) {
    if (error.message && error.message.includes('Unauthorized')) {
      console.info(`submitRowApprovals authorization conflict: ${error.message}`);
      return res.status(403).json({ success: false, message: error.message });
    }
    if (error.message && error.message.includes('not found or does not belong to estimate')) {
      console.info(`submitRowApprovals validation conflict: ${error.message}`);
      return res.status(404).json({ success: false, message: error.message });
    }
    console.error(`submitRowApprovals failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit row approvals.' });
  }
}

/**
 * POST /api/v1/auth/estimates/:id/submit-review
 * Submits the final review decision for ZO, transitioning the status to ZO Approved or Rejected by ZO.
 */
async function submitReview(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    // 1. Fetch estimate header first to validate stage & permissions
    const { data: estimate, error: estError } = await supabase
      .from('project_cost_estimates')
      .select('*')
      .eq('estimate_id', id)
      .maybeSingle();

    if (estError) throw estError;

    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Stage Guard
    const effectiveRole = req.user.role === 'staff' ? 'je' : req.user.role;
    if (estimate.estimate_status !== 'Under ZO Review') {
      return res.status(403).json({ success: false, message: 'Reviews can only be submitted for estimates under ZO Review.' });
    }

    if (!['zo', 'admin'].includes(effectiveRole)) {
      return res.status(403).json({ success: false, message: 'Access denied. Only ZO or Admin can submit reviews.' });
    }

    // 2. Call the transactional RPC submit_zo_review
    const { error: rpcError } = await supabase.rpc('submit_zo_review', {
      p_estimate_id: id,
      p_reviewer: req.user.mobile_number,
      p_remarks: req.body?.remarks || null
    });

    if (rpcError) {
      // If RPC failed due to undecided rows check, return 422
      if (rpcError.message && rpcError.message.includes('undecided')) {
        return res.status(422).json({ success: false, message: 'All rows must be decided.' });
      }
      throw rpcError;
    }

    // 3. Fetch the updated estimate header
    const { data: updatedEstimate, error: fetchError } = await supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)')
      .eq('estimate_id', id)
      .single();

    if (fetchError) throw fetchError;

    // 4. Trigger Telegram notification if ZO Approved
    if (updatedEstimate.estimate_status === 'ZO Approved') {
      const { notifyHoEstimateApproved } = require('../services/telegram.service');
      notifyHoEstimateApproved(updatedEstimate).catch(err => {
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
    if (error.message && (error.message.includes('Expected Under ZO Review') || error.message.includes('All rows must be decided'))) {
      console.info(`submitReview transition conflict: ${error.message}`);
      return res.status(409).json({ success: false, message: error.message });
    }
    console.error(`submitReview failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to submit final review.' });
  }
}

module.exports = {
  _recalculateEstimateAmount,
  createEstimate,
  saveDraftItems,
  getEstimates,
  getEstimateById,
  submitEstimate,
  reviewEstimate,
  submitRowApprovals,
  submitReview
};

