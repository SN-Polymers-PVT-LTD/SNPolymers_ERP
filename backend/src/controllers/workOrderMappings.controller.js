'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createWorkOrderMappingSchema, deactivateWorkOrderMappingSchema } = require('../validation/workOrderMappings.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * POST /api/v1/auth/work-order-mappings
 * Assigns a Work Order to a Junior Engineer.
 */
async function createWorkOrderMapping(req, res) {
  if (!validate(req, res, createWorkOrderMappingSchema)) return;

  const { work_order_no, je_mobile_number } = req.body;

  try {
    // 1. Validate Work Order exists
    const { data: project, error: projErr } = await supabase
      .from('projects_master')
      .select('work_order_no, zo_user_id, status')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (projErr) throw projErr;
    if (!project) {
      return res.status(404).json({
        success: false,
        message: 'Work Order not found.'
      });
    }

    // 2. Validate Work Order is active (not Closed)
    if (project.status === 'Closed') {
      return res.status(403).json({
        success: false,
        message: 'Cannot assign to a closed Work Order.'
      });
    }

    // 3. Validate JE exists and is indeed a JE
    const { data: jeUser, error: jeErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, role')
      .eq('mobile_number', je_mobile_number)
      .maybeSingle();

    if (jeErr) throw jeErr;
    if (!jeUser || jeUser.role !== 'je') {
      return res.status(404).json({
        success: false,
        message: 'Junior Engineer not found.'
      });
    }

    // 4. Validate JE has an active JE-ZO mapping
    const { data: jeZoMapping, error: jeZoErr } = await supabase
      .from('je_zo_mappings')
      .select('zo_user_id')
      .eq('je_user_id', je_mobile_number)
      .eq('is_active', true)
      .maybeSingle();

    if (jeZoErr) throw jeZoErr;
    if (!jeZoMapping) {
      return res.status(400).json({
        success: false,
        message: 'Junior Engineer is not assigned to any active Zonal Office.'
      });
    }

    // 5. Validate Work Order has a valid ZO owner
    if (!project.zo_user_id) {
      return res.status(400).json({
        success: false,
        message: 'Work Order has no assigned owning Zonal Office.'
      });
    }

    // 6. Compare Zonal Offices
    if (jeZoMapping.zo_user_id !== project.zo_user_id) {
      return res.status(400).json({
        success: false,
        message: `Zonal Office mismatch: Junior Engineer belongs to ZO ${jeZoMapping.zo_user_id}, but Work Order belongs to ZO ${project.zo_user_id}.`
      });
    }

    // 7. Check if assignment is already active (to return 400 gracefully)
    const { data: existing, error: existingErr } = await supabase
      .from('work_order_mappings')
      .select('id')
      .eq('work_order_no', work_order_no)
      .eq('je_user_id', je_mobile_number)
      .eq('is_active', true)
      .maybeSingle();

    if (existingErr) throw existingErr;
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'Junior Engineer is already assigned to this Work Order.'
      });
    }

    // 8. Resolve display names once, to snapshot onto the new row (see migration 040) -
    // read on subsequent GETs directly instead of re-joining/re-resolving live.
    const { data: nameRows, error: nameErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', [je_mobile_number, project.zo_user_id, req.user.mobile_number]);

    if (nameErr) throw nameErr;
    const nameMap = {};
    (nameRows || []).forEach(u => { nameMap[u.mobile_number] = u.display_name; });

    // 9. Insert new active mapping row
    const { data: newMapping, error: insertErr } = await supabase
      .from('work_order_mappings')
      .insert({
        work_order_no,
        je_user_id: je_mobile_number,
        is_active: true,
        reason: 'Assigned',
        assigned_by: req.user.mobile_number,
        je_name: nameMap[je_mobile_number] || je_mobile_number,
        zo_user_id: project.zo_user_id,
        zo_name: nameMap[project.zo_user_id] || project.zo_user_id,
        assigned_by_name: nameMap[req.user.mobile_number] || req.user.mobile_number
      })
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'Junior Engineer is already assigned to this Work Order.'
        });
      }
      throw insertErr;
    }

    return res.status(201).json({
      success: true,
      mapping: newMapping,
      message: 'Work order mapping created successfully.'
    });

  } catch (error) {
    console.error(`createWorkOrderMapping failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create work order mapping.' });
  }
}

/**
 * PATCH /api/v1/auth/work-order-mappings/:id/deactivate
 * Deactivates an active Work Order assignment.
 */
async function deactivateWorkOrderMapping(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid assignment ID format.' });
  }

  if (!validate(req, res, deactivateWorkOrderMappingSchema)) return;

  const { reason } = req.body;

  try {
    // Locks the row and writes the deactivated_by_name snapshot atomically with the
    // status flip (see migration 040) - closes the same class of race the JE-ZO
    // transfer RPC closes, even though this deactivation is single-step.
    const { data: updated, error: rpcErr } = await supabase.rpc('deactivate_work_order_mapping_transact', {
      p_id: id,
      p_reason: reason,
      p_actor: req.user.mobile_number
    });

    if (rpcErr) {
      if (rpcErr.code === 'NF001') {
        return res.status(404).json({ success: false, message: 'Work Order assignment not found.' });
      }
      if (rpcErr.code === 'STA01') {
        return res.status(409).json({ success: false, message: 'Mapping already inactive.' });
      }
      throw rpcErr;
    }

    return res.status(200).json({
      success: true,
      mapping: updated,
      message: 'Work order mapping deactivated successfully.'
    });

  } catch (error) {
    console.error(`deactivateWorkOrderMapping failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to deactivate work order mapping.' });
  }
}

/**
 * GET /api/v1/auth/work-order-mappings
 * Retrieves work order mappings. ZOs only see mappings for projects in their zone.
 */
async function getWorkOrderMappings(req, res) {
  try {
    const { status = 'all', sort = 'assigned_at', page, pageSize } = req.query || {};

    // zo_user_id/zo_name/je_name/assigned_by_name/deactivated_by_name are snapshot
    // columns captured at write time (see migration 040) - no live join/lookup
    // needed here, and a ZO's visibility is scoped to the ZO that owned the work
    // order at assignment time rather than whoever owns it today.
    let dbQuery = supabase
      .from('work_order_mappings')
      .select('*', { count: 'exact' });

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    }

    if (status === 'active') {
      dbQuery = dbQuery.eq('is_active', true);
    } else if (status === 'inactive') {
      dbQuery = dbQuery.eq('is_active', false);
    }

    const sortColumn = sort === 'deactivated_at' ? 'deactivated_at' : 'assigned_at';
    dbQuery = dbQuery.order(sortColumn, { ascending: false, nullsFirst: false });

    const pageNum = Number(page) > 0 ? Number(page) : null;
    const pageSizeNum = Number(pageSize) > 0 ? Number(pageSize) : null;
    if (pageNum && pageSizeNum) {
      const from = (pageNum - 1) * pageSizeNum;
      dbQuery = dbQuery.range(from, from + pageSizeNum - 1);
    }

    const { data: mappings, error, count } = await dbQuery;

    if (error) throw error;

    return res.status(200).json({
      success: true,
      mappings: mappings || [],
      total: count ?? (mappings || []).length
    });

  } catch (error) {
    console.error(`getWorkOrderMappings failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve work order mappings.' });
  }
}

module.exports = {
  createWorkOrderMapping,
  deactivateWorkOrderMapping,
  getWorkOrderMappings
};
