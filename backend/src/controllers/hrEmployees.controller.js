const { supabase } = require('../db/supabase');

const employeeSelect = 'id,employee_code,employee_name,employee_category,department,contact_number,erp_user_id,joining_date,active_status,created_at,updated_at,erp_user:authorised_users!hr_employees_erp_user_id_fkey(id,display_name,role,is_active)';
const listSelect = 'id,employee_code,employee_name,employee_category,department,contact_number,erp_user_id,joining_date,active_status,erp_user:authorised_users!hr_employees_erp_user_id_fkey(id,display_name,role,is_active)';

function sendError(res, error) {
  if (error?.code === '23505') return res.status(409).json({ success: false, message: 'Employee code or ERP account is already assigned.' });
  if (error?.code === '23503') return res.status(400).json({ success: false, message: 'Referenced ERP account does not exist.' });
  if (error?.code === '23514') return res.status(400).json({ success: false, message: 'Invalid employee field value.' });
  if (error?.code === 'P0001') return res.status(400).json({ success: false, message: error.message || 'Business rule violation.' });
  console.error('HR employee operation failed:', error);
  return res.status(500).json({ success: false, message: 'Employee operation failed.' });
}

async function validateLink(userId) {
  if (!userId) return null;
  const { data, error } = await supabase.from('authorised_users').select('id').eq('id', userId).maybeSingle();
  if (error) throw error;
  return data ? null : 'ERP account does not exist.';
}

async function listErpUsers(req, res) {
  try {
    const { role, search = '', page = 1, limit = 20 } = req.query;
    let query = supabase.from('authorised_users')
      .select('id,display_name,role,mobile_number,is_active', { count: 'exact' });
    if (role) query = query.eq('role', role);
    if (search) query = query.ilike('display_name', `%${search.replace(/[\\%_]/g, '\\$&')}%`);
    const { data, count, error } = await query
      .order('display_name').order('id').range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    return res.json({ success: true, users: data || [], pagination: {
      page, limit, totalItems: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit))
    } });
  } catch (error) { return sendError(res, error); }
}

async function listEmployees(req, res) {
  try {
    const { page = 1, limit = 20, search = '', employee_category, active_status } = req.query;
    let query = supabase.from('hr_employees').select(listSelect, { count: 'exact' });
    if (employee_category) query = query.eq('employee_category', employee_category);
    if (active_status) query = query.eq('active_status', active_status);
    if (search) {
      const escaped = search.replace(/[\\%_]/g, '\\$&');
      query = query.or(`employee_name.ilike.%${escaped}%,employee_code.ilike.%${escaped}%`);
    }
    const { data, count, error } = await query
      .order('created_at', { ascending: true })
      .order('employee_code', { ascending: true })
      .range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    return res.json({ success: true, employees: data || [], pagination: {
      page, limit, totalItems: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit))
    } });
  } catch (error) { return sendError(res, error); }
}

async function getEmployee(req, res) {
  const { data, error } = await supabase.from('hr_employees').select(employeeSelect).eq('id', req.params.id).maybeSingle();
  if (error) return sendError(res, error);
  if (!data) return res.status(404).json({ success: false, message: 'Employee not found.' });
  return res.json({ success: true, employee: data });
}

async function createEmployee(req, res) {
  try {
    const linkError = await validateLink(req.body.erp_user_id);
    if (linkError) return res.status(400).json({ success: false, message: linkError });
    const { data, error } = await supabase.from('hr_employees').insert({
      ...req.body, created_by: req.user.id, updated_by: req.user.id
    }).select(employeeSelect).single();
    if (error) return sendError(res, error);
    return res.status(201).json({ success: true, employee: data });
  } catch (error) { return sendError(res, error); }
}

async function updateEmployee(req, res) {
  try {
    if (Object.hasOwn(req.body, 'erp_user_id')) {
      const linkError = await validateLink(req.body.erp_user_id);
      if (linkError) return res.status(400).json({ success: false, message: linkError });
    }
    const { data, error } = await supabase.from('hr_employees')
      .update({ ...req.body, updated_by: req.user.id }).eq('id', req.params.id).select(employeeSelect).maybeSingle();
    if (error) return sendError(res, error);
    if (!data) return res.status(404).json({ success: false, message: 'Employee not found.' });
    return res.json({ success: true, employee: data });
  } catch (error) { return sendError(res, error); }
}

async function changeStatus(req, res) {
  return updateEmployee({ ...req, body: { active_status: req.body.active_status } }, res);
}

module.exports = { listErpUsers, listEmployees, getEmployee, createEmployee, updateEmployee, changeStatus };
