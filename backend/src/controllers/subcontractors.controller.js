const { supabase } = require('../db/supabase');

const SORT_FIELDS = new Set(['subcontractor_name', 'created_at', 'updated_at']);
const isAdmin = (req) => req.user?.role === 'admin';
const isUuid = (id) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
const selectWithAssignments = '*, subcontractor_work_assignments:subcontractor_work_assignments(*, subcontract_work:subcontract_work_master(id, sub_head, material_details, unit))';
const quoteFilterValue = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function getSubcontractors(req, res) {
  try {
    const { page = 1, limit = 10, search = '', is_active, sortBy = 'subcontractor_name', sortOrder = 'asc' } = req.query;
    const offset = (page - 1) * limit;
    let query = supabase.from('subcontractor_master').select(selectWithAssignments, { count: 'exact' });
    if (!isAdmin(req)) query = query.eq('is_active', true);
    else if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
    if (search) {
      const p = quoteFilterValue(`%${search}%`);
      query = query.ilike('subcontractor_name', p);
    }
    query = query.order(SORT_FIELDS.has(sortBy) ? sortBy : 'subcontractor_name', { ascending: sortOrder !== 'desc' }).range(offset, offset + limit - 1);
    const { data, count, error } = await query;
    if (error) throw error;
    return res.json({ success: true, subcontractors: data || [], pagination: { totalItems: count || 0, page, limit, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  } catch (error) {
    console.error(`getSubcontractors failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontractors.' });
  }
}

async function getSubcontractorById(req, res) {
  if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  const { data, error } = await supabase.from('subcontractor_master').select(selectWithAssignments).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to retrieve subcontractor.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
  if (!isAdmin(req) && !data.is_active) return res.status(403).json({ success: false, message: 'Access denied. Inactive subcontractor.' });
  return res.json({ success: true, subcontractor: data });
}

async function createSubcontractor(req, res) {
  try {
    const { data, error } = await supabase.from('subcontractor_master').insert({ subcontractor_name: req.body.subcontractor_name, created_by: req.user.mobile_number }).select(selectWithAssignments).single();
    if (error) throw error;
    return res.status(201).json({ success: true, subcontractor: data, message: 'Subcontractor created successfully.' });
  } catch (error) {
    console.error(`createSubcontractor failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create subcontractor.' });
  }
}

async function updateSubcontractor(req, res) {
  try {
    const { data, error } = await supabase.from('subcontractor_master').update({ subcontractor_name: req.body.subcontractor_name, updated_by: req.user.mobile_number }).eq('id', req.params.id).select(selectWithAssignments).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
    return res.json({ success: true, subcontractor: data, message: 'Subcontractor updated successfully.' });
  } catch (error) {
    console.error(`updateSubcontractor failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update subcontractor.' });
  }
}

async function updateSubcontractorStatus(req, res) {
  const { data, error } = await supabase.from('subcontractor_master').update({ is_active: req.body.is_active, updated_by: req.user.mobile_number }).eq('id', req.params.id).select(selectWithAssignments).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to update subcontractor status.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
  return res.json({ success: true, subcontractor: data, message: 'Subcontractor status updated.' });
}

async function getSubcontractorAssignments(req, res) {
  try {
    const { page = 1, limit = 20, work_order_no = '', subcontractor_id = '', is_active } = req.query;
    let query = supabase.from('subcontractor_work_assignments').select('*, subcontractor:subcontractor_master(id, subcontractor_name, is_active), subcontract_work:subcontract_work_master(id, sub_head, material_details, unit, is_active)', { count: 'exact' });
    if (work_order_no) query = query.eq('work_order_no', work_order_no);
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
