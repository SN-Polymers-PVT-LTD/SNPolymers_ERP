const { supabase } = require('../db/supabase');
const { visibleWorkOrders } = require('../helpers/workOrderAccess');

const SORT_FIELDS = new Set(['subcontractor_name', 'created_at', 'updated_at']);
const isAdmin = (req) => req.user?.role === 'admin';
const canManageSubcontractors = (req) => ['admin', 'je'].includes(req.user?.role);
const isUuid = (id) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
const selectWithCapabilities = '*, capabilities:subcontractor_work_capabilities(id, subcontract_work_id, subcontract_work:subcontract_work_master(id, sub_head, material_details, unit, is_active)), subcontractor_work_assignments:subcontractor_work_assignments(*, subcontract_work:subcontract_work_master(id, sub_head, material_details, unit))';

function filterAssignmentsByAllowed(subcontractor, allowed) {
  if (!subcontractor || allowed === null) return subcontractor;
  const assignments = (subcontractor.subcontractor_work_assignments || []).filter(a => allowed.includes(a.work_order_no));
  return { ...subcontractor, subcontractor_work_assignments: assignments };
}

async function getSubcontractors(req, res) {
  try {
    const { page = 1, limit = 10, search = '', is_active, sortBy = 'subcontractor_name', sortOrder = 'asc' } = req.query;
    const allowed = await visibleWorkOrders(req.user);
    const offset = (page - 1) * limit;
    let query = supabase.from('subcontractor_master').select(selectWithCapabilities, { count: 'exact' });
    if (!canManageSubcontractors(req)) query = query.eq('is_active', true);
    else if (is_active !== undefined && is_active !== '') query = query.eq('is_active', is_active === 'true');
    if (search) {
      query = query.ilike('subcontractor_name', `%${search}%`);
    }
    query = query.order(SORT_FIELDS.has(sortBy) ? sortBy : 'subcontractor_name', { ascending: sortOrder !== 'desc' }).range(offset, offset + limit - 1);
    const { data, count, error } = await query;
    if (error) throw error;
    const sanitized = (data || []).map(row => filterAssignmentsByAllowed(row, allowed));
    return res.json({ success: true, subcontractors: sanitized, pagination: { totalItems: count || 0, page, limit, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  } catch (error) {
    console.error(`getSubcontractors failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontractors.' });
  }
}

async function getSubcontractorById(req, res) {
  if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  const allowed = await visibleWorkOrders(req.user);
  const { data, error } = await supabase.from('subcontractor_master').select(selectWithCapabilities).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to retrieve subcontractor.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
  if (!canManageSubcontractors(req) && !data.is_active) return res.status(403).json({ success: false, message: 'Access denied. Inactive subcontractor.' });
  return res.json({ success: true, subcontractor: filterAssignmentsByAllowed(data, allowed) });
}

async function validateWorkIds(workIds) {
  if (!Array.isArray(workIds) || workIds.length === 0) return { valid: true, uniqueIds: [] };
  const uniqueIds = [...new Set(workIds)];
  const { data, error } = await supabase
    .from('subcontract_work_master')
    .select('id')
    .in('id', uniqueIds);
  if (error) throw error;
  if (!data || data.length !== uniqueIds.length) {
    return { valid: false, uniqueIds };
  }
  return { valid: true, uniqueIds };
}

async function createSubcontractor(req, res) {
  try {
    const { subcontractor_name, work_ids = [] } = req.body;

    if (Array.isArray(work_ids) && work_ids.length > 0) {
      const { valid } = await validateWorkIds(work_ids);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: 'One or more subcontract work IDs do not exist.'
        });
      }
    }

    const { data: createdId, error: rpcError } = await supabase.rpc('create_subcontractor_transact', {
      p_subcontractor_name: subcontractor_name?.trim(),
      p_work_ids: Array.isArray(work_ids) ? [...new Set(work_ids)] : [],
      p_actor: req.user.mobile_number
    });

    if (rpcError) {
      if (
        rpcError.code === 'P4B01' ||
        rpcError.code === '23503' ||
        rpcError.message?.includes('One or more subcontract work IDs do not exist')
      ) {
        return res.status(400).json({ success: false, message: 'One or more subcontract work IDs do not exist.' });
      }
      if (rpcError.code === 'P4B02' || rpcError.message?.includes('Subcontractor name cannot be blank')) {
        return res.status(400).json({ success: false, message: 'Subcontractor name cannot be blank.' });
      }
      throw rpcError;
    }

    const { data: fullContractor, error: fetchError } = await supabase
      .from('subcontractor_master')
      .select(selectWithCapabilities)
      .eq('id', createdId)
      .single();
    if (fetchError) throw fetchError;

    return res.status(201).json({ success: true, subcontractor: fullContractor, message: 'Subcontractor created successfully.' });
  } catch (error) {
    console.error(`createSubcontractor failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create subcontractor.' });
  }
}

async function updateSubcontractor(req, res) {
  try {
    const { id } = req.params;
    const { subcontractor_name, is_active, work_ids } = req.body;

    const updateWorkIds = Array.isArray(work_ids);
    if (updateWorkIds && work_ids.length > 0) {
      const { valid } = await validateWorkIds(work_ids);
      if (!valid) {
        return res.status(400).json({
          success: false,
          message: 'One or more subcontract work IDs do not exist.'
        });
      }
    }

    const { data: updatedId, error: rpcError } = await supabase.rpc('update_subcontractor_transact', {
      p_subcontractor_id: id,
      p_subcontractor_name: subcontractor_name !== undefined ? subcontractor_name?.trim() : null,
      p_is_active: is_active !== undefined ? is_active : null,
      p_work_ids: updateWorkIds ? [...new Set(work_ids)] : null,
      p_update_work_ids: updateWorkIds,
      p_actor: req.user.mobile_number
    });

    if (rpcError) {
      if (
        rpcError.code === 'P4B01' ||
        rpcError.code === '23503' ||
        rpcError.message?.includes('One or more subcontract work IDs do not exist')
      ) {
        return res.status(400).json({ success: false, message: 'One or more subcontract work IDs do not exist.' });
      }
      if (rpcError.code === 'P4B04' || rpcError.message?.includes('Subcontractor not found')) {
        return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
      }
      if (rpcError.code === 'P4B02' || rpcError.message?.includes('Subcontractor name cannot be blank')) {
        return res.status(400).json({ success: false, message: 'Subcontractor name cannot be blank.' });
      }
      throw rpcError;
    }

    const { data: fullContractor, error: fetchError } = await supabase
      .from('subcontractor_master')
      .select(selectWithCapabilities)
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    return res.json({ success: true, subcontractor: fullContractor, message: 'Subcontractor updated successfully.' });
  } catch (error) {
    console.error(`updateSubcontractor failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update subcontractor.' });
  }
}

async function updateSubcontractorStatus(req, res) {
  try {
    const { id } = req.params;
    const { data: updatedId, error: rpcError } = await supabase.rpc('update_subcontractor_transact', {
      p_subcontractor_id: id,
      p_subcontractor_name: null,
      p_is_active: req.body.is_active,
      p_work_ids: null,
      p_update_work_ids: false,
      p_actor: req.user.mobile_number
    });

    if (rpcError) {
      if (rpcError.code === 'P4B04' || rpcError.message?.includes('Subcontractor not found')) {
        return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
      }
      throw rpcError;
    }

    const { data: fullContractor, error: fetchError } = await supabase
      .from('subcontractor_master')
      .select(selectWithCapabilities)
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;

    return res.json({ success: true, subcontractor: fullContractor, message: 'Subcontractor status updated.' });
  } catch (error) {
    console.error(`updateSubcontractorStatus failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update subcontractor status.' });
  }
}

async function getSubcontractorAssignments(req, res) {
  try {
    const { page = 1, limit = 20, work_order_no = '', subcontractor_id = '', is_active } = req.query;
    const allowed = await visibleWorkOrders(req.user);
    if (allowed !== null && work_order_no && !allowed.includes(work_order_no)) {
      return res.status(403).json({ success: false, message: 'You are not assigned to this Work Order.' });
    }

    let query = supabase.from('subcontractor_work_assignments').select('*, subcontractor:subcontractor_master(id, subcontractor_name, is_active), subcontract_work:subcontract_work_master(id, sub_head, material_details, unit, is_active)', { count: 'exact' });
    if (work_order_no) {
      query = query.eq('work_order_no', work_order_no);
    } else if (allowed !== null) {
      query = query.in('work_order_no', allowed.length ? allowed : ['__none__']);
    }
    if (subcontractor_id) query = query.eq('subcontractor_id', subcontractor_id);
    if (!isAdmin(req)) query = query.eq('is_active', true);
    else if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
    const offset = (page - 1) * limit;
    const { data, count, error } = await query.order('work_order_no').range(offset, offset + limit - 1);
    if (error) throw error;
    return res.json({ success: true, assignments: data || [], pagination: { totalItems: count || 0, page, limit, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  } catch (error) {
    console.error(`getSubcontractorAssignments failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontractor work assignments.' });
  }
}

async function createSubcontractorAssignment(req, res) {
  const { work_order_no, subcontractor_id, subcontract_work_id, unit, qty, rate, rate_reference } = req.body;
  const allowed = await visibleWorkOrders(req.user);
  if (allowed !== null && !allowed.includes(work_order_no)) {
    return res.status(403).json({ success: false, message: 'You are not assigned to this Work Order.' });
  }

  const [{ data: subcontractor, error: subcontractorError }, { data: work, error: workError }] = await Promise.all([
    supabase.from('subcontractor_master').select('id, is_active').eq('id', subcontractor_id).maybeSingle(),
    supabase.from('subcontract_work_master').select('id, unit, is_active').eq('id', subcontract_work_id).maybeSingle()
  ]);
  if (subcontractorError || workError) return res.status(500).json({ success: false, message: 'Unable to validate subcontractor work assignment.' });
  if (!subcontractor || !subcontractor.is_active) return res.status(422).json({ success: false, message: 'Subcontractor must be active.' });
  if (!work || !work.is_active) return res.status(422).json({ success: false, message: 'Subcontract work must be active.' });
  if (work.unit !== unit) return res.status(422).json({ success: false, message: 'Assignment unit must match the subcontract work master.' });
  const { data, error } = await supabase.from('subcontractor_work_assignments').insert({ work_order_no, subcontractor_id, subcontract_work_id, unit, qty, rate, rate_reference: rate_reference || null, created_by: req.user.mobile_number }).select('*, subcontractor:subcontractor_master(id, subcontractor_name), subcontract_work:subcontract_work_master(id, sub_head, material_details, unit)').single();
  if (error) return res.status(422).json({ success: false, message: 'Unable to create subcontractor work assignment.' });
  return res.status(201).json({ success: true, assignment: data, message: 'Subcontractor work assignment created successfully.' });
}

module.exports = { getSubcontractors, getSubcontractorById, createSubcontractor, updateSubcontractor, updateSubcontractorStatus, getSubcontractorAssignments, createSubcontractorAssignment };
