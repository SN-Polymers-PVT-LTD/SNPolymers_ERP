'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createUserMappingSchema } = require('../validation/userMappings.schema');

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
 * POST /api/v1/auth/user-mappings
 * Creates or updates/transfers a Junior Engineer mapping to a Zonal Office.
 */
async function createOrUpdateUserMapping(req, res) {
  if (!validate(req, res, createUserMappingSchema)) return;

  const { je_mobile_number, zo_mobile_number } = req.body;

  try {
    // 1. Role Validation: Check user roles upfront before any DB writes
    const { data: users, error: usersErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, role')
      .in('mobile_number', [je_mobile_number, zo_mobile_number]);

    if (usersErr) throw usersErr;

    const jeUser = users.find(u => u.mobile_number === je_mobile_number);
    const zoUser = users.find(u => u.mobile_number === zo_mobile_number);

    if (!jeUser || jeUser.role !== 'je') {
      return res.status(400).json({
        success: false,
        message: `Target user (${je_mobile_number}) is not a Junior Engineer.`
      });
    }

    if (!zoUser || zoUser.role !== 'zo') {
      return res.status(400).json({
        success: false,
        message: `Target user (${zo_mobile_number}) is not a Zonal Office user.`
      });
    }

    // 2. Service-Layer Guard: Check if JE has any requisitions in 'Pending' or 'Hold' status
    const { data: requisitions, error: reqErr } = await supabase
      .from('requisitions')
      .select('requisition_id')
      .eq('requester_user_id', je_mobile_number)
      .in('requisition_status', ['Pending', 'Hold']);

    if (reqErr) throw reqErr;

    if (requisitions && requisitions.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot transfer JE. Uncompleted requisitions remain.'
      });
    }

    // 3. Query existing active mapping for the JE
    const { data: oldMapping, error: oldMapErr } = await supabase
      .from('je_zo_mappings')
      .select('*')
      .eq('je_user_id', je_mobile_number)
      .eq('is_active', true)
      .maybeSingle();

    if (oldMapErr) throw oldMapErr;

    // If active mapping exists, deactivate assignments and mappings
    if (oldMapping) {
      // NOTE: We MUST deallocate work order mappings first.
      // This is because the database trigger on work_order_mappings requires the JE to have an active ZO mapping.
      // If we deactivate the je_zo_mappings row first, the trigger will fail during work_order_mappings updates.
      const { data: oldProjects, error: oldProjectsErr } = await supabase
        .from('projects_master')
        .select('work_order_no')
        .eq('zo_user_id', oldMapping.zo_user_id);

      if (oldProjectsErr) throw oldProjectsErr;

      if (oldProjects && oldProjects.length > 0) {
        const oldProjectWos = oldProjects.map(p => p.work_order_no);
        const { error: woDeallocErr } = await supabase
          .from('work_order_mappings')
          .update({
            is_active: false,
            reason: 'Transferred',
            deactivated_at: new Date().toISOString(),
            deactivated_by: req.user.mobile_number
          })
          .eq('je_user_id', je_mobile_number)
          .eq('is_active', true)
          .in('work_order_no', oldProjectWos);

        if (woDeallocErr) throw woDeallocErr;
      }

      // Now deactivate old mapping safely
      const { error: deactivateErr } = await supabase
        .from('je_zo_mappings')
        .update({
          is_active: false,
          deactivated_at: new Date().toISOString(),
          deactivated_by: req.user.mobile_number
        })
        .eq('id', oldMapping.id);

      if (deactivateErr) throw deactivateErr;
    }

    // 4. Insert new active mapping row
    const { data: newMapping, error: insertErr } = await supabase
      .from('je_zo_mappings')
      .insert({
        je_user_id: je_mobile_number,
        zo_user_id: zo_mobile_number,
        is_active: true,
        assigned_by: req.user.mobile_number
      })
      .select()
      .single();

    if (insertErr) throw insertErr;

    return res.status(201).json({
      success: true,
      mapping: newMapping,
      message: 'User mapping created successfully.'
    });

  } catch (error) {
    console.error(`createOrUpdateUserMapping failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create user mapping.' });
  }
}

/**
 * GET /api/v1/auth/user-mappings
 * Retrieves active and inactive user mappings. ZOs only see mappings for their own ZO.
 */
async function getUserMappings(req, res) {
  try {
    let dbQuery = supabase
      .from('je_zo_mappings')
      .select('*');

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    }

    const { data: mappings, error } = await dbQuery.order('assigned_at', { ascending: false });

    if (error) throw error;

    const enriched = [];
    if (mappings && mappings.length > 0) {
      const mobiles = [];
      mappings.forEach(m => {
        mobiles.push(m.je_user_id);
        mobiles.push(m.zo_user_id);
        mobiles.push(m.assigned_by);
        mobiles.push(m.deactivated_by);
      });

      const userMap = await resolveDisplayNames(mobiles);

      mappings.forEach(m => {
        enriched.push({
          ...m,
          je_name: userMap[m.je_user_id] || m.je_user_id,
          zo_name: userMap[m.zo_user_id] || m.zo_user_id,
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
    console.error(`getUserMappings failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve user mappings.' });
  }
}

/**
 * GET /api/v1/auth/user-mappings/eligible-jes
 * Returns all active JEs and their current active ZO mapping user ID (or null).
 */
async function getEligibleJEs(req, res) {
  try {
    // 1. Fetch all active JEs
    const { data: jes, error: jesErr } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .eq('role', 'je')
      .eq('is_active', true)
      .order('display_name', { ascending: true });

    if (jesErr) throw jesErr;

    if (!jes || jes.length === 0) {
      return res.status(200).json({ success: true, jes: [] });
    }

    // 2. Fetch all active mappings
    const { data: mappings, error: mapErr } = await supabase
      .from('je_zo_mappings')
      .select('je_user_id, zo_user_id')
      .eq('is_active', true);

    if (mapErr) throw mapErr;

    // Create a mapping map
    const mappingMap = {};
    if (mappings) {
      mappings.forEach(m => {
        mappingMap[m.je_user_id] = m.zo_user_id;
      });
    }

    // 3. Enrich JEs with active_zo_user_id
    const enrichedJes = jes.map(je => ({
      mobile_number: je.mobile_number,
      display_name: je.display_name,
      active_zo_user_id: mappingMap[je.mobile_number] || null
    }));

    return res.status(200).json({ success: true, jes: enrichedJes });
  } catch (error) {
    console.error(`getEligibleJEs failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve eligible Junior Engineers.' });
  }
}

/**
 * GET /api/v1/auth/user-mappings/eligible-zos
 * Returns all active ZOs.
 */
async function getEligibleZOs(req, res) {
  try {
    const { data: zos, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .eq('role', 'zo')
      .eq('is_active', true)
      .order('display_name', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, zos: zos || [] });
  } catch (error) {
    console.error(`getEligibleZOs failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve eligible Zonal Office users.' });
  }
}

module.exports = {
  createOrUpdateUserMapping,
  getUserMappings,
  getEligibleJEs,
  getEligibleZOs
};
