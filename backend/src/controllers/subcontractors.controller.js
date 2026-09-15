const { supabase } = require('../db/supabase');

const SORT_FIELDS = new Set(['subcontractor_name', 'contact_person', 'created_at', 'updated_at']);
const isAdmin = (req) => req.user?.role === 'admin';
const isUuid = (id) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(id);
const beneficiaryFields = 'id, beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_id, beneficiary_bank_name';
const selectWithBeneficiary = `*, primary_beneficiary:projects_beneficiary_master(${beneficiaryFields})`;
const quoteFilterValue = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

async function getSubcontractors(req, res) {
  try {
    const { page = 1, limit = 10, search = '', is_active, beneficiary_status, sortBy = 'subcontractor_name', sortOrder = 'asc' } = req.query;
    const offset = (page - 1) * limit;
    let query = supabase.from('subcontractor_master').select(selectWithBeneficiary, { count: 'exact' });
    if (!isAdmin(req)) query = query.eq('is_active', true);
    else if (is_active !== undefined) query = query.eq('is_active', is_active === 'true');
    if (beneficiary_status === 'linked') query = query.not('primary_beneficiary_id', 'is', null);
    if (beneficiary_status === 'unlinked') query = query.is('primary_beneficiary_id', null);
    if (search) {
      const p = quoteFilterValue(`%${search}%`);
      query = query.or(`subcontractor_name.ilike.${p},contact_person.ilike.${p},mobile.ilike.${p},email.ilike.${p},pan_no.ilike.${p},gst_no.ilike.${p}`);
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
  const { data, error } = await supabase.from('subcontractor_master').select(selectWithBeneficiary).eq('id', req.params.id).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to retrieve subcontractor.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
  if (!isAdmin(req) && !data.is_active) return res.status(403).json({ success: false, message: 'Access denied. Inactive subcontractor.' });
  return res.json({ success: true, subcontractor: data });
}

async function validateBeneficiary(id) {
  if (!id) return null;
  const { data, error } = await supabase.from('projects_beneficiary_master').select('id').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? id : false;
}

async function createSubcontractor(req, res) {
  try {
    const beneficiary = await validateBeneficiary(req.body.primary_beneficiary_id);
    if (beneficiary === false) return res.status(422).json({ success: false, message: 'Selected beneficiary does not exist.' });
    const { data, error } = await supabase.from('subcontractor_master').insert({ ...req.body, primary_beneficiary_id: beneficiary, created_by: req.user.mobile_number }).select(selectWithBeneficiary).single();
    if (error) throw error;
    return res.status(201).json({ success: true, subcontractor: data, message: 'Subcontractor created successfully.' });
  } catch (error) {
    console.error(`createSubcontractor failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create subcontractor.' });
  }
}

async function updateSubcontractor(req, res) {
  try {
    const payload = { ...req.body, updated_by: req.user.mobile_number };
    if (Object.hasOwn(req.body, 'primary_beneficiary_id')) {
      const beneficiary = await validateBeneficiary(req.body.primary_beneficiary_id);
      if (beneficiary === false) return res.status(422).json({ success: false, message: 'Selected beneficiary does not exist.' });
      payload.primary_beneficiary_id = beneficiary;
    }
    const { data, error } = await supabase.from('subcontractor_master').update(payload).eq('id', req.params.id).select(selectWithBeneficiary).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
    return res.json({ success: true, subcontractor: data, message: 'Subcontractor updated successfully.' });
  } catch (error) {
    console.error(`updateSubcontractor failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update subcontractor.' });
  }
}

async function updateSubcontractorStatus(req, res) {
  const { data, error } = await supabase.from('subcontractor_master').update({ is_active: req.body.is_active, updated_by: req.user.mobile_number }).eq('id', req.params.id).select(selectWithBeneficiary).maybeSingle();
  if (error) return res.status(500).json({ success: false, message: 'Failed to update subcontractor status.' });
  if (!data) return res.status(404).json({ success: false, message: 'Subcontractor not found.' });
  return res.json({ success: true, subcontractor: data, message: 'Subcontractor status updated.' });
}

module.exports = { getSubcontractors, getSubcontractorById, createSubcontractor, updateSubcontractor, updateSubcontractorStatus };
