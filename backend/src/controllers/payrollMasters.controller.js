const { supabase } = require('../db/supabase');
const { sendError } = require('./payroll.controller');
const { defaultEsiWageBasis } = require('../validation/payrollMasters.schema');
const { validateMaster } = require('../domain/payrollMasters');
const rpc = (name, params, status = 200) => async (req,res) => {
 try { const { data, error } = await supabase.rpc(name, { p_kind: req.params.kind, p_actor_id: req.user.id, ...params(req) });
  if (error) return sendError(res,error);
  if (name === 'get_payroll_master_revisions' && data?.events?.length) {
   const actorIds = [...new Set(data.events.map(event => event.actor_id).filter(Boolean))];
   if (actorIds.length) {
    const { data: actors, error: actorError } = await supabase.from('authorised_users')
     .select('id,display_name,role').in('id', actorIds);
    if (actorError) console.warn('[PAYROLL MASTER] Audit actor lookup failed:', actorError.code);
    const byId = new Map((actors || []).map(actor => [actor.id, actor]));
    data.events = data.events.map(event => {
     const actor = byId.get(event.actor_id);
     return { ...event, actor_display_name: actor?.display_name?.trim() || actor?.role?.toUpperCase() || null };
    });
   }
  }
  return res.status(status).json({ success: true, result: data });
 } catch (error) { return sendError(res,error); }
};
module.exports = {
 list: rpc('get_payroll_master_revisions', req => ({ p_page: req.query.page, p_limit: req.query.limit })),
 save: async (req,res) => {
  const input = req.params.kind === 'statutory' ? { ...req.body.data, verification_status: 'ACCOUNTS_CONFIRMED', advisor_name: req.user.id, verification_reference: req.body.data?.reason, verified_on: new Date().toISOString().slice(0,10) } : req.body.data;
  // PostgreSQL replaces these provisional fields with its authenticated actor and clock.
  const validation = validateMaster(req.params.kind, req.params.kind === 'statutory' ? defaultEsiWageBasis(input) : input);
  if (!validation.valid) return res.status(400).json({ success: false, message: 'Invalid master configuration.', issues: validation.issues });
  req.body.data = validation.data;
  return rpc('save_payroll_master_draft', r => ({ p_id: r.body.id, p_expected_version: r.body.expected_version, p_data: r.body.data }),201)(req,res);
 },
 preview: (req,res) => rpc(req.query.initial_setup === 'true' ? 'preview_payroll_initial_master' : 'preview_payroll_master_publication', r => ({ p_id: r.params.id }))(req,res),
 publish: (req,res) => rpc(req.body.initial_setup === true ? 'publish_payroll_initial_master' : 'publish_payroll_master', r => ({ p_id: r.params.id, p_expected_version: r.body.expected_version, p_preview_token: r.body.preview_token, p_approval_reference: r.body.approval_reference || null }))(req,res),
 resolve: rpc('resolve_payroll_master', req => ({ p_scope: Object.fromEntries(Object.entries(req.query).filter(([key]) => key !== 'date')), p_date: req.query.date }))
};
