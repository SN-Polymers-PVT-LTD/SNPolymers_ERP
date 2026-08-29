'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createUserMappingSchema } = require('../validation/userMappings.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * POST /api/v1/auth/user-mappings
 * Creates or updates/transfers a Junior Engineer mapping to a Zonal Office.
 */
async function createOrUpdateUserMapping(req, res) {
  if (!validate(req, res, createUserMappingSchema)) return;

  const { je_mobile_number, zo_mobile_number } = req.body;

  try {
    // 1. Role Validation: fast pre-check before hitting the RPC, for a quick error
    // message. Not authoritative on its own - the RPC's own writes (backed by the
    // fn_validate_je_zo_mapping_roles trigger) are what actually enforce this.
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

    // 2. Fast pre-check for pending/hold requisitions, for immediate UX feedback.
    // The RPC re-checks this same guard inside its advisory lock right before
    // writing, which is what actually closes the race - a requisition created in
    // the gap between this check and the RPC call is still caught there.
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

    // 3. Atomic transfer: deactivates any old work-order mappings and old JE-ZO
    // mapping, then inserts the new one, all in a single DB transaction serialized
    // per-JE by an advisory lock. See migration 040 for the full rationale - this
    // replaces a previous 3-step non-transactional sequence that could orphan a JE
    // (old mapping/work-orders deactivated, new mapping insert lost a unique-index
    // race) under concurrent transfer requests.
    const { data: newMapping, error: rpcErr } = await supabase.rpc('transfer_je_to_zo_transact', {
      p_je: je_mobile_number,
      p_zo: zo_mobile_number,
      p_actor: req.user.mobile_number
    });

    if (rpcErr) {
      if (rpcErr.code === 'REQ01') {
        return res.status(400).json({ success: false, message: rpcErr.message });
      }
      if (rpcErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'Junior Engineer was just mapped to a Zonal Office by another request. Please refresh and retry.'
        });
      }
      throw rpcErr;
    }

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
 * PATCH /api/v1/auth/user-mappings/:id/deactivate
 * Unmaps a Junior Engineer from a Zonal Office without assigning a replacement.
 */
async function deactivateUserMapping(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid mapping ID format.' });
  }

  try {
    const { data: updated, error: rpcErr } = await supabase.rpc('deactivate_je_zo_mapping_transact', {
      p_id: id,
      p_actor: req.user.mobile_number
    });

    if (rpcErr) {
      if (rpcErr.code === 'NF001') {
        return res.status(404).json({ success: false, message: 'JE-ZO mapping not found.' });
      }
      if (rpcErr.code === 'STA01') {
        return res.status(409).json({ success: false, message: 'Mapping already inactive.' });
      }
      throw rpcErr;
    }

    return res.status(200).json({
      success: true,
      mapping: updated,
      message: 'Junior Engineer unmapped successfully.'
    });

  } catch (error) {
    console.error(`deactivateUserMapping failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to unmap Junior Engineer.' });
  }
}

/**
 * GET /api/v1/auth/user-mappings
 * Retrieves active and inactive user mappings. ZOs only see mappings for their own ZO.
 */
async function getUserMappings(req, res) {
  try {
    const { status = 'all', sort = 'assigned_at' } = req.query || {};

    let dbQuery = supabase
      .from('je_zo_mappings')
      .select('*');

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
    } else if (req.user.role === 'je') {
      dbQuery = dbQuery.eq('je_user_id', req.user.mobile_number);
    }

    if (status === 'active') {
      dbQuery = dbQuery.eq('is_active', true);
    } else if (status === 'inactive') {
      dbQuery = dbQuery.eq('is_active', false);
    }

    const sortColumn = sort === 'deactivated_at' ? 'deactivated_at' : 'assigned_at';
    const { data: mappings, error } = await dbQuery.order(sortColumn, { ascending: false, nullsFirst: false });

    if (error) throw error;

    // je_name/zo_name/assigned_by_name/deactivated_by_name are snapshot columns
    // captured at write time (see migration 040) - no live lookup needed here.
    return res.status(200).json({
      success: true,
      mappings: mappings || []
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
 * Returns all active ZOs without financial balance filtering.
 */
async function getEligibleZOs(req, res) {
  try {
    const zoService = require('../services/zo.service');
    const zos = await zoService.getAllActiveZOs();
    return res.status(200).json({ success: true, zos });
  } catch (error) {
    console.error(`getUserMappings getEligibleZOs failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Zonal Office users.' });
  }
}

module.exports = {
  createOrUpdateUserMapping,
  deactivateUserMapping,
  getUserMappings,
  getEligibleJEs,
  getEligibleZOs
};
