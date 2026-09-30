const { supabase } = require('../db/supabase');

function sendError(res, error) {
  if (error?.code === '23505') return res.status(409).json({ success: false, code: 'REVISION_DATE_CONFLICT', message: 'A revision already exists for this category and effective date.' });
  if (error?.code === '42501') return res.status(403).json({ success: false, message: 'Factory access denied.' });
  if (['23514', '23503', '22003'].includes(error?.code)) return res.status(400).json({ success: false, message: 'Invalid factory master values.' });
  console.error('Factory master operation failed:', error);
  return res.status(500).json({ success: false, message: 'Factory master operation failed.' });
}

function list(table) {
  return async (req, res) => {
    const { employee_category, as_of, page, limit } = req.query;
    let query = supabase.from(table).select('*', { count: 'exact' });
    if (employee_category) query = query.eq('employee_category', employee_category);
    // Resolve current IDs independently of pagination; future dates never displace them.
    const categories = employee_category ? [employee_category] : table === 'hr_factory_wage_revisions'
      ? ['SNP Casual Factory Labour', 'Local Daily-Wage Workers']
      : ['Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour', 'SNP Casual Factory Labour', 'Local Daily-Wage Workers'];
    const [rows, ...resolved] = await Promise.all([
      query.order('effective_from', { ascending: false }).order('id').range((page - 1) * limit, page * limit - 1),
      ...categories.map(category => supabase.from(table).select('id,employee_category').eq('employee_category', category)
        .lte('effective_from', as_of).order('effective_from', { ascending: false }).limit(1).maybeSingle())
    ]);
    const { data, count, error } = rows;
    const failure = error || resolved.find(result => result.error)?.error;
    if (failure) return sendError(res, failure);
    const ids = new Map(resolved.filter(result => result.data).map(result => [result.data.employee_category, result.data.id]));
    return res.json({ success: true, revisions: (data || []).map(row => ({ ...row,
      display_status: row.effective_from > as_of ? 'Future' : ids.get(row.employee_category) === row.id ? 'Current' : 'Historical'
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
  const { employee_category, date } = req.query;
  const tables = ['hr_factory_wage_revisions', 'hr_factory_pay_rule_revisions'];
  const results = await Promise.all(tables.map(table => supabase.from(table).select('*')
    .eq('employee_category', employee_category).lte('effective_from', date)
    .order('effective_from', { ascending: false }).limit(1).maybeSingle()));
  const error = results.find(result => result.error)?.error;
  if (error) return sendError(res, error);
  return res.json({ success: true, date, employee_category, wage_revision: results[0].data, rule_revision: results[1].data });
}
module.exports = {
  listWages: list('hr_factory_wage_revisions'), createWage: create('hr_factory_wage_revisions'),
  listRules: list('hr_factory_pay_rule_revisions'), createRule: create('hr_factory_pay_rule_revisions'), effective
};
