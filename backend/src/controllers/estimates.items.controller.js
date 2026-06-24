const crypto = require('crypto');
const { supabase } = require('../db/supabase');
const ESTIMATE_STATUS = require('../constants/estimate-status');
const APPROVAL_STATUS = require('../constants/approval-status');
const { EDITABLE_STATUSES } = require('../workflow/estimate-rules');
const { _recalculateEstimateAmount } = require('../services/estimate.service');
const validate = require('../validation/validate');
const { saveDraftItemsSchema, submitRowApprovalsSchema } = require('../validation/estimate.schema');
const {
  getEstimateById,
  isOwnerOrAdmin,
  hasItemFieldChanged,
  getEffectiveRole,
  uuidRegex
} = require('./estimates.helpers');

/**
 * PUT /api/v1/auth/estimates/:id/items
 * Full replacement logic for line items.
 */
async function saveDraftItems(req, res) {
  if (!validate(req, res, saveDraftItemsSchema)) return;
  const { id } = req.params;
  const { items } = req.body;

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    if (!isOwnerOrAdmin(estimate, req.user)) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this estimate.' });
    }

    const effectiveRole = getEffectiveRole(req.user.role);
    const isAdmin = effectiveRole === 'admin';

    if (!isAdmin && !EDITABLE_STATUSES.includes(estimate.estimate_status)) {
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

    const isZoRevision = estimate.estimate_status === ESTIMATE_STATUS.ZO_REVISION_REQUESTED;
    const isHoRevision = estimate.estimate_status === ESTIMATE_STATUS.HO_REVISION_REQUESTED;

    // Batch fetch materials with a composite lookup strategy to avoid correctness/uniqueness bugs
    // We fetch in chunks of 40 to avoid URL length limitations on large estimate batches (e.g. 500 items)
    let masterMats = [];
    if (items.length > 0) {
      const CHUNK_SIZE = 40;
      for (let i = 0; i < items.length; i += CHUNK_SIZE) {
        const chunk = items.slice(i, i + CHUNK_SIZE);
        const orConditions = chunk.map(item => {
          const escapedMain = item.material_main_head.replace(/"/g, '\\"');
          const escapedSub = item.material_sub_head.replace(/"/g, '\\"');
          const escapedDetails = item.material_details.replace(/"/g, '\\"');
          return `and(Material_Main_Head.eq."${escapedMain}",Material_Sub_Head.eq."${escapedSub}",Material_Details.eq."${escapedDetails}")`;
        }).join(',');

        const { data, error: masterErr } = await supabase
          .from('material_master')
          .select('Material_Main_Head, Material_Sub_Head, Material_Details, M_Unit')
          .or(orConditions);

        if (masterErr) throw masterErr;
        if (data) {
          masterMats = masterMats.concat(data);
        }
      }
    }

    const masterMatMap = {};
    masterMats.forEach(mat => {
      const key = `${mat.Material_Main_Head}|||${mat.Material_Sub_Head}|||${mat.Material_Details}`;
      masterMatMap[key] = mat;
    });

    for (const item of items) {
      const key = `${item.material_main_head}|||${item.material_sub_head}|||${item.material_details}`;
      const masterMat = masterMatMap[key];

      if (!masterMat || masterMat.M_Unit !== item.unit) {
        return res.status(400).json({ success: false, message: `Unit mismatch for item: ${item.material_details}. Expected: ${masterMat ? masterMat.M_Unit : 'N/A'}` });
      }

      if (!isAdmin && (isZoRevision || isHoRevision)) {
        if (!item.item_id || !existingMap[item.item_id]) {
          return res.status(403).json({ success: false, message: 'New items cannot be added during revision.' });
        }

        const prevItem = existingMap[item.item_id];
        if (isZoRevision && prevItem.zo_office_approve === APPROVAL_STATUS.APPROVED) {
          if (hasItemFieldChanged(prevItem, item)) {
            return res.status(403).json({ success: false, message: 'Approved items cannot be modified during revision.' });
          }
        }

        if (isHoRevision && prevItem.ho_office_approve === APPROVAL_STATUS.APPROVED) {
          if (hasItemFieldChanged(prevItem, item)) {
            return res.status(403).json({ success: false, message: 'Approved items cannot be modified during revision.' });
          }
        }
      }
    }

    const isJE = ['je', 'staff'].includes(req.user.role);
    if (isJE) {
      for (const item of items) {
        const prevItem = item.item_id ? existingMap[item.item_id] : null;
        const prevSource = prevItem ? prevItem.source_of_purchase : null;
        if (item.source_of_purchase && item.source_of_purchase !== prevSource) {
          return res.status(400).json({ success: false, message: 'JE is not authorized to set or modify source_of_purchase.' });
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

      if (!isAdmin) {
        if (isZoRevision) {
          deleteQuery = deleteQuery.or(`zo_office_approve.is.null,zo_office_approve.eq."${APPROVAL_STATUS.REJECTED}"`);
        } else if (isHoRevision) {
          deleteQuery = deleteQuery.or(`ho_office_approve.is.null,ho_office_approve.eq."${APPROVAL_STATUS.REJECTED}"`);
        }
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
      .select('*, purchase_data(name)')
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
 * POST /api/v1/auth/estimates/:id/row-approvals
 * Saves row-level decisions (Approve/Not Approve) atomically.
 */
async function submitRowApprovals(req, res) {
  if (!validate(req, res, submitRowApprovalsSchema)) return;
  const { id } = req.params;
  const { approvals } = req.body;

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    // Stage guard: Under ZO Review (zo/admin) or Under HO Review (ho/admin)
    const effectiveRole = getEffectiveRole(req.user.role);
    let stage = null;

    if (estimate.estimate_status === ESTIMATE_STATUS.UNDER_ZO_REVIEW) {
      if (!['zo', 'admin'].includes(effectiveRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. Only ZO or Admin can approve rows during ZO Review.' });
      }
      stage = 'ZO';
    } else if (estimate.estimate_status === ESTIMATE_STATUS.UNDER_HO_REVIEW) {
      if (!['ho', 'admin'].includes(effectiveRole)) {
        return res.status(403).json({ success: false, message: 'Access denied. Only HO or Admin can approve rows during HO Review.' });
      }
      stage = 'HO';
    } else {
      return res.status(403).json({ success: false, message: `Row approvals can only be submitted during Under ZO Review or Under HO Review status. Current status: ${estimate.estimate_status}` });
    }

    // Validate Approvals Array
    const itemIds = approvals.map(a => a.item_id);
    if (new Set(itemIds).size !== itemIds.length) {
      return res.status(400).json({ success: false, message: 'Duplicate item_id detected.' });
    }

    // Verify all items exist and belong to this estimate
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

    // Update source_of_purchase for each approval if provided and authorized (HO/Admin)
    const canUpdateSource = ['ho', 'admin'].includes(effectiveRole);
    if (canUpdateSource) {
      for (const app of approvals) {
        if ('source_of_purchase' in app) {
          const { error: updateSourceErr } = await supabase
            .from('project_cost_estimate_items')
            .update({ source_of_purchase: (app.source_of_purchase && app.source_of_purchase !== '') ? app.source_of_purchase : null })
            .eq('item_id', app.item_id)
            .eq('estimate_id', id);
          if (updateSourceErr) throw updateSourceErr;
        }
      }
    }

    // Call submit_row_approvals RPC
    const { error: rpcError } = await supabase.rpc('submit_row_approvals', {
      p_estimate_id: id,
      p_approvals: approvals,
      p_stage: stage,
      p_modified_by: req.user.mobile_number
    });

    if (rpcError) throw rpcError;

    // Fetch updated items array
    const { data: finalItems, error: fetchFinalError } = await supabase
      .from('project_cost_estimate_items')
      .select('*, purchase_data(name)')
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

module.exports = {
  saveDraftItems,
  submitRowApprovals
};
