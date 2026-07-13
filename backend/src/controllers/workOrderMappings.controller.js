'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createWorkOrderMappingSchema, deactivateWorkOrderMappingSchema } = require('../validation/workOrderMappings.schema');

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
        message: `Mismatched ZO assignment. Junior Engineer belongs to ZO ${jeZoMapping.zo_user_id}, but Work Order belongs to ZO ${project.zo_user_id}.`
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

    // 8. Insert new active mapping row
    const { data: newMapping, error: insertErr } = await supabase
      .from('work_order_mappings')
      .insert({
        work_order_no,
        je_user_id: je_mobile_number,
        is_active: true,
        reason: 'Assigned',
        assigned_by: req.user.mobile_number
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
    // 1. Fetch assignment mapping
    const { data: mapping, error: fetchErr } = await supabase
      .from('work_order_mappings')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!mapping) {
      return res.status(404).json({
        success: false,
        message: 'Work Order assignment not found.'
      });
    }

    // 2. Validate it is active
    if (!mapping.is_active) {
      return res.status(409).json({
        success: false,
        message: 'Mapping already inactive.'
      });
    }

    // 3. Update to inactive
    const { data: updated, error: updateErr } = await supabase
      .from('work_order_mappings')
      .update({
        is_active: false,
        reason,
        deactivated_at: new Date().toISOString(),
        deactivated_by: req.user.mobile_number
      })
      .eq('id', id)
      .select()
      .single();

    if (updateErr) throw updateErr;

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
    let dbQuery = supabase
      .from('work_order_mappings')
      .select('*, projects_master!inner(zo_user_id)');

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('projects_master.zo_user_id', req.user.mobile_number);
    }

    const { data: mappings, error } = await dbQuery.order('assigned_at', { ascending: false });

    if (error) throw error;

    const enriched = [];
    if (mappings && mappings.length > 0) {
      const mobiles = [];
      mappings.forEach(m => {
        mobiles.push(m.je_user_id);
        mobiles.push(m.assigned_by);
        mobiles.push(m.deactivated_by);
      });

      const userMap = await resolveDisplayNames(mobiles);

      mappings.forEach(m => {
        // Strip inner projects_master select to keep output matching schema format
        const { projects_master, ...rawMapping } = m;
        enriched.push({
          ...rawMapping,
          je_name: userMap[m.je_user_id] || m.je_user_id,
          assigned_by_name: userMap[m.assigned_by] || m.assigned_by,
          deactivated_by_name: userMap[m.deactivated_by] || m.deactivated_by || null
        });
      });
    }

    return res.status(200).json({
      success: true,
      mappings: enriched
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
