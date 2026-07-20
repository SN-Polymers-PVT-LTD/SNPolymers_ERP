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
      supabase.from('project_cost_estimates').select('estimate_id').eq('work_order_no', work_order_no).order('estimate_revision', { ascending: false }),
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
      supabase.from('projects_master').select('site_latitude, site_longitude, department').eq('work_order_no', work_order_no).maybeSingle()
    ]);

    if (overviewRes.error) throw overviewRes.error;
    if (materialsRes.error) throw materialsRes.error;
    if (approvalsRes.error) throw approvalsRes.error;
    if (budgetRes.error) throw budgetRes.error;
    if (auditsRes.error) throw auditsRes.error;

    const enrichedAudits = await enrichAuditsWithUserNames(auditsRes.data || []);
    const matchedEstimate = (estimatesRes.data || [])[0];
    const overviewData = overviewRes.data ? {
      ...overviewRes.data,
      estimate_id: matchedEstimate ? matchedEstimate.estimate_id : null,
      site_latitude: coordsRes.data?.site_latitude || null,
      site_longitude: coordsRes.data?.site_longitude || null,
      department: coordsRes.data?.department || null
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

/**
 * GET /api/v1/auth/analytics/ho/actionable-insights
 * Returns runway data, stalled projects, and high-revision alerts.
 * Restricted to HO and Admin roles.
 */
async function getHoActionableInsights(req, res) {
  try {
    // Role protection checkpoint (Security-in-Depth)
    if (req.user.role !== 'ho' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Authorized executive roles only.' });
    }

    // 1. Fetch all ZO balances
    const { data: balances, error: balErr } = await supabase
      .from('zo_balances')
      .select('zo_user_id, available_balance');
    if (balErr) throw balErr;

    // 2. Fetch last-30-day requisition burns per ZO
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: burns, error: burnErr } = await supabase
      .from('requisitions')
      .select('zo_user_id, approved_amount')
      .eq('requisition_status', 'Approved')
      .gte('payment_date', thirtyDaysAgo);
    if (burnErr) throw burnErr;

    // 3. Aggregate burn per ZO
    const burnMap = {};
    (burns || []).forEach(r => {
      burnMap[r.zo_user_id] = (burnMap[r.zo_user_id] || 0) + Number(r.approved_amount || 0);
    });

    // 4. Build runway data array
    const runwayData = (balances || []).map(b => {
      const monthlyBurn = burnMap[b.zo_user_id] || 0;
      const dailyBurn = monthlyBurn / 30;
      const runwayDays = dailyBurn > 0
        ? Math.floor(Number(b.available_balance) / dailyBurn)
        : null; // null = no burn, infinite runway
      return {
        zo_user_id: b.zo_user_id,
        available_balance: Number(b.available_balance),
        monthly_burn: monthlyBurn,
        daily_burn: parseFloat(dailyBurn.toFixed(2)),
        runway_days: runwayDays
      };
    });

    // 5. Stalled projects from project_health_mv view
    const { data: stalled, error: stalledErr } = await supabase
      .from('project_health_mv')
      .select('work_order_no, site_details, days_since_last_progress_report, physical_progress')
      .lt('physical_progress', 100)
      .gt('days_since_last_progress_report', 7)
      .order('days_since_last_progress_report', { ascending: false });
    if (stalledErr) throw stalledErr;

    // 6. High-revision projects (>3 revisions)
    const { data: allEstimates, error: estErr } = await supabase
      .from('project_cost_estimates')
      .select('work_order_no');
    if (estErr) throw estErr;

    const revisionCount = {};
    (allEstimates || []).forEach(e => {
      revisionCount[e.work_order_no] = (revisionCount[e.work_order_no] || 0) + 1;
    });
    const highRevisionProjects = Object.entries(revisionCount)
      .filter(([, count]) => count > 3)
      .map(([work_order_no, revision_count]) => ({ work_order_no, revision_count }))
      .sort((a, b) => b.revision_count - a.revision_count);

    return res.status(200).json({
      success: true,
      runwayData,
      stalledProjects: stalled || [],
      highRevisionProjects
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoActionableInsights:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching actionable insights.' });
  }
}

/**
 * GET /api/v1/auth/analytics/ho/chart-data
 * Returns all 6 chart datasets in a single request.
 * Accepts: ?view=all|zo|wo, ?zone=, ?work_order_no=
 */
async function getHoChartData(req, res) {
  try {
    // Role protection checkpoint (Security-in-Depth)
    if (req.user.role !== 'ho' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. Authorized executive roles only.' });
    }

    const { view = 'all', zone, work_order_no } = req.query;
    const twelveMonthsAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

    const sumOf = (arr, key) =>
      (arr || []).reduce((acc, r) => acc + Number(r[key] || 0), 0);

    // === Parallel fetch all chart sources ===
    const [healthRes, estimatesRes, fundReqsRes, reqsRes, billsRes, ledgerRes, dprRes, zoneRes] =
      await Promise.all([
        supabase.from('project_health_mv').select(
          'work_order_no, site_details, physical_progress, approved_requisitions_amount, work_order_value, days_since_last_progress_report, health_score, health_status, zo_user_id, zone'
        ),
        supabase.from('project_cost_estimates').select('work_order_no, estimate_amount, estimate_status, estimate_revision, created_at'),
        supabase.from('fund_requests').select('approve_ho_amount, request_status, work_order_no'),
        supabase.from('requisitions').select('approved_amount, requisition_status, work_order_no, zo_user_id, payment_date'),
        supabase.from('ra_final_bills').select('gross_bill, agency_payment, work_order_no'),
        supabase.from('zo_fund_ledger').select('zo_user_id, transaction_type, amount, created_at').gte('created_at', twelveMonthsAgo).order('created_at', { ascending: true }),
        supabase.from('daily_progress_reports').select('work_order_no, physical_work_progress, login_date').order('login_date', { ascending: true }),
        supabase.from('zone_performance_mv').select('*')
      ]);

    // Throw on first error
    for (const r of [healthRes, estimatesRes, fundReqsRes, reqsRes, billsRes, ledgerRes, dprRes, zoneRes]) {
      if (r.error) throw r.error;
    }

    // === Build bubbleMatrix ===
    let bubbleMatrix = (healthRes.data || []).map(p => ({
      work_order_no: p.work_order_no,
      site_details: p.site_details,
      zone: p.zone,
      physical_progress: Number(p.physical_progress || 0),
      budget_utilization_pct: p.work_order_value > 0
        ? parseFloat(((Number(p.approved_requisitions_amount) / Number(p.work_order_value)) * 100).toFixed(1))
        : 0,
      days_since_dpr: Number(p.days_since_last_progress_report || 0),
      health_score: Number(p.health_score || 0),
      health_status: p.health_status,
      anomaly_score: p.health_status === 'Critical' ? 4 : p.health_status === 'Warning' ? 2 : 0
    }));
    if (zone) bubbleMatrix = bubbleMatrix.filter(p => p.zone === zone);
    if (work_order_no) bubbleMatrix = bubbleMatrix.filter(p => p.work_order_no === work_order_no);

    // === Build waterfallData ===
    const finalEstimates = (estimatesRes.data || []).filter(e => e.estimate_status === 'Final Approved');
    const approvedFunds  = (fundReqsRes.data  || []).filter(f => f.request_status === 'Approved');
    const approvedReqs   = (reqsRes.data       || []).filter(r => r.requisition_status === 'Approved');
    const waterfallData = [
      { stage: 'Final Approved Estimate', amount: sumOf(finalEstimates, 'estimate_amount') },
      { stage: 'HO Allocated',           amount: sumOf(approvedFunds,  'approve_ho_amount') },
      { stage: 'Requisitions Approved',  amount: sumOf(approvedReqs,   'approved_amount') },
      { stage: 'Gross Billed',           amount: sumOf(billsRes.data,  'gross_bill') },
      { stage: 'Agency Paid',            amount: sumOf(billsRes.data,  'agency_payment') }
    ];

    // === Build zonalHeatmap ===
    const zonalHeatmap = (zoneRes.data || []).map(z => ({
      zone: z.zone,
      health_score: Number(z.average_health_score || 0),
      budget_util: Number(z.budget_utilization_pct || 0),
      total_projects: Number(z.total_projects || 0),
      delayed_projects: Number(z.delayed_projects || 0),
      projects_at_risk: Number(z.projects_at_risk || 0)
    }));

    // === Build revisionHeatmap ===
    const revisionMap = {};
    (estimatesRes.data || []).forEach(e => {
      const month = e.created_at ? e.created_at.slice(0, 7) : 'unknown';
      const key = `${e.work_order_no}__${month}`;
      if (!revisionMap[key]) revisionMap[key] = { work_order_no: e.work_order_no, month, revision_count: 0 };
      revisionMap[key].revision_count++;
    });
    const revisionHeatmap = Object.values(revisionMap);

    // === Build sCurveData ===
    const dprByWO = {};
    (dprRes.data || []).forEach(d => {
      if (!dprByWO[d.work_order_no]) dprByWO[d.work_order_no] = [];
      dprByWO[d.work_order_no].push({ date: d.login_date, progress: Number(d.physical_work_progress || 0) });
    });
    const sCurveData = Object.entries(dprByWO).map(([wo, actuals]) => ({
      work_order_no: wo,
      actuals
    }));

    // === Build runwayTrend ===
    const ledgerByZO = {};
    (ledgerRes.data || []).forEach(tx => {
      if (!ledgerByZO[tx.zo_user_id]) ledgerByZO[tx.zo_user_id] = [];
      ledgerByZO[tx.zo_user_id].push({
        date: tx.created_at.slice(0, 10),
        amount: tx.transaction_type === 'REQUISITION_APPROVAL'
          ? -Number(tx.amount) : Number(tx.amount)
      });
    });
    const runwayTrend = Object.entries(ledgerByZO).map(([zo_user_id, txs]) => {
      let running = 0;
      const history = txs.map(tx => {
        running += tx.amount;
        return { date: tx.date, balance: running };
      });
      return { zo_user_id, history };
    });

    return res.status(200).json({
      success: true,
      bubbleMatrix,
      waterfallData,
      zonalHeatmap,
      runwayTrend,
      sCurveData,
      revisionHeatmap
    });
  } catch (error) {
    console.error('[ANALYTICS] Error in getHoChartData:', error.message || error);
    return res.status(500).json({ success: false, message: 'Internal server error fetching chart data.' });
  }
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
  getProjectsHealth,
  getHoActionableInsights,
  getHoChartData
};
