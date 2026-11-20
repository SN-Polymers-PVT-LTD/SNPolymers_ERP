const { supabase } = require('../db/supabase');
const { factoryCategories, wageCategories, departmentsFor } = require('../domain/hrEmployeeCategories');

function sendError(res, error) {
  if (error?.code === 'PY409') return res.status(409).json({ success: false, code: 'PAYROLL_SOURCE_BUSY', message: error.message });
  if (error?.code === 'P0002') return res.status(404).json({ success: false, message: error.message });
  if (error?.code === '23505') return res.status(409).json({ success: false, code: 'REVISION_DATE_CONFLICT', message: 'A revision or calculation setup already exists for this date or rule.' });
  if (error?.code === '42501') return res.status(403).json({ success: false, message: 'Factory access denied.' });
  if (['23514', '23503', '22003', '22023', '22P02'].includes(error?.code)) return res.status(400).json({ success: false, message: 'Invalid factory master values.' });
  console.error('Factory master operation failed:', error);
  return res.status(500).json({ success: false, message: 'Factory master operation failed.' });
}

function list(table) {
  return async (req, res) => {
    const { employee_category, department, as_of, page, limit } = req.query;
    let query = supabase.from(table).select('*', { count: 'exact' });
    if (employee_category) query = query.eq('employee_category', employee_category);
    if (department) query = query.or(`department.eq.${department},department.is.null`);
    // Resolve current IDs independently of pagination; future dates never displace them.
    const categories = employee_category ? [employee_category] : table === 'hr_factory_wage_revisions'
      ? wageCategories
      : factoryCategories;
    const [rows, ...resolved] = await Promise.all([
      (table === 'hr_factory_pay_rule_revisions' ? query.select('*,calculation:hr_factory_pay_rule_calculations(*),treatment:hr_factory_pay_rule_treatments(*)', { count: 'exact' }) : query).order('department', {ascending:true,nullsFirst:false}).order('effective_from', { ascending: false }).order('id').range((page - 1) * limit, page * limit - 1),
      ...categories.flatMap(category=>departmentsFor(category).filter(dept=>!department||dept===department).map(dept=>({category,dept}))).map(({category,dept}) => {
        let current=supabase.from(table).select('id,employee_category,department').eq('employee_category',category).lte('effective_from',as_of);
        current=current.eq('department',dept);
        return current.order('effective_from',{ascending:false}).limit(1).maybeSingle();
      })
    ]);
    const { data, count, error } = rows;
    const failure = error || resolved.find(result => result.error)?.error;
    if (failure) return sendError(res, failure);
    const ids = new Set(resolved.filter(result => result.data).map(result => result.data.id));
    return res.json({ success: true, revisions: (data || []).map(row => ({ ...row,
      scope_label: row.department || (row.employee_category==='Local Daily-Wage Workers'?'Shared legacy setup':departmentsFor(row.employee_category)[0]+' legacy setup'),
      display_status: !row.department ? 'Legacy' : row.effective_from > as_of ? 'Future' : ids.has(row.id) ? 'Current' : 'Historical'
    })), pagination: { page, limit, totalItems: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  };
}

function create(table) {
  return async (req, res) => {
    const { data, error } = await supabase.from(table).insert({ ...req.body, created_by: req.user.id }).select('*').single();
    if (error) return sendError(res, error);
    return res.status(201).json({ success: true, revision: data });
  };
}

async function effective(req, res) {
  const { employee_category, department, date } = req.query;
  const tables = ['hr_factory_wage_revisions', 'hr_factory_pay_rule_revisions'];
  const read = (table,legacy) => {
    let query=supabase.from(table).select(table==='hr_factory_pay_rule_revisions'?'*,calculation:hr_factory_pay_rule_calculations(*),treatment:hr_factory_pay_rule_treatments(*)':'*').eq('employee_category',employee_category).lte('effective_from',date);
    query=legacy?query.is('department',null):query.eq('department',department);
    return query.order('effective_from',{ascending:false}).limit(1).maybeSingle();
  };
  const results=await Promise.all(tables.map(table=>read(table,false)));
  const legacy=await Promise.all(tables.map(table=>read(table,true)));

  const error = [...results,...legacy].find(result => result.error)?.error;
  if (error) return sendError(res, error);
  return res.json({ success: true, date, employee_category, department, legacy_wage_revision:legacy[0].data,legacy_rule_revision:legacy[1].data, wage_revision: results[0].data || (employee_category!=='Local Daily-Wage Workers'?legacy[0].data:null), rule_revision: results[1].data || (employee_category!=='Local Daily-Wage Workers'?legacy[1].data:null) });
}
module.exports = {
  listWages: list('hr_factory_wage_revisions'), createWage: create('hr_factory_wage_revisions'),
  listRules: list('hr_factory_pay_rule_revisions'), effective,
  createRule: async (req,res) => {
    const { calculation, treatment, ...rule } = req.body;
    const { data,error } = await supabase.rpc('create_factory_rule',{p_rule:rule,p_calculation:calculation||null,p_actor_id:req.user.id,p_treatment:treatment||null});
    if(error)return sendError(res,error);
    return res.status(201).json({success:true,revision:data});
  },
  setupImpact: async (req,res) => {
    const {data,error}=await supabase.rpc('factory_setup_impact',{p_rule_id:req.params.id,p_actor_id:req.user.id});
    if(error)return sendError(res,error);return res.json({success:true,impact:data});
  },
  completeSetup: async (req,res) => {
    const {data,error}=await supabase.rpc('complete_factory_setup',{p_rule_id:req.params.id,p_salary_days:req.body.salary_days,p_holiday_salary_days:req.body.holiday_salary_days,p_reason:req.body.reason,p_actor_id:req.user.id});
    if(error)return sendError(res,error);return res.status(201).json({success:true,setup:data});
  },
  treatmentImpact: async (req,res) => {
    const {data,error}=await supabase.rpc('factory_treatment_impact',{p_rule_id:req.params.id,p_actor_id:req.user.id});
    if(error)return sendError(res,error);return res.json({success:true,impact:data});
  },
  completeTreatment: async (req,res) => {
    const {data,error}=await supabase.rpc('complete_factory_treatment',{p_rule_id:req.params.id,p_holiday_salary_days:req.body.holiday_salary_days,p_reason:req.body.reason,p_actor_id:req.user.id});
    if(error)return sendError(res,error);return res.status(201).json({success:true,treatment:data});
  },
  calculationImpact: async (req,res) => {
    const {data,error}=await supabase.rpc('factory_calculation_impact',{p_rule_id:req.params.id,p_actor_id:req.user.id});
    if(error)return sendError(res,error);
    return res.json({success:true,impact:data});
  },
  completeCalculation: async (req,res) => {
    const {data,error}=await supabase.rpc('complete_factory_calculation',{p_rule_id:req.params.id,p_salary_days:req.body.salary_days,p_reason:req.body.reason,p_actor_id:req.user.id});
    if(error)return sendError(res,error);
    return res.status(201).json({success:true,calculation:data});
  }
};
