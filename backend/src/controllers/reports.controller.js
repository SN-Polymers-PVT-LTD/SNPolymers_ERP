const { supabase } = require('../db/supabase');
const { logError } = require('../utils/logger');

/**
 * Helper: Check if project status is 'Closed'
 * Returns true if closed, false otherwise
 */
async function isProjectClosed(workOrderNo) {
  const { data: project, error } = await supabase
    .from('projects_master')
    .select('status')
    .eq('work_order_no', workOrderNo)
    .maybeSingle();

  if (error) throw error;
  if (!project) return null;
  return project.status === 'Closed';
}

/**
 * GET /api/v1/auth/reports
 * Fetches all active fund reports (is_deleted = false)
 * Performs a live join/lookup to fetch projects_master columns
 */
async function getReports(req, res) {
  try {
    const query = req.query || {};
    const hasPagination = query.page !== undefined || query.limit !== undefined;

    if (!hasPagination) {
      const { data: reports, error } = await supabase
        .from('fund_reports')
        .select(`
          *,
          projects_master (
            estimate_no,
            work_order_value,
            site_details,
            state,
            district,
            zone,
            department,
            status
          )
        `)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ success: true, reports });
    }

    // Paginated flow
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit || 50), 100);
    const offset = (page - 1) * limit;

    const [countRes, reportsRes] = await Promise.all([
      supabase
        .from('fund_reports')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', false),
      supabase
        .from('fund_reports')
        .select(`
          *,
          projects_master (
            estimate_no,
            work_order_value,
            site_details,
            state,
            district,
            zone,
            department,
            status
          )
        `)
        .eq('is_deleted', false)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
    ]);

    if (countRes.error) throw countRes.error;
    if (reportsRes.error) throw reportsRes.error;

    const count = countRes.count;
    const reports = reportsRes.data;

    return res.status(200).json({
      success: true,
      reports,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    logError('getReports', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve fund reports.' });
  }
}

/**
 * GET /api/v1/auth/reports/deleted
 * Fetches soft-deleted fund reports (is_deleted = true) - Admin only
 */
async function getSoftDeletedReports(req, res) {
  try {
    const query = req.query || {};
    const hasPagination = query.page !== undefined || query.limit !== undefined;

    if (!hasPagination) {
      const { data: reports, error } = await supabase
        .from('fund_reports')
        .select(`
          *,
          projects_master (
            estimate_no,
            work_order_value,
            site_details,
            state,
            district,
            zone,
            department,
            status
          )
        `)
        .eq('is_deleted', true)
        .order('deleted_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ success: true, reports });
    }

    // Paginated flow
    const page = parseInt(query.page) || 1;
    const limit = Math.min(parseInt(query.limit || 50), 100);
    const offset = (page - 1) * limit;

    const [countRes, reportsRes] = await Promise.all([
      supabase
        .from('fund_reports')
        .select('*', { count: 'exact', head: true })
        .eq('is_deleted', true),
      supabase
        .from('fund_reports')
        .select(`
          *,
          projects_master (
            estimate_no,
            work_order_value,
            site_details,
            state,
            district,
            zone,
            department,
            status
          )
        `)
        .eq('is_deleted', true)
        .order('deleted_at', { ascending: false })
        .range(offset, offset + limit - 1)
    ]);

    if (countRes.error) throw countRes.error;
    if (reportsRes.error) throw reportsRes.error;

    const count = countRes.count;
    const reports = reportsRes.data;

    return res.status(200).json({
      success: true,
      reports,
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    logError('getSoftDeletedReports', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve soft-deleted fund reports.' });
  }
}

/**
 * GET /api/v1/auth/reports/:fund_report_id
 * Fetches a single fund report by ID
 */
async function getReportById(req, res) {
  const { fund_report_id } = req.params;

  try {
    const { data: report, error } = await supabase
      .from('fund_reports')
      .select(`
        *,
        projects_master (
          estimate_no,
          work_order_value,
          site_details,
          state,
          district,
          zone,
          department,
          status
        )
      `)
      .eq('fund_report_id', fund_report_id)
      .eq('is_deleted', false)
      .maybeSingle();

    if (error) throw error;

    if (!report) {
      return res.status(404).json({ success: false, message: 'Fund report not found.' });
    }

    return res.status(200).json({ success: true, report });
  } catch (error) {
    logError('getReportById', error);
    return res.status(500).json({ success: false, message: 'Failed to retrieve report details.' });
  }
}

/**
 * POST /api/v1/auth/reports
 * Creates a new fund report (enforces project status mutability gate)
 */
async function createReport(req, res) {
  const { work_order_no, amount, remarks } = req.body;

  if (!work_order_no || amount === undefined || amount === null) {
    return res.status(400).json({ success: false, message: 'work_order_no and amount are required.' });
  }

  const amountNum = Number(amount);
  if (isNaN(amountNum) || !Number.isFinite(amountNum) || amountNum < 0) {
    return res.status(400).json({
      success: false,
      message: 'amount must be a valid finite non-negative number.'
    });
  }

  try {
    // Enforce Mutability Gate: Check if project status is Closed
    const isClosed = await isProjectClosed(work_order_no);
    if (isClosed === null) {
      return res.status(404).json({
        success: false,
        message: `Project with work order number '${work_order_no}' not found.`
      });
    }
    if (isClosed) {
      return res.status(403).json({
        success: false,
        message: 'Cannot create reports for projects with "Closed" status. All linked reports are immutable.'
      });
    }

    const { data, error } = await supabase
      .from('fund_reports')
      .insert([
        {
          work_order_no,
          amount,
          remarks: remarks || null,
          created_by: req.user.mobile_number,
          edited_by: req.user.mobile_number,
          is_deleted: false
        }
      ])
      .select()
      .single();

    if (error) throw error;

    return res.status(201).json({
      success: true,
      report: data,
      message: 'Fund report created successfully.'
    });
  } catch (error) {
    logError('createReport', error);
    return res.status(500).json({ success: false, message: 'Failed to create fund report.' });
  }
}

/**
 * PUT /api/v1/auth/reports/:fund_report_id
 * Updates an existing fund report (enforces project status mutability gate)
 */
async function updateReport(req, res) {
  const { fund_report_id } = req.params;
  const { work_order_no, amount, remarks } = req.body;

  if (amount === undefined || amount === null) {
    return res.status(400).json({ success: false, message: 'amount is required.' });
  }

  const amountNum = Number(amount);
  if (isNaN(amountNum) || !Number.isFinite(amountNum) || amountNum < 0) {
    return res.status(400).json({
      success: false,
      message: 'amount must be a valid finite non-negative number.'
    });
  }

  try {
    // 1. Fetch current report
    const { data: current, error: fetchErr } = await supabase
      .from('fund_reports')
      .select('work_order_no, is_deleted')
      .eq('fund_report_id', fund_report_id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current || current.is_deleted) {
      return res.status(404).json({ success: false, message: 'Fund report not found.' });
    }

    // 2. Enforce Mutability Gate for current project
    const isCurrentProjectClosed = await isProjectClosed(current.work_order_no);
    if (isCurrentProjectClosed) {
      return res.status(403).json({
        success: false,
        message: 'This report is linked to a "Closed" project and is immutable.'
      });
    }

    // 3. Enforce Mutability Gate for new project (if changing association)
    if (work_order_no && work_order_no !== current.work_order_no) {
      const isNewProjectClosed = await isProjectClosed(work_order_no);
      if (isNewProjectClosed) {
        return res.status(403).json({
          success: false,
          message: 'Cannot link reports to a "Closed" project.'
        });
      }
    }

    // 4. Perform update
    const { data: updated, error } = await supabase
      .from('fund_reports')
      .update({
        work_order_no: work_order_no || current.work_order_no,
        amount,
        remarks: remarks || null,
        edited_by: req.user.mobile_number
      })
      .eq('fund_report_id', fund_report_id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      report: updated,
      message: 'Fund report updated successfully.'
    });
  } catch (error) {
    logError('updateReport', error);
    return res.status(500).json({ success: false, message: 'Failed to update fund report.' });
  }
}

/**
 * DELETE /api/v1/auth/reports/:fund_report_id
 * Soft deletes a fund report (enforces project status mutability gate)
 */
async function deleteReport(req, res) {
  const { fund_report_id } = req.params;

  try {
    // 1. Fetch current report
    const { data: current, error: fetchErr } = await supabase
      .from('fund_reports')
      .select('work_order_no, is_deleted')
      .eq('fund_report_id', fund_report_id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current || current.is_deleted) {
      return res.status(404).json({ success: false, message: 'Fund report not found.' });
    }

    // 2. Enforce Mutability Gate
    const isClosed = await isProjectClosed(current.work_order_no);
    if (isClosed) {
      return res.status(403).json({
        success: false,
        message: 'Cannot delete reports linked to a "Closed" project.'
      });
    }

    // 3. Soft delete
    const { data: deleted, error } = await supabase
      .from('fund_reports')
      .update({
        is_deleted: true,
        deleted_by: req.user.mobile_number,
        deleted_at: new Date().toISOString()
      })
      .eq('fund_report_id', fund_report_id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      report: deleted,
      message: 'Fund report soft-deleted successfully.'
    });
  } catch (error) {
    logError('deleteReport', error);
    return res.status(500).json({ success: false, message: 'Failed to delete fund report.' });
  }
}

/**
 * PATCH /api/v1/auth/reports/:fund_report_id/restore
 * Restores a soft-deleted fund report (Admin only, enforces mutability gate)
 */
async function restoreReport(req, res) {
  const { fund_report_id } = req.params;

  try {
    // 1. Fetch current report
    const { data: current, error: fetchErr } = await supabase
      .from('fund_reports')
      .select('work_order_no, is_deleted')
      .eq('fund_report_id', fund_report_id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!current || !current.is_deleted) {
      return res.status(404).json({ success: false, message: 'Deleted fund report not found.' });
    }

    // 2. Enforce Mutability Gate
    const isClosed = await isProjectClosed(current.work_order_no);
    if (isClosed) {
      return res.status(403).json({
        success: false,
        message: 'Cannot restore reports linked to a "Closed" project.'
      });
    }

    // 3. Restore
    const { data: restored, error } = await supabase
      .from('fund_reports')
      .update({
        is_deleted: false,
        deleted_by: null,
        deleted_at: null
      })
      .eq('fund_report_id', fund_report_id)
      .select()
      .single();

    if (error) throw error;

    return res.status(200).json({
      success: true,
      report: restored,
      message: 'Fund report restored successfully.'
    });
  } catch (error) {
    logError('restoreReport', error);
    return res.status(500).json({ success: false, message: 'Failed to restore fund report.' });
  }
}

module.exports = {
  getReports,
  getSoftDeletedReports,
  getReportById,
  createReport,
  updateReport,
  deleteReport,
  restoreReport
};
