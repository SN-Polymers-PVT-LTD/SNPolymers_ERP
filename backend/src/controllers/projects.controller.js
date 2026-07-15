const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createProjectSchema, updateProjectSchema, updateProjectStatusSchema } = require('../validation/project.schema');

/**
 * GET /api/v1/auth/projects
 * Fetches all project master records
 */
async function getProjects(req, res) {
  try {
    const query = req.query || {};
    const hasPagination = query.page !== undefined || query.limit !== undefined;

    let dbQuery = supabase.from('projects_master');

    if (query.has_approved_estimate === 'true') {
      const { data: approvedEsts, error: estError } = await supabase
        .from('project_cost_estimates')
        .select('work_order_no')
        .eq('estimate_status', 'Final Approved');

      if (estError) throw estError;
      const approvedWOs = (approvedEsts || []).map(e => e.work_order_no);
      dbQuery = dbQuery.in('work_order_no', approvedWOs.length > 0 ? approvedWOs : ['dummy_work_order_no']);
    }

    if (!hasPagination) {
      let queryBuilder = dbQuery.select('*, zo_user:authorised_users!zo_user_id(display_name)');
      if (req.user.role === 'zo') {
        queryBuilder = queryBuilder.eq('zo_user_id', req.user.mobile_number);
      }
      const { data: projects, error } = await queryBuilder
        .order('work_order_no', { ascending: true });

      if (error) throw error;
      return res.status(200).json({ success: true, projects });
    }

    // Paginated flow
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit || 50), 100);
    const offset = (page - 1) * limit;

    let queryBuilder = dbQuery.select('*, zo_user:authorised_users!zo_user_id(display_name)', { count: 'exact' });
    if (req.user.role === 'zo') {
      queryBuilder = queryBuilder.eq('zo_user_id', req.user.mobile_number);
    }
    const { data: projects, count, error } = await queryBuilder
      .order('work_order_no', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    return res.status(200).json({
      success: true,
      projects,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    console.error(`getProjects failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve projects.' });
  }
}

/**
 * GET /api/v1/auth/projects/:work_order_no
 * Fetches a single project master record by work_order_no
 */
async function getProjectByWorkOrder(req, res) {
  const { work_order_no } = req.params;

  try {
    const { data: project, error } = await supabase
      .from('projects_master')
      .select('*, zo_user:authorised_users!zo_user_id(display_name)')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (error) throw error;

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    if (req.user.role === 'zo' && project.zo_user_id !== req.user.mobile_number) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    return res.status(200).json({ success: true, project });
  } catch (error) {
    console.error(`getProjectByWorkOrder failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve project details.' });
  }
}

/**
 * POST /api/v1/auth/projects
 * Creates a new project record (Admin only)
 */
async function createProject(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  if (!validate(req, res, createProjectSchema)) return;

  const {
    work_order_no,
    estimate_no,
    work_order_value,
    site_details,
    state,
    district,
    zone,
    department,
    status,
    earnest_money_deposit,
    site_latitude,
    site_longitude,
    project_start_date,
    project_end_date,
    zo_user_id
  } = req.body;

  const valNum = work_order_value;
  const projectStatus = status || 'Running';

  try {
    const { data, error } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no,
          estimate_no,
          work_order_value: valNum,
          site_details,
          state,
          district,
          zone,
          department,
          status: projectStatus,
          earnest_money_deposit: Number(earnest_money_deposit || 0),
          site_latitude: site_latitude !== undefined && site_latitude !== '' ? Number(site_latitude) : null,
          site_longitude: site_longitude !== undefined && site_longitude !== '' ? Number(site_longitude) : null,
          project_start_date: project_start_date || null,
          project_end_date: project_end_date || null,
          zo_user_id: zo_user_id || null,
          created_by: req.user.mobile_number,
          edited_by: req.user.mobile_number
        }
      ])
      .select('*, zo_user:authorised_users!zo_user_id(display_name)')
      .single();

    if (error) {
      if (error.code === '23505') { // UNIQUE violation (work_order_no duplicate)
        return res.status(409).json({
          success: false,
          message: `A project with work order number '${work_order_no}' already exists.`
        });
      }
      throw error;
    }

    return res.status(201).json({
      success: true,
      project: data,
      message: 'Project created successfully.'
    });
  } catch (error) {
    console.error(`createProject failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create project.' });
  }
}

/**
 * PUT /api/v1/auth/projects/:work_order_no
 * Updates a project record (Admin only)
 */
async function updateProject(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  if (!validate(req, res, updateProjectSchema)) return;

  const { work_order_no } = req.params;
  const {
    estimate_no,
    work_order_value,
    site_details,
    state,
    district,
    zone,
    department,
    earnest_money_deposit,
    site_latitude,
    site_longitude,
    project_start_date,
    project_end_date,
    zo_user_id
  } = req.body;

  const valNum = work_order_value;

  try {
    // 1. Fetch current project to verify existence
    const { data: current, error: fetchErr } = await supabase
      .from('projects_master')
      .select('*')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    // 2. Perform update
    const { data: updated, error } = await supabase
      .from('projects_master')
      .update({
        estimate_no,
        work_order_value: valNum,
        site_details,
        state,
        district,
        zone,
        department,
        earnest_money_deposit: earnest_money_deposit !== undefined ? Number(earnest_money_deposit || 0) : undefined,
        site_latitude: site_latitude !== undefined ? (site_latitude === '' || site_latitude === null ? null : Number(site_latitude)) : undefined,
        site_longitude: site_longitude !== undefined ? (site_longitude === '' || site_longitude === null ? null : Number(site_longitude)) : undefined,
        project_start_date: project_start_date !== undefined ? (project_start_date || null) : undefined,
        project_end_date: project_end_date !== undefined ? (project_end_date || null) : undefined,
        zo_user_id: zo_user_id !== undefined ? (zo_user_id || null) : undefined,
        edited_by: req.user.mobile_number
      })
      .eq('work_order_no', work_order_no)
      .select('*, zo_user:authorised_users!zo_user_id(display_name)')
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      project: updated,
      message: 'Project updated successfully.'
    });
  } catch (error) {
    console.error(`updateProject failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update project.' });
  }
}

/**
 * PATCH /api/v1/auth/projects/:work_order_no/status
 * Updates only status (Admin only)
 */
async function updateProjectStatus(req, res) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Forbidden: Admin access required.' });
  }
  if (!validate(req, res, updateProjectStatusSchema)) return;

  const { work_order_no } = req.params;
  const { status } = req.body;

  try {
    // 1. Fetch current project to verify existence
    const { data: current, error: fetchErr } = await supabase
      .from('projects_master')
      .select('*')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }

    // 2. Perform update
    const { data: updated, error } = await supabase
      .from('projects_master')
      .update({
        status,
        edited_by: req.user.mobile_number
      })
      .eq('work_order_no', work_order_no)
      .select()
      .single();

    if (error) throw error;

    // 3. Cascade: if the new status marks the WO as inactive (Closed or Complete Under Maintenance),
    //    deactivate WO mappings then auto-deactivate JE-ZO mappings for JEs with no remaining
    //    active WOs under this ZO.
    const INACTIVE_STATUSES = ['Closed', 'Complete Under Maintenance'];
    if (INACTIVE_STATUSES.includes(status)) {
      const zoUserId = current.zo_user_id;

      // 3a. Fetch active work_order_mappings for this WO (before deactivating, so we know which JEs to check)
      const { data: activeWoMappings, error: woFetchErr } = await supabase
        .from('work_order_mappings')
        .select('id, je_user_id')
        .eq('work_order_no', work_order_no)
        .eq('is_active', true);

      if (woFetchErr) throw woFetchErr;

      if (activeWoMappings && activeWoMappings.length > 0) {
        const affectedJeIds = [...new Set(activeWoMappings.map(m => m.je_user_id))];

        // 3b. Bulk-deactivate all active work_order_mappings for this WO.
        // NOTE: Must happen BEFORE deactivating je_zo_mappings — DB trigger on
        // work_order_mappings validates that the JE has an active ZO mapping.
        const { error: woBulkErr } = await supabase
          .from('work_order_mappings')
          .update({
            is_active: false,
            reason: 'Project Closed',
            deactivated_at: new Date().toISOString(),
            deactivated_by: req.user.mobile_number
          })
          .eq('work_order_no', work_order_no)
          .eq('is_active', true);

        if (woBulkErr) throw woBulkErr;

        // 3c. For each affected JE, check if they still have active WO mappings
        //     under the same ZO. If not, auto-deactivate their je_zo_mapping.
        if (zoUserId) {
          // Fetch all other projects under this ZO that are still in a truly active state
          // (i.e., not Closed and not Complete Under Maintenance)
          const { data: zoProjects, error: zoProjErr } = await supabase
            .from('projects_master')
            .select('work_order_no')
            .eq('zo_user_id', zoUserId)
            .neq('work_order_no', work_order_no)
            .not('status', 'in', `("Closed","Complete Under Maintenance")`);

          if (zoProjErr) throw zoProjErr;

          const otherActiveWoNos = (zoProjects || []).map(p => p.work_order_no);

          for (const jeId of affectedJeIds) {
            let hasRemainingActiveWo = false;

            if (otherActiveWoNos.length > 0) {
              const { data: remaining, error: remainErr } = await supabase
                .from('work_order_mappings')
                .select('id')
                .eq('je_user_id', jeId)
                .eq('is_active', true)
                .in('work_order_no', otherActiveWoNos)
                .limit(1);

              if (remainErr) throw remainErr;
              hasRemainingActiveWo = remaining && remaining.length > 0;
            }

            if (!hasRemainingActiveWo) {
              // Auto-deactivate the JE-ZO mapping. deactivated_by is NULL (system-triggered).
              const { error: jeZoDeactivErr } = await supabase
                .from('je_zo_mappings')
                .update({
                  is_active: false,
                  deactivated_at: new Date().toISOString(),
                  deactivated_by: null
                })
                .eq('je_user_id', jeId)
                .eq('zo_user_id', zoUserId)
                .eq('is_active', true);

              if (jeZoDeactivErr) throw jeZoDeactivErr;
              console.log(`[Auto-deactivate] JE ${jeId} unmapped from ZO ${zoUserId} — no active WOs remaining.`);
            }
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      project: updated,
      message: 'Project status updated successfully.'
    });
  } catch (error) {
    console.error(`updateProjectStatus failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update project status.' });
  }
}

/**
 * GET /api/v1/auth/projects/dashboard/overview
 * Fetches dashboard overview metrics & recent activity logs
 */
async function getDashboardOverview(req, res) {
  try {
    // 1. Fetch projects to calculate counts
    const { data: projects, error: projectsErr } = await supabase
      .from('projects_master')
      .select('status, work_order_no, edited_at')
      .order('edited_at', { ascending: false });

    if (projectsErr) throw projectsErr;

    const totalProjects = projects.length;
    const running = projects.filter(p => p.status === 'Running').length;
    const closed = projects.filter(p => p.status === 'Closed').length;
    const maintenance = projects.filter(p => p.status === 'Complete Under Maintenance').length;
    
    const lastUpdatedProject = projects.length > 0 ? projects[0].work_order_no : 'N/A';
    const lastUpdatedAt = projects.length > 0 ? projects[0].edited_at : null;

    // 2. Fetch recent activity from audit_log
    const { data: logs, error: logsErr } = await supabase
      .from('audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(10);

    let recentActivity = [];
    if (!logsErr && logs) {
      // Fetch users to map display name
      const { data: users } = await supabase
        .from('authorised_users')
        .select('mobile_number, display_name');

      const userMap = {};
      if (users) {
        users.forEach(u => {
          userMap[u.mobile_number] = u;
        });
      }

      recentActivity = logs.map(log => {
        const user = userMap[log.user_id];
        const userName = user?.display_name || log.user_id || 'Operator';
        const record = log.record_identifier;
        let message = '';

        if (log.module_name === 'Project Management') {
          if (log.action === 'CREATE') {
            message = `${userName} created project ${record}`;
          } else if (log.action === 'STATUS_CHANGE') {
            const oldStatus = log.old_value?.status;
            const newStatus = log.new_value?.status;
            if (newStatus === 'Closed') {
              message = `${userName} closed ${record}`;
            } else if (oldStatus === 'Closed' && newStatus === 'Running') {
              message = `Project ${record} reopened`;
            } else {
              message = `${userName} updated status of ${record} to ${newStatus}`;
            }
          } else if (log.action === 'EDIT') {
            message = `${userName} updated ${record}`;
          } else {
            message = `${userName} modified project ${record}`;
          }
        } else if (log.module_name === 'Fund Report') {
          const workOrder = log.new_value?.work_order_no || log.old_value?.work_order_no || record;
          if (log.action === 'CREATE') {
            message = `New Fund Report submitted for ${workOrder}`;
          } else if (log.action === 'SOFT_DELETE') {
            message = `Fund Report for ${workOrder} deleted`;
          } else if (log.action === 'RESTORE') {
            message = `Fund Report for ${workOrder} restored`;
          } else {
            message = `Fund Report for ${workOrder} updated`;
          }
        } else {
          message = `${userName} performed ${log.action} on ${log.module_name}`;
        }

        return {
          id: log.id,
          message,
          timestamp: log.timestamp
        };
      });
    } else if (logsErr) {
      console.error('Error fetching audit logs:', logsErr.message);
    }

    return res.status(200).json({
      success: true,
      overview: {
        totalProjects,
        running,
        closed,
        maintenance,
        lastUpdatedProject,
        lastUpdatedAt
      },
      recentActivity
    });
  } catch (error) {
    console.error(`getDashboardOverview failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve dashboard overview.' });
  }
}

module.exports = {
  getProjects,
  getProjectByWorkOrder,
  createProject,
  updateProject,
  updateProjectStatus,
  getDashboardOverview
};
