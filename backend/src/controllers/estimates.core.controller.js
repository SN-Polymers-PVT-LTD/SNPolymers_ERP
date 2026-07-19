const { supabase } = require('../db/supabase');
const ESTIMATE_STATUS = require('../constants/estimate-status');
const validate = require('../validation/validate');
const { createEstimateSchema } = require('../validation/estimate.schema');
const {
  getEstimateById: getEstimateByIdHelper,
  getEffectiveRole,
  canViewEstimate,
  resolveDisplayNames,
  ZO_VISIBLE_STATUSES,
  HO_ACTIVE_STATUSES,
  HO_HISTORY_STATUSES,
  uuidRegex
} = require('./estimates.helpers');

/**
 * POST /api/v1/auth/estimates
 * Creates a new estimate header (Draft).
 */
async function createEstimate(req, res) {
  if (!validate(req, res, createEstimateSchema)) return;
  const { work_order_no, zonal_office_no, je_remarks } = req.body;
  const final_zonal_office_no = zonal_office_no ? zonal_office_no.trim() : 'N/A';

  try {
    const { data: project, error: projectError } = await supabase
      .from('projects_master')
      .select('*')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (projectError) throw projectError;

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    if (project.status === 'Closed') {
      return res.status(403).json({ success: false, message: 'Cannot create estimates for Closed projects.' });
    }

    // Restrict JE to only mapped work orders
    const effectiveRole = getEffectiveRole(req.user.role);
    if (effectiveRole === 'je') {
      const { data: mappedWO, error: mapError } = await supabase
        .from('work_order_mappings')
        .select('id')
        .eq('je_user_id', req.user.mobile_number)
        .eq('work_order_no', work_order_no)
        .eq('is_active', true)
        .maybeSingle();

      if (mapError) throw mapError;
      if (!mappedWO) {
        return res.status(403).json({ success: false, message: 'You are not assigned to this Work Order.' });
      }
    }

    const { data: activeEstimates, error: activeError } = await supabase
      .from('project_cost_estimates')
      .select('estimate_id')
      .eq('work_order_no', work_order_no)
      .not('estimate_status', 'in', `("${ESTIMATE_STATUS.REJECTED_BY_ZO}","${ESTIMATE_STATUS.REJECTED_BY_HO}")`);

    if (activeError) throw activeError;

    if (activeEstimates && activeEstimates.length > 0) {
      return res.status(409).json({ success: false, message: 'An estimate already exists for the selected Work Order.' });
    }

    const { data: newEstimate, error: insertError } = await supabase
      .from('project_cost_estimates')
      .insert([
        {
          work_order_no,
          estimate_no: project.estimate_no,
          area_code: project.zone,
          estimate_revision: 0,
          zonal_office_no: final_zonal_office_no,
          estimate_amount: 0,
          estimate_status: ESTIMATE_STATUS.DRAFT,
          je_remarks: je_remarks || null,
          created_by: req.user.mobile_number,
          last_modified_by: req.user.mobile_number
        }
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    return res.status(201).json({
      success: true,
      estimate: newEstimate,
      message: 'Cost estimate created successfully.'
    });

  } catch (error) {
    console.error(`createEstimate failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create cost estimate.' });
  }
}

/**
 * GET /api/v1/auth/estimates
 * Role-filtered cost estimates list view.
 */
async function getEstimates(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 50;
    if (limit < 1) limit = 50;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    const effectiveRole = getEffectiveRole(req.user.role);
    let dbQuery = supabase
      .from('project_cost_estimates')
      .select('*, projects_master(*)', { count: 'exact' });

    if (process.env.IDBP_FILTER_TEST_DATA === 'true' && process.env.NODE_ENV !== 'test') {
      dbQuery = dbQuery
        .not('work_order_no', 'like', 'TEST_%')
        .not('estimate_no', 'like', 'EST_%');
    }

    if (effectiveRole === 'je') {
      const { data: mappedWOs, error: mapError } = await supabase
        .from('work_order_mappings')
        .select('work_order_no')
        .eq('je_user_id', req.user.mobile_number)
        .eq('is_active', true);

      if (mapError) throw mapError;
      const woNos = (mappedWOs || []).map(m => m.work_order_no);
      dbQuery = dbQuery.in('work_order_no', woNos.length > 0 ? woNos : ['dummy_wo_no']);
    }

    if (effectiveRole === 'zo') {
      const { data: mappedJEs, error: jeMapErr } = await supabase
        .from('je_zo_mappings')
        .select('je_user_id')
        .eq('zo_user_id', req.user.mobile_number)
        .eq('is_active', true);

      if (jeMapErr) throw jeMapErr;
      const jeIds = (mappedJEs || []).map(m => m.je_user_id);

      if (jeIds.length > 0) {
        const { data: mappedWOs, error: woMapErr } = await supabase
          .from('work_order_mappings')
          .select('work_order_no')
          .in('je_user_id', jeIds)
          .eq('is_active', true);

        if (woMapErr) throw woMapErr;
        const woNos = (mappedWOs || []).map(m => m.work_order_no);
        dbQuery = dbQuery.in('work_order_no', woNos.length > 0 ? woNos : ['dummy_wo_no']);
      } else {
        dbQuery = dbQuery.in('work_order_no', ['dummy_wo_no']);
      }
    }

    if (query.status) {
      dbQuery = dbQuery.eq('estimate_status', query.status);
    }

    const { data: estimates, count, error } = await dbQuery
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const estimateIds = (estimates || []).map(e => e.estimate_id);
    let deadlinesMap = {};

    if (estimateIds.length > 0) {
      const { data: logs, error: logsError } = await supabase
        .from('estimate_revision_log')
        .select('estimate_id, revision_deadline, is_auto_resubmitted')
        .in('estimate_id', estimateIds)
        .is('resubmitted_at', null)
        .order('created_at', { ascending: false });

      if (!logsError && logs) {
        logs.forEach(log => {
          if (!deadlinesMap[log.estimate_id]) {
            deadlinesMap[log.estimate_id] = log;
          }
        });
      }
    }

    const enrichedEstimates = (estimates || []).map(est => {
      const log = deadlinesMap[est.estimate_id];
      const deadline = log ? log.revision_deadline : null;
      const isOverdue = deadline ? new Date() > new Date(deadline) : false;
      return {
        ...est,
        active_revision_deadline: deadline,
        is_deadline_overdue: isOverdue
      };
    });

    return res.status(200).json({
      success: true,
      estimates: enrichedEstimates,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error(`getEstimates failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve cost estimates.' });
  }
}

/**
 * GET /api/v1/auth/estimates/:id
 * Single cost estimate retrieval with detail fields, summary, and name resolution.
 */
async function getEstimateById(req, res) {
  const { id } = req.params;

  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid UUID format.' });
  }

  try {
    const estimate = await getEstimateByIdHelper(id, '*, projects_master(*)');
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    const isAuthorized = await canViewEstimate(estimate, req.user);
    if (!isAuthorized) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    const { data: items, error: itemsError } = await supabase
      .from('project_cost_estimate_items')
      .select('*, purchase_data(name)')
      .eq('estimate_id', id)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    const { data: log, error: logError } = await supabase
      .from('estimate_revision_log')
      .select('revision_deadline, is_auto_resubmitted')
      .eq('estimate_id', id)
      .is('resubmitted_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const active_revision_deadline = log ? log.revision_deadline : null;
    const is_deadline_overdue = active_revision_deadline ? new Date() > new Date(active_revision_deadline) : false;

    const userMap = await resolveDisplayNames([
      estimate.je_user_id,
      estimate.zo_approved_by,
      estimate.ho_approved_by
    ]);

    const je_name = userMap[estimate.je_user_id] || estimate.je_user_id || null;
    const zo_name = userMap[estimate.zo_approved_by] || estimate.zo_approved_by || null;
    const ho_name = userMap[estimate.ho_approved_by] || estimate.ho_approved_by || null;

    let gross_labour_cost = 0;
    let gross_transport_cost = 0;
    let gross_misc_cost = 0;
    let gross_material_cost = 0;
    let gross_total = 0;

    (items || []).forEach(item => {
      const amt = Number(item.amount) || 0;
      gross_total += amt;
      if (item.material_main_head === 'Labour') {
        gross_labour_cost += amt;
      } else if (item.material_main_head === 'Transport') {
        gross_transport_cost += amt;
      } else if (item.material_main_head === 'Miscellaneous') {
        gross_misc_cost += amt;
      } else {
        gross_material_cost += amt;
      }
    });

    const summary = {
      gross_material_cost: Number(gross_material_cost.toFixed(2)),
      gross_labour_cost: Number(gross_labour_cost.toFixed(2)),
      gross_transport_cost: Number(gross_transport_cost.toFixed(2)),
      gross_misc_cost: Number(gross_misc_cost.toFixed(2)),
      gross_total: Number(gross_total.toFixed(2)),
      approved_grand_total: Number((Number(estimate.estimate_amount) || 0).toFixed(2))
    };

    const enrichedEstimate = {
      ...estimate,
      je_name,
      zo_name,
      ho_name,
      active_revision_deadline,
      is_deadline_overdue
    };

    return res.status(200).json({
      success: true,
      estimate: enrichedEstimate,
      items: items || [],
      summary
    });

  } catch (error) {
    console.error(`getEstimateById failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve cost estimate details.' });
  }
}

async function getEstimateInitData(req, res) {
  try {
    // Fetch running projects and active estimates in parallel
    const [
      { data: runningProjects, error: projError },
      { data: activeEstimates, error: activeError }
    ] = await Promise.all([
      supabase.from('projects_master').select('*').neq('status', 'Closed'),
      supabase.from('project_cost_estimates').select('work_order_no').not('estimate_status', 'in', '("Rejected by ZO","Rejected by HO")')
    ]);

    if (projError) throw projError;
    if (activeError) throw activeError;

    // Fetch JE mappings to restrict dropdown list if role is JE
    let allowedWOs = null;
    const effectiveRole = getEffectiveRole(req.user.role);
    if (effectiveRole === 'je') {
      const { data: mappedWOs, error: mapError } = await supabase
        .from('work_order_mappings')
        .select('work_order_no')
        .eq('je_user_id', req.user.mobile_number)
        .eq('is_active', true);
      if (mapError) throw mapError;
      allowedWOs = new Set((mappedWOs || []).map(m => m.work_order_no));
    }

    const blockedWorkOrders = new Set((activeEstimates || []).map(e => e.work_order_no));

    const availableWorkOrders = (runningProjects || []).filter(p => {
      if (blockedWorkOrders.has(p.work_order_no)) return false;
      if (allowedWOs !== null) {
        return allowedWOs.has(p.work_order_no);
      }
      return true;
    });

    return res.status(200).json({
      success: true,
      availableWorkOrders
    });
  } catch (error) {
    console.error(`getEstimateInitData failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to initialize estimate data.' });
  }
}

module.exports = {
  createEstimate,
  getEstimates,
  getEstimateById,
  getEstimateInitData
};
