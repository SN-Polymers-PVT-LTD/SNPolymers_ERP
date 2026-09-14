const { supabase } = require('../db/supabase');

const SORT_FIELDS = new Set(['sub_head', 'material_details', 'unit', 'created_at', 'updated_at']);
const isAdmin = (req) => req.user?.role === 'admin';
const isUuid = (id) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);

async function getSubcontractWorks(req, res) {
  try {
    const { page = 1, limit = 10, search = '', sub_head = '', unit = '', is_active, sortBy = 'material_details', sortOrder = 'asc' } = req.query;
    const offset = (page - 1) * limit;
    let query = supabase.from('subcontract_work_master').select('*', { count: 'exact' });
    if (!isAdmin(req)) query = query.eq('is_active', true);
    else if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
    if (sub_head) query = query.eq('sub_head', sub_head);
    if (unit) query = query.eq('unit', unit);
    if (search) {
      const p = `%${search}%`;
      query = query.or(`sub_head.ilike.${p},material_details.ilike.${p},unit.ilike.${p}`);
    }
    query = query.order(SORT_FIELDS.has(sortBy) ? sortBy : 'material_details', { ascending: sortOrder !== 'desc' }).range(offset, offset + limit - 1);
    const { data, count, error } = await query;
    if (error) throw error;
    return res.json({ success: true, subcontractWorks: data || [], pagination: { totalItems: count || 0, page, limit, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  } catch (error) {
    console.error(`getSubcontractWorks failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontract works.' });
  }
}

async function getSubcontractWorkById(req, res) {
  if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  const { data, error } = await supabase.from('subcontract_work_master').select('*').eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to retrieve subcontract work.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontract work not found.' });
  if (!isAdmin(req) && !data.is_active) return res.status(403).json({ success: false, message: 'Access denied. Inactive subcontract work.' });
  return res.json({ success: true, subcontractWork: data });
}

async function createSubcontractWork(req, res) {
  const { sub_head, material_details, unit } = req.body;
  const { data, error } = await supabase.from('subcontract_work_master').insert({ sub_head, material_details, unit, created_by: req.user.mobile_number }).select().single();
  if (error) {
    if (error.code === '23505') return res.status(409).json({ success: false, message: 'That subcontract work already exists.' });
    console.error(`createSubcontractWork failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create subcontract work.' });
  }
  return res.status(201).json({ success: true, subcontractWork: data, message: 'Subcontract work created successfully.' });
}

async function updateSubcontractWork(req, res) {
  const { id } = req.params;
  const { data: current, error: fetchError } = await supabase.from('subcontract_work_master').select('*').eq('id', id).maybeSingle();
  if (fetchError) return res.status(500).json({ success: false, message: 'Failed to retrieve subcontract work.' });
  if (!current) return res.status(404).json({ success: false, message: 'Subcontract work not found.' });
  const changed = current.sub_head !== req.body.sub_head || current.material_details !== req.body.material_details || current.unit !== req.body.unit;
  if (changed) {
    const { data: referenced, error } = await supabase.from('project_subcontract_estimate_lines').select('line_id').eq('subcontract_work_id', id).limit(1);
    if (error) return res.status(500).json({ success: false, message: 'Failed to check subcontract work usage.' });
    if (referenced?.length) return res.status(409).json({ success: false, message: 'This subcontract work is already in use. Create a new work item and deactivate the old one instead.' });
  }
  const { data, error } = await supabase.from('subcontract_work_master').update({ ...req.body, updated_by: req.user.mobile_number }).eq('id', id).select().single();
  if (error) return res.status(error.code === '23505' ? 409 : 500).json({ success: false, message: error.code === '23505' ? 'That subcontract work already exists.' : 'Failed to update subcontract work.' });
  return res.json({ success: true, subcontractWork: data, message: 'Subcontract work updated successfully.' });
}

async function updateSubcontractWorkStatus(req, res) {
  const { data, error } = await supabase.from('subcontract_work_master').update({ is_active: req.body.is_active, updated_by: req.user.mobile_number }).eq('id', req.params.id).select().maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to update subcontract work status.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontract work not found.' });
  return res.json({ success: true, subcontractWork: data, message: 'Subcontract work status updated.' });
}

module.exports = { getSubcontractWorks, getSubcontractWorkById, createSubcontractWork, updateSubcontractWork, updateSubcontractWorkStatus };
