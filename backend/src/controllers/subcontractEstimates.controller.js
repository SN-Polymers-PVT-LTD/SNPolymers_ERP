const { supabase } = require('../db/supabase');

const readerRoles = ['je', 'zo', 'ho', 'admin'];
const isUuid = (value) => /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(value);

async function visibleWorkOrders(user) {
  if (user.role === 'admin' || user.role === 'ho') return null;
  if (user.role === 'je') {
    const { data, error } = await supabase.from('work_order_mappings').select('work_order_no').eq('je_user_id', user.mobile_number).eq('is_active', true);
    if (error) throw error;
    return (data || []).map(row => row.work_order_no);
  }
  const { data: jeRows, error: jeError } = await supabase.from('je_zo_mappings').select('je_user_id').eq('zo_user_id', user.mobile_number).eq('is_active', true);
  if (jeError) throw jeError;
  const jeIds = (jeRows || []).map(row => row.je_user_id);
  if (!jeIds.length) return [];
  const { data, error } = await supabase.from('work_order_mappings').select('work_order_no').in('je_user_id', jeIds).eq('is_active', true);
  if (error) throw error;
  return [...new Set((data || []).map(row => row.work_order_no))];
}

async function canAccessEstimate(estimate, user, write = false) {
  if (user.role === 'admin') return true;
  if (user.role === 'ho') return !write;
  const allowed = await visibleWorkOrders(user);
  return allowed === null || allowed.includes(estimate.work_order_no);
}

const detailSelect = `*, project_subcontract_estimate_lines:project_subcontract_estimate_lines(*, subcontractor:subcontractor_master(id, subcontractor_name, mobile, email, is_active), subcontract_work:subcontract_work_master(id, sub_head, material_details, unit, is_active)), project_subcontract_estimate_workflow_log(*)`;

async function getSubcontractEstimates(req, res) {
  try {
    const page = Number(req.query.page || 1);
    const limit = Number(req.query.limit || 20);
    const allowed = await visibleWorkOrders(req.user);
    let query = supabase.from('project_subcontract_estimates').select('*, projects_master(work_order_no, status, site_details)', { count: 'exact' }).order('updated_at', { ascending: false });
    if (allowed !== null) query = query.in('work_order_no', allowed.length ? allowed : ['__none__']);
    if (req.query.status) query = query.eq('estimate_status', req.query.status);
    const { data, count, error } = await query.range((page - 1) * limit, page * limit - 1);
    if (error) throw error;
    return res.json({ success: true, estimates: data || [], pagination: { page, limit, totalItems: count || 0, totalPages: Math.max(1, Math.ceil((count || 0) / limit)) } });
  } catch (error) {
    console.error(`getSubcontractEstimates failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontract estimates.' });
  }
}

async function getSubcontractEstimateSummary(req, res) {
  try {
    const allowed = await visibleWorkOrders(req.user);
    let query = supabase.from('project_subcontract_estimates').select('estimate_status, estimate_amount');
    if (allowed !== null) query = query.in('work_order_no', allowed.length ? allowed : ['__none__']);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];
    return res.json({ success: true, summary: { total: rows.length, draft: rows.filter(row => row.estimate_status === 'Draft').length, totalAmount: rows.reduce((sum, row) => sum + Number(row.estimate_amount || 0), 0) } });
  } catch (error) {
    console.error(`getSubcontractEstimateSummary failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontract estimate summary.' });
  }
}

async function getInit(req, res) {
  try {
    const allowed = await visibleWorkOrders(req.user);
    let query = supabase.from('projects_master').select('work_order_no, estimate_no, site_details, status, zone').neq('status', 'Closed');
    if (allowed !== null) query = query.in('work_order_no', allowed.length ? allowed : ['__none__']);
    const { data: projects, error } = await query.order('work_order_no', { ascending: true });
    if (error) throw error;
    const { data: active, error: activeError } = await supabase.from('project_subcontract_estimates').select('work_order_no').not('estimate_status', 'in', '("Rejected by ZO","Rejected by HO")');
    if (activeError) throw activeError;
    const { data: approvedLines, error: approvedLinesError } = await supabase.from('project_subcontract_estimate_lines').select('subcontract_estimate_id').not('final_approved_revision', 'is', null);
    if (approvedLinesError) throw approvedLinesError;
    const approvedEstimateIds = [...new Set((approvedLines || []).map(row => row.subcontract_estimate_id))];
    const { data: approvedHistory, error: approvedHistoryError } = approvedEstimateIds.length
      ? await supabase.from('project_subcontract_estimates').select('work_order_no').in('subcontract_estimate_id', approvedEstimateIds)
      : { data: [], error: null };
    if (approvedHistoryError) throw approvedHistoryError;
    const blocked = new Set([...(active || []), ...(approvedHistory || [])].map(row => row.work_order_no));
    return res.json({ success: true, availableWorkOrders: (projects || []).filter(row => !blocked.has(row.work_order_no)) });
  } catch (error) {
    console.error(`getSubcontractEstimateInit failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to initialize subcontract estimate data.' });
  }
}

async function createSubcontractEstimate(req, res) {
  const { work_order_no, remarks = null } = req.body;
  try {
    const { data: project, error: projectError } = await supabase.from('projects_master').select('work_order_no, status').eq('work_order_no', work_order_no).maybeSingle();
    if (projectError) throw projectError;
    if (!project) return res.status(404).json({ success: false, message: 'Work Order not found.' });
    if (project.status === 'Closed') return res.status(403).json({ success: false, message: 'Cannot create estimates for Closed projects.' });
    const allowed = await visibleWorkOrders(req.user);
    if (allowed !== null && !allowed.includes(work_order_no)) return res.status(403).json({ success: false, message: 'You are not assigned to this Work Order.' });
    const { data, error } = await supabase.from('project_subcontract_estimates').insert({ work_order_no, estimate_status: 'Draft', estimate_revision: 0, estimate_amount: 0, je_remarks: remarks, created_by: req.user.mobile_number, last_modified_by: req.user.mobile_number }).select().single();
    if (error) {
      if (error.code === '23505' || error.code === 'P4B58') return res.status(409).json({ success: false, message: error.message || 'A subcontract estimate lineage already exists for this Work Order.', code: error.code });
      throw error;
    }
    return res.status(201).json({ success: true, estimate: data, message: 'Subcontract estimate created successfully.' });
  } catch (error) {
    console.error(`createSubcontractEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create subcontract estimate.' });
  }
}

async function getSubcontractEstimate(req, res) {
  if (!isUuid(req.params.id)) return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  try {
    const { data, error } = await supabase.from('project_subcontract_estimates').select(detailSelect).eq('subcontract_estimate_id', req.params.id).maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ success: false, message: 'Subcontract estimate not found.' });
    if (!(await canAccessEstimate(data, req.user))) return res.status(403).json({ success: false, message: 'Access denied.' });
    return res.json({ success: true, estimate: data });
  } catch (error) {
    console.error(`getSubcontractEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve subcontract estimate.' });
  }
}

async function transitionWorkflow(req, res) {
  try {
    const { action, remarks, expected_updated_at, deadline_hours } = req.body;
    if (action === 'REOPEN' || action === 'SUBMIT_REOPENED') {
      const rpcName = action === 'REOPEN' ? 'reopen_subcontract_estimate' : 'submit_reopened_subcontract_estimate';
      const rpcParams = action === 'REOPEN' ? {
        p_estimate_id: req.params.id,
        p_actor: req.user.mobile_number,
        p_remarks: remarks || null,
        p_expected_updated_at: expected_updated_at
      } : {
        p_estimate_id: req.params.id,
        p_actor: req.user.mobile_number,
        p_expected_updated_at: expected_updated_at
      };
      const { error } = await supabase.rpc(rpcName, rpcParams);
      if (action === 'SUBMIT_REOPENED') {
        if (error) {
          const code = error.code || '';
          if (code === 'P4B54') return res.status(409).json({ success: false, message: 'Estimate changed since it was loaded. Reload and try again.' });
          if (['P4B52', 'P4B55', 'P4B56'].includes(code)) return res.status(403).json({ success: false, message: error.message });
          if (['P4B53', 'P4B57'].includes(code)) return res.status(422).json({ success: false, message: error.message, code });
          throw error;
        }
        const { data: submitted, error: submittedReadError } = await supabase.from('project_subcontract_estimates').select(detailSelect).eq('subcontract_estimate_id', req.params.id).single();
        if (submittedReadError) throw submittedReadError;
        return res.json({ success: true, estimate: submitted, message: 'Estimate revision submitted successfully.' });
      }
      if (error) {
        const code = error.code || '';
        if (code === 'P4B33') return res.status(409).json({ success: false, message: 'Estimate changed since it was loaded. Reload and try again.' });
        if (['P4B30', 'P4B32', 'P4B34'].includes(code)) return res.status(422).json({ success: false, message: error.message, code });
        if (code === 'P4B31') return res.status(403).json({ success: false, message: error.message });
        throw error;
      }
      const { data: reopened, error: readError } = await supabase.from('project_subcontract_estimates').select(detailSelect).eq('subcontract_estimate_id', req.params.id).single();
      if (readError) throw readError;
      return res.json({ success: true, estimate: reopened, message: 'Estimate reopened successfully.' });
    }
    const { error } = await supabase.rpc('transition_subcontract_estimate_workflow', {
      p_estimate_id: req.params.id,
      p_actor: req.user.mobile_number,
      p_action: action,
      p_remarks: remarks || null,
      p_expected_updated_at: expected_updated_at,
      p_deadline_hours: deadline_hours || 24
    });
    if (error) {
      const code = error.code || '';
      if (code === 'P4B13') return res.status(409).json({ success: false, message: 'Estimate changed since it was loaded. Reload and try again.' });
      if (['P4B11', 'P4B14', 'P4B15'].includes(code)) return res.status(403).json({ success: false, message: error.message });
      if (['P4B10', 'P4B16', 'P4B17', 'P4B18', 'P4B29'].includes(code)) return res.status(422).json({ success: false, message: error.message, code });
      throw error;
    }
    const { data: estimate, error: readError } = await supabase.from('project_subcontract_estimates').select(detailSelect).eq('subcontract_estimate_id', req.params.id).single();
    if (readError) throw readError;
    return res.json({ success: true, estimate, message: 'Workflow action completed successfully.' });
  } catch (error) {
    console.error(`transitionSubcontractEstimateWorkflow failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to transition subcontract estimate workflow.' });
  }
}

async function reconcileLines(req, res) {
  try {
    const { error } = await supabase.rpc('reconcile_subcontract_estimate_lines', {
      p_estimate_id: req.params.id,
      p_actor: req.user.mobile_number,
      p_expected_updated_at: req.body.expected_updated_at,
      p_lines: req.body.lines
    });
    if (error) {
      const code = error.code || '';
      if (code === 'P4B43') return res.status(409).json({ success: false, message: 'Estimate changed since it was loaded. Reload and try again.' });
      if (['P4B41', 'P4B44', 'P4B45'].includes(code)) return res.status(403).json({ success: false, message: error.message });
      if (['P4B40', 'P4B42', 'P4B46', 'P4B47', 'P4B48', 'P4B49', 'P4B50', 'P4B51', 'P4B52'].includes(code)) return res.status(422).json({ success: false, message: error.message, code });
      throw error;
    }
    const { data: estimate, error: readError } = await supabase.from('project_subcontract_estimates').select(detailSelect).eq('subcontract_estimate_id', req.params.id).single();
    if (readError) throw readError;
    return res.json({ success: true, estimate, message: 'Estimate lines saved successfully.' });
  } catch (error) {
    console.error(`reconcileSubcontractEstimateLines failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save subcontract estimate lines.' });
  }
}

async function reviewRows(req, res) {
  try {
    const { stage, approvals, expected_updated_at } = req.body;
    const { error } = await supabase.rpc('review_subcontract_estimate_rows', {
      p_estimate_id: req.params.id,
      p_actor: req.user.mobile_number,
      p_stage: stage,
      p_approvals: approvals,
      p_expected_updated_at: expected_updated_at
    });
    if (error) {
      const code = error.code || '';
      if (code === 'P4B23') return res.status(409).json({ success: false, message: 'Estimate changed since it was loaded. Reload and try again.' });
      if (['P4B21', 'P4B24', 'P4B25'].includes(code)) return res.status(403).json({ success: false, message: error.message });
      if (['P4B20', 'P4B22', 'P4B26', 'P4B27', 'P4B28'].includes(code)) return res.status(422).json({ success: false, message: error.message, code });
      throw error;
    }
    const { data: estimate, error: readError } = await supabase.from('project_subcontract_estimates').select(detailSelect).eq('subcontract_estimate_id', req.params.id).single();
    if (readError) throw readError;
    return res.json({ success: true, estimate, message: 'Row decisions saved successfully.' });
  } catch (error) {
    console.error(`reviewSubcontractEstimateRows failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save subcontract estimate row decisions.' });
  }
}

module.exports = { getSubcontractEstimates, getSubcontractEstimateSummary, getInit, createSubcontractEstimate, getSubcontractEstimate, reconcileLines, transitionWorkflow, reviewRows, readerRoles };
