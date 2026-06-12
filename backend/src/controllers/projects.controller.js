const { supabase } = require('../db/supabase');

/**
 * GET /api/v1/auth/projects
 * Fetches all project master records
 */
async function getProjects(req, res) {
  try {
    const { data: projects, error } = await supabase
      .from('projects_master')
      .select('*')
      .order('work_order_no', { ascending: true });

    if (error) throw error;

    return res.status(200).json({ success: true, projects });
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
      .select('*')
      .eq('work_order_no', work_order_no)
      .maybeSingle();

    if (error) throw error;

    if (!project) {
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
  const {
    work_order_no,
    estimate_no,
    site_details,
    state,
    district,
    zone,
    department,
    status
  } = req.body;

  // Validation
  if (!work_order_no || !estimate_no || !site_details || !state || !district || !zone || !department) {
    return res.status(400).json({
      success: false,
      message: 'All fields except status are required (work_order_no, estimate_no, site_details, state, district, zone, department).'
    });
  }

  const allowedStatuses = ['Running', 'Closed', 'Complete Under Maintenance'];
  const projectStatus = status || 'Running';

  if (!allowedStatuses.includes(projectStatus)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`
    });
  }

  try {
    const { data, error } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no,
          estimate_no,
          site_details,
          state,
          district,
          zone,
          department,
          status: projectStatus,
          created_by: req.user.mobile_number,
          edited_by: req.user.mobile_number
        }
      ])
      .select()
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
  const { work_order_no } = req.params;
  const { estimate_no, site_details, state, district, zone, department } = req.body;

  // Validation
  if (!estimate_no || !site_details || !state || !district || !zone || !department) {
    return res.status(400).json({
      success: false,
      message: 'All standard fields are required (estimate_no, site_details, state, district, zone, department).'
    });
  }

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
        site_details,
        state,
        district,
        zone,
        department,
        edited_by: req.user.mobile_number
      })
      .eq('work_order_no', work_order_no)
      .select()
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
  const { work_order_no } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ success: false, message: 'Status is required.' });
  }

  const allowedStatuses = ['Running', 'Closed', 'Complete Under Maintenance'];
  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({
      success: false,
      message: `Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`
    });
  }

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

module.exports = {
  getProjects,
  getProjectByWorkOrder,
  createProject,
  updateProject,
  updateProjectStatus
};
