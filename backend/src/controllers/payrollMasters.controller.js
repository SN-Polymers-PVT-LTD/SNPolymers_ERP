const { supabase } = require('../db/supabase');
const { sendError } = require('./payroll.controller');
const { validateMaster } = require('../domain/payrollMasters');
const rpc = (name, params, status = 200) => async (req,res) => {
 try { const { data, error } = await supabase.rpc(name, { p_kind: req.params.kind, p_actor_id: req.user.id, ...params(req) });
  if (error) return sendError(res,error); return res.status(status).json({ success: true, result: data });
 } catch (error) { return sendError(res,error); }
};
module.exports = {
 list: rpc('get_payroll_master_revisions', req => ({ p_page: req.query.page, p_limit: req.query.limit })),
 save: async (req,res) => {
  const validation = validateMaster(req.params.kind,req.body.data);
  if (!validation.valid) return res.status(400).json({ success: false, message: 'Invalid master configuration.', issues: validation.issues });
  req.body.data = validation.data;
  return rpc('save_payroll_master_draft', r => ({ p_id: r.body.id, p_expected_version: r.body.expected_version, p_data: r.body.data }),201)(req,res);
 },
 preview: rpc('preview_payroll_master_publication', req => ({ p_id: req.params.id })),
 publish: rpc('publish_payroll_master', req => ({ p_id: req.params.id, p_expected_version: req.body.expected_version, p_preview_token: req.body.preview_token, p_approval_reference: req.body.approval_reference })),
 resolve: rpc('resolve_payroll_master', req => ({ p_scope: Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== 'date')), p_date: req.query.date }))
};
