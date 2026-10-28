const { supabase } = require('../db/supabase');

const { permanentCategories } = require('../domain/hrEmployeeCategories');
const PERMANENT_CATEGORIES = new Set(permanentCategories);

const payStructureSelect = 'id,employee_id,revision_number,pay_basis,guaranteed_monthly_gross,epf_enrolment,esi_enrolment,status,created_at,updated_at,created_by,updated_by';
const publicPay = row => Object.fromEntries(payStructureSelect.split(',').filter(key => Object.hasOwn(row,key)).map(key => [key,row[key]]));

function sendPayError(res, error) {
  if(error?.code==='22023'||error?.code==='22P02')return res.status(400).json({success:false,message:error.message});
  if(error?.code==='42501')return res.status(403).json({success:false,message:error.message});
  if (error?.code === 'PY409') return res.status(409).json({ success: false, code: 'PAYROLL_SOURCE_BUSY', message: error.message });
  if (error?.message?.includes('Permanent pay structures can only be created') || error?.code === '23514') {
    return res.status(400).json({ success: false, message: error.message || 'Invalid pay structure values.' });
  }
  if (error?.message?.includes('not found') || error?.code === 'P0002') {
    return res.status(404).json({ success: false, message: error.message || 'Record not found.' });
  }
  if (error?.message?.includes('cannot be modified') || error?.message?.includes('superseded') || error?.message?.includes('Only active pay structures can be suspended') || error?.code === '23505') {
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
      .select('id,employee_code,employee_name,employee_category,department,active_status,joining_date')
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

async function suspendPayStructure(req, res) {
  try {
    const { id } = req.params;

    const { data, error } = await supabase.rpc('suspend_hr_pay_structure', {
      p_pay_structure_id: id,
      p_actor_id: req.user.id
    });

    if (error) throw error;

    return res.json({ success: true, pay_structure: publicPay(data) });
  } catch (error) {
    return sendPayError(res, error);
  }
}

async function listPayStructures(req, res) {
  try {
    // The existing response is a complete employee/pay-structure directory.
    // PostgREST caps one request at 1,000 rows; fetch stable batches so newer
    // employee structures do not silently disappear from Employee Management.
    const employees = [];
    const batchSize = 1000;
    for (let offset = 0; ; offset += batchSize) {
      const { data, error } = await supabase
        .from('hr_employees')
        .select(`
          id,
          employee_code,
          employee_name,
          employee_category,
          department,
          active_status,
          pay_structures:hr_permanent_pay_structures(
            id,
            revision_number,
            pay_basis,
            guaranteed_monthly_gross,
            epf_enrolment,
            esi_enrolment,
            status,
            created_at,
            updated_at
          )
        `)
        .in('employee_category', Array.from(PERMANENT_CATEGORIES))
        .order('employee_code', { ascending: true })
        .order('revision_number', { foreignTable: 'hr_permanent_pay_structures', ascending: false })
        .range(offset, offset + batchSize - 1);

      if (error) throw error;
      employees.push(...(data || []));
      if (!data || data.length < batchSize) break;
    }

    return res.json({ success: true, pay_structures: employees || [] });
  } catch (error) {
    return sendPayError(res, error);
  }
}

module.exports = {
  listPayStructures,
  getEmployeePayStructures,
  suspendPayStructure
};

const payrollRpc = (name,params) => async(req,res) => {
 try {const {data,error}=await supabase.rpc(name,{p_actor_id:req.user.id,...params(req)});if(error)return sendPayError(res,error);return res.json({success:true,result:data});}
 catch(error){return sendPayError(res,error);}
};
module.exports.payrollContext=payrollRpc('get_hr_payroll_salary_context',r=>({p_employee_id:r.params.employeeId}));
module.exports.savePayrollSalary=payrollRpc('save_hr_payroll_salary',r=>({p_employee_id:r.body.employee_id,p_existing_id:r.body.existing_id,p_from:r.body.effective_from,p_expected_version:r.body.expected_version,p_pay:r.body.pay,p_reason:r.body.reason}));
module.exports.initialAssignment=payrollRpc('initialize_hr_payroll_assignment',r=>({p_employee_id:r.body.employee_id,p_from:r.body.effective_from,p_reason:r.body.reason}));
