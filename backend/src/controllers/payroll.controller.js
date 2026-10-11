const { supabase } = require('../db/supabase');
function sendError(res, error) {
  const code = error?.code;
  if (code === '42501') return res.status(403).json({ success: false, code: 'PAYROLL_ACCESS_DENIED', message: error.message });
  if (code === 'P0002') return res.status(404).json({ success: false, code: 'PAYROLL_NOT_FOUND', message: error.message });
  if (['23505', '23P01', '40001', 'PY409'].includes(code)) return res.status(409).json({ success: false, code: 'PAYROLL_CONFLICT', message: error.message });
  if (['23503', '23514', '23502', '22023', '22007', '22008', '22P02', '22003'].includes(code)) return res.status(400).json({ success: false, code: 'INVALID_PAYROLL_SOURCE', message: error.message });
  console.error('Payroll foundation operation failed:', code);
  return res.status(500).json({ success: false, message: 'Payroll foundation operation failed.' });
}
const rpc = (name, params, key, status = 200) => async (req, res) => {
  try {
    const { data, error } = await supabase.rpc(name, { ...params(req), p_actor_id: req.user.id });
    if (error) return sendError(res, error);
    return res.status(status).json({ success: true, [key]: data });
  } catch (error) { return sendError(res, error); }
};
module.exports = {
  context: rpc('get_payroll_foundation_context', () => ({}), 'context'),
  setScope: rpc('set_payroll_factory_scope', req => ({ p_user_id: req.body.user_id, p_department: req.body.department, p_allowed: req.body.allowed, p_reason: req.body.reason }), 'scope_event', 201),
  recordHistory: rpc('record_payroll_source_history', req => ({ p_employee_id: req.body.employee_id, p_kind: req.body.kind, p_intervals: req.body.intervals, p_evidence: req.body.evidence_reference }), 'revision_id', 201),
  sourceHistory: rpc('get_payroll_source_history', req => ({ p_employee_id: req.params.employeeId }), 'history'),
  createRun: rpc('create_payroll_draft_run', req => ({ p_group_code: req.body.group_code, p_department: req.body.department, p_from: req.body.period_from, p_to: req.body.period_to, p_cycle: req.body.cycle }), 'run', 201),
  detail: rpc('get_payroll_draft_run', req => ({ p_run_id: req.params.runId, p_page: req.query.page, p_limit: req.query.limit }), 'draft'),
  candidates: rpc('get_payroll_draft_candidates', req => ({ p_run_id: req.params.runId, p_page: req.query.page, p_limit: req.query.limit }), 'selection'),
  addEmployee: rpc('add_payroll_draft_employee', req => ({ p_run_id: req.params.runId, p_assignment_id: req.body.assignment_id, p_from: req.body.period_from, p_to: req.body.period_to }), 'row', 201),
  reviseNote: rpc('revise_payroll_draft_note', req => ({ p_row_id: req.params.rowId, p_expected_version: req.body.expected_version, p_note: req.body.note }), 'row'),
  sendError
};
