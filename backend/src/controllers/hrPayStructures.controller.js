const { supabase } = require('../db/supabase');

const PERMANENT_CATEGORIES = new Set([
  'HO Staff',
  'Fabric Factory Permanent Employees',
  'SNP Permanent Factory Labour',
  'Projects Department Employees'
]);

const payStructureSelect = 'id,employee_id,revision_number,pay_basis,guaranteed_monthly_gross,basic_salary,staff_welfare,other_fixed_components,epf_enrolment,esi_enrolment,status,created_at,updated_at,created_by,updated_by';

function sendPayError(res, error) {
  if (error?.message?.includes('Permanent pay structures can only be created') || error?.code === '23514') {
    return res.status(400).json({ success: false, message: error.message || 'Invalid pay structure values.' });
  }
  if (error?.message?.includes('not found') || error?.code === 'P0002') {
    return res.status(404).json({ success: false, message: error.message || 'Record not found.' });
  }
  if (error?.message?.includes('cannot be modified') || error?.message?.includes('superseded') || error?.code === '23505') {
    return res.status(409).json({ success: false, message: error.message || 'Pay structure version conflict.' });
  }
  console.error('HR pay structure operation failed:', error);
  return res.status(500).json({ success: false, message: 'Pay structure operation failed.' });
}

async function getEmployeePayStructures(req, res) {
  try {
    const { employeeId } = req.params;

    const { data: employee, error: empErr } = await supabase
      .from('hr_employees')
      .select('id,employee_code,employee_name,employee_category,department,active_status')
      .eq('id', employeeId)
      .maybeSingle();

    if (empErr) throw empErr;
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    if (!PERMANENT_CATEGORIES.has(employee.employee_category)) {
      return res.status(400).json({
        success: false,
        message: 'Permanent pay structures are only applicable to permanent employee categories.'
      });
    }

    const { data: revisions, error: revErr } = await supabase
      .from('hr_permanent_pay_structures')
      .select(payStructureSelect)
      .eq('employee_id', employeeId)
      .order('revision_number', { ascending: false });

    if (revErr) throw revErr;

    const activeStructure = revisions?.find(r => r.status === 'Active') || null;

    return res.json({
      success: true,
      employee,
      active_structure: activeStructure,
      revisions: revisions || []
    });
  } catch (error) {
    return sendPayError(res, error);
  }
}

async function createPayStructure(req, res) {
  try {
    const {
      employee_id,
      pay_basis,
      guaranteed_monthly_gross,
      basic_salary = null,
      staff_welfare = null,
      other_fixed_components = null,
      epf_enrolment = false,
      esi_enrolment = false,
      status = 'Draft'
    } = req.body;

    const { data: employee, error: empErr } = await supabase
      .from('hr_employees')
      .select('employee_category')
      .eq('id', employee_id)
      .maybeSingle();

    if (empErr) throw empErr;
    if (!employee) {
      return res.status(404).json({ success: false, message: 'Employee not found.' });
    }

    if (!PERMANENT_CATEGORIES.has(employee.employee_category)) {
      return res.status(400).json({
        success: false,
        message: 'Permanent pay structures can only be created for permanent employee categories.'
      });
    }

    const { data, error } = await supabase.rpc('create_hr_pay_structure', {
      p_employee_id: employee_id,
      p_pay_basis: pay_basis,
      p_guaranteed_monthly_gross: guaranteed_monthly_gross,
      p_basic_salary: basic_salary,
      p_staff_welfare: staff_welfare,
      p_other_fixed_components: other_fixed_components,
      p_epf_enrolment: epf_enrolment,
      p_esi_enrolment: esi_enrolment,
      p_status: status,
      p_actor_id: req.user.id
    });

    if (error) throw error;

    return res.status(201).json({ success: true, pay_structure: data });
  } catch (error) {
    return sendPayError(res, error);
  }
}

async function activatePayStructure(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase.rpc('activate_hr_pay_structure', {
      p_pay_structure_id: id,
      p_actor_id: req.user.id
    });

    if (error) throw error;

    return res.json({ success: true, pay_structure: data });
  } catch (error) {
    return sendPayError(res, error);
  }
}

async function updateDraftPayStructure(req, res) {
  try {
    const { id } = req.params;

    const { data: existing, error: findErr } = await supabase
      .from('hr_permanent_pay_structures')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (findErr) throw findErr;
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Pay structure revision not found.' });
    }

    if (existing.status !== 'Draft') {
      return res.status(409).json({
        success: false,
        message: 'Active or Superseded pay structures cannot be modified directly. Create a new revision.'
      });
    }

    const nextStatus = req.body.status;
    const fieldsToUpdate = { ...req.body };
    delete fieldsToUpdate.status;

    if (Object.keys(fieldsToUpdate).length > 0) {
      const { error: updErr } = await supabase
        .from('hr_permanent_pay_structures')
        .update({
          ...fieldsToUpdate,
          updated_by: req.user.id
        })
        .eq('id', id);

      if (updErr) throw updErr;
    }

    if (nextStatus === 'Active') {
      const { data: activated, error: actErr } = await supabase.rpc('activate_hr_pay_structure', {
        p_pay_structure_id: id,
        p_actor_id: req.user.id
      });
      if (actErr) throw actErr;
      return res.json({ success: true, pay_structure: activated });
    }

    const { data: refreshed, error: refErr } = await supabase
      .from('hr_permanent_pay_structures')
      .select(payStructureSelect)
      .eq('id', id)
      .single();

    if (refErr) throw refErr;

    return res.json({ success: true, pay_structure: refreshed });
  } catch (error) {
    return sendPayError(res, error);
  }
}

module.exports = {
  getEmployeePayStructures,
  createPayStructure,
  activatePayStructure,
  updateDraftPayStructure
};
