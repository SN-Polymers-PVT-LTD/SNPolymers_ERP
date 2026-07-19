const { supabase } = require('../db/supabase');

/**
 * Helper: Enrich audit logs with acting users' display names
 */
async function enrichAuditsWithUserNames(logs) {
  if (!logs || logs.length === 0) return [];
  const userIds = [...new Set(logs.map(log => log.user_id).filter(Boolean))];
  if (userIds.length === 0) {
    return logs.map(log => ({ ...log, user_name: log.user_id || 'System' }));
  }

  const { data: users, error } = await supabase
    .from('authorised_users')
    .select('mobile_number, display_name')
    .in('mobile_number', userIds);

  const userMap = {};
  if (!error && users) {
    users.forEach(u => {
      userMap[u.mobile_number] = u.display_name;
    });
  }

  return logs.map(log => ({
    ...log,
    user_name: userMap[log.user_id] || log.user_id || 'System'
  }));
}

/**
 * GET /api/v1/auth/analytics/ho/kpis
 * Returns top-level HO executive dashboard KPIs and status distributions
 */
async function getHoKpis(req, res) {
  try {
    const { data: kpiData, error: kpiError } = await supabase
      .from('executive_kpi_mv')
      .select('*')
      .single();

    if (kpiError) throw kpiError;

    const { data: statusCounts, error: statusError } = await supabase
      .from('project_health_mv')
      .select('health_status');

    if (statusError) throw statusError;

    const healthDistribution = { Healthy: 0, Warning: 0, Critical: 0 };
    if (statusCounts) {
      statusCounts.forEach(p => {
        if (healthDistribution[p.health_status] !== undefined) {
          healthDistribution[p.health_status]++;
        }
      });
    }

    return res.status(200).json({
      success: true,
      kpis: kpiData,
      healthDistribution
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoKpis:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching KPIs.' });
  }
}

/**
 * GET /api/v1/auth/analytics/ho/resource-utilization
 * Returns the resource utilization list for JEs (streak days, reports submitted)
 */
async function getHoResourceUtilization(req, res) {
  try {
    const { data, error } = await supabase
      .from('resource_utilization_mv')
      .select('*')
      .order('streak_days', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoResourceUtilization:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching resource utilization.' });
  }
}

/**
 * GET /api/v1/auth/analytics/ho/approval-sla
 * Returns SLA logs of estimates, requisitions, and fund requests
 */
async function getHoApprovalSla(req, res) {
  try {
    const { data, error } = await supabase
      .from('approval_sla_mv')
      .select('*')
      .order('submitted_at', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoApprovalSla:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching approval SLA records.' });
  }
}

/**
 * GET /api/v1/auth/analytics/ho/zone-benchmarking
 * Returns cumulative project performance across zones
 */
async function getHoZoneBenchmarking(req, res) {
  try {
    const { data, error } = await supabase
      .from('zone_performance_mv')
      .select('*')
      .order('zone', { ascending: true });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoZoneBenchmarking:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching zone benchmarking records.' });
  }
}

/**
 * GET /api/v1/auth/analytics/ho/budget-leakage
 * Returns anomaly metrics where budget or timeline parameters are compromised
 */
async function getHoBudgetLeakage(req, res) {
  try {
    const { data, error } = await supabase
      .from('budget_leakage_mv')
      .select('*')
      .gt('anomaly_score', 0)
      .order('anomaly_score', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoBudgetLeakage:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching budget leakage anomalies.' });
  }
}

/**
 * GET /api/v1/auth/analytics/zo/productivity
 * Returns productivity metrics for JEs within the ZO's zone
 */
async function getZoProductivity(req, res) {
  try {
    let query = supabase.from('resource_utilization_mv').select('*');

    if (req.user.role === 'zo') {
      query = query.eq('zo_user_id', req.user.mobile_number);
    } else if (req.query.zo_user_id) {
      query = query.eq('zo_user_id', req.query.zo_user_id);
    }

    const { data, error } = await query.order('streak_days', { ascending: false });

    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getZoProductivity:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching ZO productivity.' });
  }
}

/**
 * GET /api/v1/auth/analytics/recent-activity
 * Returns audit logs isolated to ZO bounds for ZO users, or global activity for HO
 */
async function getRecentActivity(req, res) {
  try {
    if (req.user.role === 'zo') {
      const zoMobile = req.user.mobile_number;

      // 1. Fetch all work_order_no owned by this ZO
      const { data: woData, error: woError } = await supabase
        .from('projects_master')
        .select('work_order_no')
        .eq('zo_user_id', zoMobile);

      if (woError) throw woError;

      const woList = (woData || []).map(w => w.work_order_no);
      if (woList.length === 0) {
        return res.status(200).json({ success: true, activities: [] });
      }

      // 2. Fetch linked entity IDs in parallel to resolve indirect audits
      const [estimatesRes, requisitionsRes, progressRes, fundRequestsRes] = await Promise.all([
        supabase.from('project_cost_estimates').select('estimate_id').in('work_order_no', woList),
        supabase.from('requisitions').select('requisition_id').in('work_order_no', woList),
        supabase.from('daily_progress_reports').select('report_id').in('work_order_no', woList),
        supabase.from('fund_requests').select('fund_request_id').in('work_order_no', woList)
      ]);

      if (estimatesRes.error) throw estimatesRes.error;
      if (requisitionsRes.error) throw requisitionsRes.error;
      if (progressRes.error) throw progressRes.error;
      if (fundRequestsRes.error) throw fundRequestsRes.error;

      // 3. Flat-map and compile a comprehensive list of record identifiers
      const allowedIdentifiers = [
        ...woList,
        ...(estimatesRes.data || []).map(e => e.estimate_id.toString()),
        ...(requisitionsRes.data || []).map(r => r.requisition_id.toString()),
        ...(progressRes.data || []).map(p => p.report_id.toString()),
        ...(fundRequestsRes.data || []).map(f => f.fund_request_id.toString())
      ];

      // 4. Query the audit_log with the resolved identifier set
      const { data: audits, error } = await supabase
        .from('audit_log')
        .select('*')
        .in('record_identifier', allowedIdentifiers)
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) throw error;

      const enrichedAudits = await enrichAuditsWithUserNames(audits || []);
      return res.status(200).json({ success: true, activities: enrichedAudits });
    } else {
      // HO or Admin: fetch global recent activity
      const { data: audits, error } = await supabase
        .from('audit_log')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(50);

      if (error) throw error;

      const enrichedAudits = await enrichAuditsWithUserNames(audits || []);
      return res.status(200).json({ success: true, activities: enrichedAudits });
    }
  } catch (error) {
    console.error('[ANALYTICS] Error in getRecentActivity:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching activities.' });
  }
}

/**
 * GET /api/v1/auth/analytics/audit-log
 * Paginated and searchable audit log list for the Audit Search Center
 */
async function getAuditLog(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '50', 10);
    const offset = (page - 1) * limit;

    let query = supabase
      .from('audit_log')
      .select('*', { count: 'exact' });

    if (req.query.module_name) {
      query = query.eq('module_name', req.query.module_name);
    }
    if (req.query.user_id) {
      query = query.eq('user_id', req.query.user_id);
    }
    if (req.query.record_identifier) {
      query = query.eq('record_identifier', req.query.record_identifier);
    }

    const { data, error, count } = await query
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const enrichedData = await enrichAuditsWithUserNames(data || []);
    const totalPages = Math.ceil((count || 0) / limit);

    return res.status(200).json({
      success: true,
      data: enrichedData,
      totalCount: count || 0,
      page,
      totalPages
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getAuditLog:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching audit log.' });
  }
}

/**
 * GET /api/v1/auth/analytics/project/:work_order_no/digital-twin
 * Returns the digital twin overview metrics, material variance, SLAs, leakage, and audits for a project
 */
async function getProjectDigitalTwin(req, res) {
  try {
    const { work_order_no } = req.params;

    // 1. Enforce strict role-based access constraints
    if (req.user.role === 'je') {
      const { data: mapping, error: mapErr } = await supabase
        .from('work_order_mappings')
        .select('id')
        .eq('je_user_id', req.user.mobile_number)
        .eq('work_order_no', work_order_no)
        .eq('is_active', true)
        .maybeSingle();

      if (mapErr) throw mapErr;
      if (!mapping) {
        return res.status(403).json({ success: false, message: 'Access denied. You are not mapped to this project.' });
      }
    } else if (req.user.role === 'zo') {
      const { data: project, error: projErr } = await supabase
        .from('projects_master')
        .select('zo_user_id')
        .eq('work_order_no', work_order_no)
        .maybeSingle();

      if (projErr) throw projErr;
      if (!project || project.zo_user_id !== req.user.mobile_number) {
        return res.status(403).json({ success: false, message: 'Access denied. This project is not in your zone.' });
      }
    }

    // 2. Fetch linked entity IDs to resolve all direct/indirect audits for this project
    const [estimatesRes, requisitionsRes, progressRes, fundRequestsRes] = await Promise.all([
      supabase.from('project_cost_estimates').select('estimate_id').eq('work_order_no', work_order_no),
      supabase.from('requisitions').select('requisition_id').eq('work_order_no', work_order_no),
      supabase.from('daily_progress_reports').select('report_id').eq('work_order_no', work_order_no),
      supabase.from('fund_requests').select('fund_request_id').eq('work_order_no', work_order_no)
    ]);

    if (estimatesRes.error) throw estimatesRes.error;
    if (requisitionsRes.error) throw requisitionsRes.error;
    if (progressRes.error) throw progressRes.error;
    if (fundRequestsRes.error) throw fundRequestsRes.error;

    const allowedIdentifiers = [
      work_order_no,
      ...(estimatesRes.data || []).map(e => e.estimate_id.toString()),
      ...(requisitionsRes.data || []).map(r => r.requisition_id.toString()),
      ...(progressRes.data || []).map(p => p.report_id.toString()),
      ...(fundRequestsRes.data || []).map(f => f.fund_request_id.toString())
    ];

    // 3. Perform component fetches in parallel
    const [overviewRes, materialsRes, approvalsRes, budgetRes, auditsRes, coordsRes] = await Promise.all([
      supabase.from('project_health_mv').select('*').eq('work_order_no', work_order_no).maybeSingle(),
      supabase.from('material_variance_mv').select('*').eq('work_order_no', work_order_no),
      supabase.from('approval_sla_mv').select('*').eq('work_order_no', work_order_no).order('submitted_at', { ascending: false }),
      supabase.from('budget_leakage_mv').select('*').eq('work_order_no', work_order_no).maybeSingle(),
      supabase.from('audit_log').select('*').in('record_identifier', allowedIdentifiers).order('timestamp', { ascending: false }).limit(50),
      supabase.from('projects_master').select('site_latitude, site_longitude').eq('work_order_no', work_order_no).maybeSingle()
    ]);

    if (overviewRes.error) throw overviewRes.error;
    if (materialsRes.error) throw materialsRes.error;
    if (approvalsRes.error) throw approvalsRes.error;
    if (budgetRes.error) throw budgetRes.error;
    if (auditsRes.error) throw auditsRes.error;

    const enrichedAudits = await enrichAuditsWithUserNames(auditsRes.data || []);
    const overviewData = overviewRes.data ? {
      ...overviewRes.data,
      site_latitude: coordsRes.data?.site_latitude || null,
      site_longitude: coordsRes.data?.site_longitude || null
    } : null;

    return res.status(200).json({
      success: true,
      overview: overviewData,
      materials: materialsRes.data || [],
      approvals: approvalsRes.data || [],
      budget: budgetRes.data || null,
      audits: enrichedAudits
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getProjectDigitalTwin:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching project digital twin.' });
  }
}

/**
 * GET /api/v1/auth/analytics/projects
 * Returns list of projects from project_health_mv with role-based visibility filtering
 */
async function getProjectsHealth(req, res) {
  try {
    let query = supabase.from('project_health_mv').select('*');

    if (req.user.role === 'zo') {
      query = query.eq('zo_user_id', req.user.mobile_number);
    } else if (req.user.role === 'je') {
      const { data: mappings, error: mapErr } = await supabase
        .from('work_order_mappings')
        .select('work_order_no')
        .eq('je_user_id', req.user.mobile_number)
        .eq('is_active', true);

      if (mapErr) throw mapErr;
      const woList = (mappings || []).map(m => m.work_order_no);
      if (woList.length === 0) {
        return res.status(200).json({ success: true, data: [] });
      }
      query = query.in('work_order_no', woList);
    }

    const { data, error } = await query.order('health_score', { ascending: false });
    if (error) throw error;

    return res.status(200).json({
      success: true,
      data: data || []
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getProjectsHealth:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching project health list.' });
  }
}

/**
 * POST /api/v1/auth/analytics/refresh
 * Explicitly triggers view updates from backend (restriced to HO/admin)
 */
async function triggerRefresh(req, res) {
  // Respond immediately to prevent client-side HTTP timeouts
  res.status(202).json({
    success: true,
    message: 'Analytics views refresh triggered in the background.'
  });

  console.log('[ANALYTICS] Initiating background refresh of materialized views...');
  const startTime = Date.now();

  // Execute Supabase RPC call in the background
  supabase.rpc('refresh_analytics_views')
    .then(({ error }) => {
      if (error) {
        console.error('[ANALYTICS] Background views refresh failed:', error.message || error);
      } else {
        const duration = Date.now() - startTime;
        console.log(`[ANALYTICS] Background views refresh completed successfully in ${duration} ms.`);
      }
    })
    .catch(err => {
      console.error('[ANALYTICS] Background views refresh encountered exception:', err.message || err);
    });
}

module.exports = {
  getHoKpis,
  getHoResourceUtilization,
  getHoApprovalSla,
  getHoZoneBenchmarking,
  getHoBudgetLeakage,
  getZoProductivity,
  getRecentActivity,
  getAuditLog,
  getProjectDigitalTwin,
  triggerRefresh,
  getProjectsHealth
};
