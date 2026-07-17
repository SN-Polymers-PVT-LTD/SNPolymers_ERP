'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const {
  createProgressReportSchema,
  addRemarksSchema,
  getReportByIdSchema
} = require('../validation/dailyProgress.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Display name resolver helper — batches all mobile lookups in a single query
async function resolveDisplayNames(mobiles) {
  const uniqueMobiles = Array.from(new Set(mobiles.filter(Boolean)));
  const userMap = {};
  if (uniqueMobiles.length > 0) {
    const { data: users, error } = await supabase
      .from('authorised_users')
      .select('mobile_number, display_name')
      .in('mobile_number', uniqueMobiles);
    if (!error && users) {
      users.forEach(u => {
        userMap[u.mobile_number] = u.display_name;
      });
    }
  }
  return userMap;
}

async function getMappedJeMobiles(zoMobile) {
  const { data: mappings, error } = await supabase
    .from('je_zo_mappings')
    .select('je_user_id')
    .eq('zo_user_id', zoMobile)
    .eq('is_active', true);

  if (error) throw error;
  return (mappings || []).map(m => m.je_user_id);
}

/**
 * POST /api/v1/auth/daily-progress
 * Creates a new daily work progress report (JE only).
 */
async function createProgressReport(req, res) {
  if (!validate(req, res, createProgressReportSchema)) return;

  const {
    work_order_no,
    site_visit_date,
    work_progress_details,
    physical_work_progress,
    daily_site_photo_url,
    original_photo_filename,
    remarks_after_site_visit
  } = req.body;

  try {
    // 1. Fetch work order details and verify project is Active
    const { data: project, error: projectErr } = await supabase
      .from('projects_master')
      .select('status, state, district, zone, department, site_details')
      .eq('work_order_no', work_order_no.trim())
      .maybeSingle();

    if (projectErr) throw projectErr;
    if (!project) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }

    // Verify JE is mapped to this Work Order
    const { data: woMapping, error: woMapErr } = await supabase
      .from('work_order_mappings')
      .select('id')
      .eq('je_user_id', req.user.mobile_number)
      .eq('work_order_no', work_order_no.trim())
      .eq('is_active', true)
      .maybeSingle();

    if (woMapErr) throw woMapErr;
    if (!woMapping) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. You are not mapped to this Work Order.'
      });
    }

    const ALLOWED_PROJECT_STATUSES = ['Running'];
    if (!ALLOWED_PROJECT_STATUSES.includes(project.status)) {
      return res.status(409).json({
        success: false,
        message: 'Daily progress reports can only be created for Active projects.'
      });
    }

    // Fetch JE's active Zonal Office mapping
    const { data: jeMapping, error: jeMapErr } = await supabase
      .from('je_zo_mappings')
      .select('zo_user_id')
      .eq('je_user_id', req.user.mobile_number)
      .eq('is_active', true)
      .maybeSingle();

    if (jeMapErr) throw jeMapErr;
    if (!jeMapping) {
      return res.status(400).json({ success: false, message: 'Junior Engineer has no active Zonal Office mapping.' });
    }
    const zo_user_id = jeMapping.zo_user_id;

    // 2. Determine if it is a back-dated submission
    const [year, month, day] = site_visit_date.split('-').map(Number);
    const inputDate = new Date(year, month - 1, day);
    
    const options = { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const [tYear, tMonth, tDay] = formatter.format(new Date()).split('-').map(Number);
    const todayDate = new Date(tYear, tMonth - 1, tDay);

    const isBackDate = inputDate < todayDate;
    if (isBackDate) {
      if (!remarks_after_site_visit || !remarks_after_site_visit.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Remarks are required for back-dated daily progress reports to explain the reason.'
        });
      }
    }

    // 3. Build insert payload (geo-fields frozen from projects_master snapshot)
    const insertPayload = {
      created_by: req.user.mobile_number,
      zo_user_id,
      work_order_no: work_order_no.trim(),
      state: project.state,
      district: project.district,
      area_code: project.zone, // maps projects_master.zone to area_code
      department: project.department,
      site_details: project.site_details,
      site_visit_date,
      work_progress_details: work_progress_details.trim(),
      physical_work_progress: Number(physical_work_progress), // already validated/rounded by Zod
      daily_site_photo_url: daily_site_photo_url.trim(),
      original_photo_filename: original_photo_filename?.trim() || null,
      remarks_after_site_visit: remarks_after_site_visit?.trim() || null,
      approval_status: 'Pending'
    };

    // 3. Perform insert and handle unique constraint violation
    const { data: newReport, error: insertErr } = await supabase
      .from('daily_progress_reports')
      .insert([insertPayload])
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: 'You have already submitted a daily progress report for this work order on the selected date.'
        });
      }
      throw insertErr;
    }

    if (isBackDate) {
      const { notifyZoAndHoBackdatedProgressSubmitted } = require('../services/telegram.service');
      notifyZoAndHoBackdatedProgressSubmitted(newReport).catch(err => {
        console.error(`[DAILY PROGRESS] Telegram notification failed: ${err.message}`);
      });
    }

    // Update daily streak
    try {
      const todayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
      const { data: userObj } = await supabase
        .from('authorised_users')
        .select('daily_streak, last_report_date')
        .eq('mobile_number', req.user.mobile_number)
        .maybeSingle();

      if (userObj) {
        let newStreak = userObj.daily_streak || 0;
        if (userObj.last_report_date !== todayISTStr) {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 1);
          const yesterdayISTStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(yesterday);

          if (userObj.last_report_date === yesterdayISTStr) {
            newStreak += 1;
          } else {
            newStreak = 1;
          }

          await supabase
            .from('authorised_users')
            .update({
              daily_streak: newStreak,
              last_report_date: todayISTStr
            })
            .eq('mobile_number', req.user.mobile_number);
        }
      }
    } catch (streakErr) {
      console.error('Failed to update daily streak:', streakErr);
    }

    return res.status(201).json({
      success: true,
      report: newReport,
      message: isBackDate
        ? 'Daily progress report created successfully (marked Pending for approval).'
        : 'Daily progress report created successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('createProgressReport failed:', error);
    } else {
      console.error(`createProgressReport failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to create progress report.' });
  }
}

/**
 * GET /api/v1/auth/daily-progress
 * List progress reports with role filtering, optional query filters, and pagination.
 */
async function getProgressReports(req, res) {
  try {
    const query = req.query || {};

    let dbQuery = supabase
      .from('daily_progress_reports')
      .select('*', { count: 'exact' });

    // Role-based record visibility
    if (req.user.role === 'je') {
      dbQuery = dbQuery.eq('created_by', req.user.mobile_number);
    } else if (req.user.role === 'zo') {
      const jeMobiles = await getMappedJeMobiles(req.user.mobile_number);
      dbQuery = dbQuery.in('created_by', jeMobiles.length > 0 ? jeMobiles : ['dummy_je_mobile']);
    } else {
      // HO/Admin can filter by created_by
      if (query.created_by) {
        dbQuery = dbQuery.eq('created_by', query.created_by.trim());
      }
    }

    // Apply optional filters
    if (query.work_order_no) {
      dbQuery = dbQuery.eq('work_order_no', query.work_order_no.trim());
    }

    if (query.date_from) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.date_from)) {
        dbQuery = dbQuery.gte('site_visit_date', query.date_from);
      }
    }

    if (query.date_to) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.date_to)) {
        dbQuery = dbQuery.lte('site_visit_date', query.date_to);
      }
    }

    // Order: site_visit_date DESC, then created_at DESC
    dbQuery = dbQuery
      .order('site_visit_date', { ascending: false })
      .order('created_at', { ascending: false });

    // Pagination
    const page = Math.max(parseInt(query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(query.limit) || 20, 1), 100);
    const offset = (page - 1) * limit;

    const { data: reports, count, error } = await dbQuery.range(offset, offset + limit - 1);
    if (error) throw error;

    // Resolve display names
    const enriched = [];
    if (reports && reports.length > 0) {
      const mobiles = [];
      reports.forEach(r => {
        mobiles.push(r.created_by);
        mobiles.push(r.approved_user_id);
      });
      const userMap = await resolveDisplayNames(mobiles);

      reports.forEach(r => {
        enriched.push({
          ...r,
          created_by_name: userMap[r.created_by] || r.created_by || null,
          approved_by_name: userMap[r.approved_user_id] || r.approved_user_id || null
        });
      });
    }

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      reports: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getProgressReports failed:', error);
    } else {
      console.error(`getProgressReports failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve progress reports.' });
  }
}

/**
 * GET /api/v1/auth/daily-progress/:id
 * Retrieve a single progress report by ID.
 */
async function getProgressReportById(req, res) {
  if (!validate(req, res, getReportByIdSchema)) return;

  const { id } = req.params;

  try {
    const { data: report, error } = await supabase
      .from('daily_progress_reports')
      .select('*')
      .eq('report_id', id)
      .maybeSingle();

    if (error) throw error;
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    // Visibility gate: JE can only view their own reports, ZO own zone
    if (req.user.role === 'je' && report.created_by !== req.user.mobile_number) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    if (req.user.role === 'zo') {
      const jeMobiles = await getMappedJeMobiles(req.user.mobile_number);
      if (!jeMobiles.includes(report.created_by)) {
        return res.status(404).json({ success: false, message: 'Report not found.' });
      }
    }

    // Resolve display names
    const userMap = await resolveDisplayNames([report.created_by, report.approved_user_id]);

    // Generate signed URL (1 hour validity)
    let photo_signed_url = null;
    if (report.daily_site_photo_url) {
      const { data: signData } = await supabase.storage
        .from('daily-progress-photos')
        .createSignedUrl(report.daily_site_photo_url, 3600);
      photo_signed_url = signData?.signedUrl || null;
    }

    return res.status(200).json({
      success: true,
      report: {
        ...report,
        created_by_name: userMap[report.created_by] || report.created_by || null,
        approved_by_name: userMap[report.approved_user_id] || report.approved_user_id || null,
        photo_signed_url
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getProgressReportById failed:', error);
    } else {
      console.error(`getProgressReportById failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve progress report.' });
  }
}

/**
 * PATCH /api/v1/auth/daily-progress/:id/remarks
 * Adds or overwrites authority remarks (ZO/HO/Admin only).
 */
async function addAuthorityRemarks(req, res) {
  if (!validate(req, res, addRemarksSchema)) return;

  const { id } = req.params;
  const { remarks_approved_authority, action } = req.body;

  try {
    if (action && !['Approve', 'Reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Invalid action. Must be Approve or Reject.' });
    }

    // 1. Fetch report details
    const { data: report, error: fetchError } = await supabase
      .from('daily_progress_reports')
      .select('report_id, work_order_no, site_visit_date, created_by, zo_user_id')
      .eq('report_id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!report) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    // 2. Fetch parent project status
    const { data: project, error: projectErr } = await supabase
      .from('projects_master')
      .select('status')
      .eq('work_order_no', report.work_order_no)
      .maybeSingle();

    if (projectErr) throw projectErr;

    const ALLOWED_PROJECT_STATUSES = ['Running'];
    if (project && !ALLOWED_PROJECT_STATUSES.includes(project.status)) {
      return res.status(409).json({
        success: false,
        message: `Authority remarks cannot be added or modified for projects in ${project.status} status.`
      });
    }

    // ZO authorization guard
    if (req.user.role === 'zo') {
      const jeMobiles = await getMappedJeMobiles(req.user.mobile_number);
      if (!jeMobiles.includes(report.created_by)) {
        return res.status(403).json({ success: false, message: 'Access denied. You can only action reports for JEs mapped to your Zonal Office.' });
      }
    }

    // 3. Build update payload (overwrites previous remarks by design)
    const updatePayload = {
      remarks_approved_authority: remarks_approved_authority.trim(),
      approved_user_id: req.user.mobile_number,
      approval_date: new Date().toISOString()
    };

    if (action === 'Approve') {
      updatePayload.approval_status = 'Approved';
    } else if (action === 'Reject') {
      updatePayload.approval_status = 'Rejected';
    }

    // 4. Perform update
    const { data: updated, error: updateError } = await supabase
      .from('daily_progress_reports')
      .update(updatePayload)
      .eq('report_id', id)
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Report not found.' });
    }

    if (action) {
      const { notifyJeProgressActed } = require('../services/telegram.service');
      notifyJeProgressActed(report, updated).catch(err => {
        console.error(`[DAILY PROGRESS] Telegram action notification failed: ${err.message}`);
      });
    }

    return res.status(200).json({
      success: true,
      report: updated,
      message: 'Authority remarks saved successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('addAuthorityRemarks failed:', error);
    } else {
      console.error(`addAuthorityRemarks failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to save authority remarks.' });
  }
}

module.exports = {
  createProgressReport,
  getProgressReports,
  getProgressReportById,
  addAuthorityRemarks
};
