'use strict';

const { supabase } = require('../db/supabase');
const validate = require('../validation/validate');
const { createRequisitionSchema, actOnRequisitionSchema, cancelRequisitionSchema } = require('../validation/requisition.schema');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Display name resolver helper
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

/**
 * POST /api/v1/auth/requisitions
 * Creates a new requisition.
 */
async function createRequisition(req, res) {
  if (!validate(req, res, createRequisitionSchema)) return;

  const {
    work_order_no,
    requisition_no,
    material_main_head,
    requisition_pdf_url,
    original_filename,
    requisition_amount,
    gst_bill,
    gst_bill_pdf_url,
    bank_details,
    expen_head_remarks
  } = req.body;

  try {
    // 1. Unique check
    const { count, error: countError } = await supabase
      .from('requisitions')
      .select('requisition_no', { count: 'exact', head: true })
      .eq('requisition_no', requisition_no.trim());

    if (countError) throw countError;
    if (count && count > 0) {
      return res.status(409).json({
        success: false,
        message: `A requisition with number ${requisition_no.trim()} already exists.`
      });
    }

    // 2. Validate work_order_no exists and fetch details
    const { data: project, error: projectErr } = await supabase
      .from('projects_master')
      .select('estimate_no, state, district, zone, department, site_details')
      .eq('work_order_no', work_order_no.trim())
      .maybeSingle();

    if (projectErr) throw projectErr;
    if (!project) {
      return res.status(404).json({ success: false, message: 'Work order not found.' });
    }

    // 3. Fetch estimate_amount (snapshot) from Final Approved estimate
    const { data: estimate, error: estimateErr } = await supabase
      .from('project_cost_estimates')
      .select('estimate_amount')
      .eq('work_order_no', work_order_no.trim())
      .eq('estimate_status', 'Final Approved')
      .order('estimate_revision', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (estimateErr) throw estimateErr;
    const estimateAmount = estimate ? Number(estimate.estimate_amount) : null;

    // 4. Validate material_main_head exists in Material Master
    const { data: materialExists, error: materialErr } = await supabase
      .from('material_master')
      .select('Material_Main_Head')
      .eq('Material_Main_Head', material_main_head.trim())
      .limit(1)
      .maybeSingle();

    if (materialErr) throw materialErr;
    if (!materialExists) {
      return res.status(400).json({
        success: false,
        message: `material_main_head '${material_main_head}' does not exist in Material Master.`
      });
    }

    // 5. Remaining Estimate Amount budget validation
    let remainingAmount = null;
    let committed = 0;
    if (estimateAmount !== null) {
      const { data: committedRes, error: committedErr } = await supabase
        .from('requisitions')
        .select('requisition_amount')
        .eq('work_order_no', work_order_no.trim())
        .neq('requisition_status', 'Cancelled');

      if (committedErr) throw committedErr;

      committed = (committedRes || []).reduce((sum, r) => sum + Number(r.requisition_amount), 0);
      remainingAmount = estimateAmount - committed;

      if (Number(requisition_amount) > remainingAmount) {
        return res.status(422).json({
          success: false,
          message: `Requisition amount exceeds the remaining estimate balance. Estimate Amount: ₹${estimateAmount.toLocaleString('en-IN')}. Already Committed: ₹${committed.toLocaleString('en-IN')}. Remaining: ₹${remainingAmount.toLocaleString('en-IN')}. Your Request: ₹${Number(requisition_amount).toLocaleString('en-IN')}.`
        });
      }
    }

    // 6. Build insert payload and insert
    const { data: newReq, error: insertErr } = await supabase
      .from('requisitions')
      .insert([{
        requester_user_id: req.user.mobile_number,
        work_order_no: work_order_no.trim(),
        estimate_no: project.estimate_no,
        estimate_amount: estimateAmount,
        state: project.state,
        district: project.district,
        area_code: project.zone,
        department: project.department,
        site_details: project.site_details,
        requisition_no: requisition_no.trim(),
        material_main_head: material_main_head.trim(),
        requisition_pdf_url: requisition_pdf_url.trim(),
        original_filename: original_filename?.trim() || null,
        requisition_amount: Number(requisition_amount),
        gst_bill,
        gst_bill_pdf_url: gst_bill === 'Yes' ? gst_bill_pdf_url.trim() : null,
        bank_details: bank_details.trim(),
        expen_head_remarks: expen_head_remarks?.trim() || null,
        requisition_status: 'Pending',
        created_by: req.user.mobile_number
      }])
      .select()
      .single();

    if (insertErr) {
      if (insertErr.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `A requisition with number ${requisition_no.trim()} already exists.`
        });
      }
      throw insertErr;
    }

    const resRemaining = remainingAmount !== null ? remainingAmount - Number(requisition_amount) : null;

    return res.status(201).json({
      success: true,
      requisition: newReq,
      estimateAmount: estimateAmount,
      committedAmount: committed + Number(requisition_amount),
      remainingAmount: resRemaining,
      remainingAmountAfter: resRemaining,
      message: 'Requisition created successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('createRequisition failed:', error);
    } else {
      console.error(`createRequisition failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to create requisition.' });
  }
}

/**
 * GET /api/v1/auth/requisitions
 * Retrieves a list of requisitions with role filtering and pagination.
 */
async function getRequisitions(req, res) {
  try {
    const query = req.query || {};
    const hasPagination = query.page !== undefined || query.limit !== undefined;

    let dbQuery = supabase
      .from('requisitions')
      .select('*', { count: 'exact' });

    if (req.user.role === 'je') {
      dbQuery = dbQuery.eq('requester_user_id', req.user.mobile_number);
    }

    if (query.status) {
      dbQuery = dbQuery.eq('requisition_status', query.status);
    }

    let result;
    let page = 1;
    let limit = 0;

    if (hasPagination) {
      page = Math.max(parseInt(query.page) || 1, 1);
      limit = Math.min(Math.max(parseInt(query.limit) || 50, 1), 100);
      const offset = (page - 1) * limit;
      result = await dbQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
    } else {
      result = await dbQuery.order('created_at', { ascending: false });
    }

    const { data: requisitions, count, error } = result;
    if (error) throw error;

    const enriched = [];
    if (requisitions && requisitions.length > 0) {
      const mobiles = [];
      requisitions.forEach(r => {
        mobiles.push(r.requester_user_id);
        mobiles.push(r.approved_user_id);
        mobiles.push(r.cancelled_by);
      });
      const userMap = await resolveDisplayNames(mobiles);

      for (const r of requisitions) {
        let remainingEstimateAmount = null;
        if (req.user.role === 'je' && r.estimate_amount !== null) {
          const { data: comm } = await supabase
            .from('requisitions')
            .select('requisition_amount')
            .eq('work_order_no', r.work_order_no)
            .neq('requisition_status', 'Cancelled');
          const commAmt = (comm || []).reduce((sum, item) => sum + Number(item.requisition_amount), 0);
          remainingEstimateAmount = Number(r.estimate_amount) - commAmt;
        }

        // Generate signed URLs dynamically
        let signedUrl = null;
        let gstSignedUrl = null;
        if (r.requisition_pdf_url) {
          const { data: signData } = await supabase.storage
            .from('requisition-pdfs')
            .createSignedUrl(r.requisition_pdf_url, 3600);
          signedUrl = signData?.signedUrl || null;
        }
        if (r.gst_bill_pdf_url) {
          const { data: signData } = await supabase.storage
            .from('gst-bills')
            .createSignedUrl(r.gst_bill_pdf_url, 3600);
          gstSignedUrl = signData?.signedUrl || null;
        }

        enriched.push({
          ...r,
          requester_name: userMap[r.requester_user_id] || r.requester_user_id || null,
          approved_name: userMap[r.approved_user_id] || r.approved_user_id || null,
          cancelled_name: userMap[r.cancelled_by] || r.cancelled_by || null,
          remainingEstimateAmount,
          requisition_pdf_signed_url: signedUrl,
          gst_bill_pdf_signed_url: gstSignedUrl
        });
      }
    }

    return res.status(200).json({
      success: true,
      requisitions: enriched,
      pagination: {
        page,
        limit: hasPagination ? limit : (count || enriched.length),
        total: count || 0,
        totalPages: hasPagination ? Math.ceil((count || 0) / limit) : 1
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getRequisitions failed:', error);
    } else {
      console.error(`getRequisitions failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisitions.' });
  }
}

/**
 * GET /api/v1/auth/requisitions/:id
 * Retrieves a single requisition by ID.
 */
async function getRequisitionById(req, res) {
  const { id } = req.params;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ success: false, message: 'Invalid requisition ID.' });
  }

  try {
    const { data: requisition, error } = await supabase
      .from('requisitions')
      .select('*')
      .eq('requisition_id', id)
      .maybeSingle();

    if (error) throw error;
    if (!requisition) {
      return res.status(404).json({ success: false, message: 'Requisition not found.' });
    }

    // Visibility gate
    if (req.user.role === 'je' && requisition.requester_user_id !== req.user.mobile_number) {
      return res.status(404).json({ success: false, message: 'Requisition not found.' });
    }

    const userMap = await resolveDisplayNames([
      requisition.requester_user_id,
      requisition.approved_user_id,
      requisition.cancelled_by
    ]);

    // Generate signed URLs
    let signedUrl = null;
    let gstSignedUrl = null;
    if (requisition.requisition_pdf_url) {
      const { data: signData } = await supabase.storage
        .from('requisition-pdfs')
        .createSignedUrl(requisition.requisition_pdf_url, 3600);
      signedUrl = signData?.signedUrl || null;
    }
    if (requisition.gst_bill_pdf_url) {
      const { data: signData } = await supabase.storage
        .from('gst-bills')
        .createSignedUrl(requisition.gst_bill_pdf_url, 3600);
      gstSignedUrl = signData?.signedUrl || null;
    }

    // Calculate remainingEstimateAmount
    let remainingEstimateAmount = null;
    if (requisition.estimate_amount !== null) {
      const { data: comm } = await supabase
        .from('requisitions')
        .select('requisition_amount')
        .eq('work_order_no', requisition.work_order_no)
        .neq('requisition_status', 'Cancelled');
      const commAmt = (comm || []).reduce((sum, item) => sum + Number(item.requisition_amount), 0);
      remainingEstimateAmount = Number(requisition.estimate_amount) - commAmt;
    }

    return res.status(200).json({
      success: true,
      requisition: {
        ...requisition,
        requester_name: userMap[requisition.requester_user_id] || requisition.requester_user_id || null,
        approved_name: userMap[requisition.approved_user_id] || requisition.approved_user_id || null,
        cancelled_name: userMap[requisition.cancelled_by] || requisition.cancelled_by || null,
        requisition_pdf_signed_url: signedUrl,
        gst_bill_pdf_signed_url: gstSignedUrl,
        remainingEstimateAmount
      }
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('getRequisitionById failed:', error);
    } else {
      console.error(`getRequisitionById failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to retrieve requisition.' });
  }
}

/**
 * PATCH /api/v1/auth/requisitions/:id/action
 * Approves or Holds a pending requisition.
 */
async function actOnRequisition(req, res) {
  if (!validate(req, res, actOnRequisitionSchema)) return;

  const { id } = req.params;
  const { action, approved_amount, remarks_approved_authority } = req.body;

  try {
    // 1. Fetch current requisition record
    const { data: reqRecord, error: fetchError } = await supabase
      .from('requisitions')
      .select('*')
      .eq('requisition_id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!reqRecord) {
      return res.status(404).json({ success: false, message: 'Requisition not found.' });
    }

    // 2. Status guard: must be Pending
    if (reqRecord.requisition_status !== 'Pending') {
      return res.status(403).json({
        success: false,
        message: `Action can only be taken on Pending requisitions. Current status: ${reqRecord.requisition_status}`
      });
    }

    let updatePayload = {
      approved_user_id: req.user.mobile_number,
      payment_date: new Date().toISOString(),
      remarks_approved_authority: remarks_approved_authority.trim()
    };

    if (action === 'Hold') {
      updatePayload.requisition_status = 'Hold';
      updatePayload.approve_type = 'Hold';
    }

    if (action === 'Approve') {
      const hoAmount = Number(approved_amount);
      if (hoAmount > Number(reqRecord.requisition_amount)) {
        return res.status(400).json({
          success: false,
          message: 'Approved amount cannot exceed requisition amount.'
        });
      }

      updatePayload.requisition_status = 'Approved';
      updatePayload.approve_type = 'Approve';
      updatePayload.approved_amount = hoAmount;
      updatePayload.approved_balance_amount = Number(reqRecord.requisition_amount) - hoAmount;
    }

    // 3. Perform update with optimistic lock
    const { data: updated, error: updateError } = await supabase
      .from('requisitions')
      .update(updatePayload)
      .eq('requisition_id', id)
      .eq('requisition_status', 'Pending')
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: The requisition status was already changed by another action.'
      });
    }

    return res.status(200).json({
      success: true,
      requisition: updated,
      message: `Requisition has been ${action === 'Approve' ? 'approved' : 'placed on hold'}.`
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('actOnRequisition failed:', error);
    } else {
      console.error(`actOnRequisition failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to process requisition action.' });
  }
}

/**
 * PATCH /api/v1/auth/requisitions/:id/cancel
 * Cancels a pending requisition.
 */
async function cancelRequisition(req, res) {
  if (!validate(req, res, cancelRequisitionSchema)) return;

  const { id } = req.params;

  try {
    const { data: reqRecord, error: fetchError } = await supabase
      .from('requisitions')
      .select('*')
      .eq('requisition_id', id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!reqRecord) {
      return res.status(404).json({ success: false, message: 'Requisition not found.' });
    }

    // Role ownership guard
    const isAdmin = req.user.role === 'admin';
    if (!isAdmin && reqRecord.requester_user_id !== req.user.mobile_number) {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only the JE who created this requisition can cancel it.'
      });
    }

    // Status guard
    if (reqRecord.requisition_status !== 'Pending') {
      return res.status(403).json({
        success: false,
        message: `Only Pending requisitions can be cancelled. Current status: ${reqRecord.requisition_status}`
      });
    }

    // Perform cancel with optimistic lock
    const { data: updated, error: updateError } = await supabase
      .from('requisitions')
      .update({
        requisition_status: 'Cancelled',
        cancelled_by: req.user.mobile_number,
        cancelled_at: new Date().toISOString()
      })
      .eq('requisition_id', id)
      .eq('requisition_status', 'Pending')
      .select()
      .maybeSingle();

    if (updateError) throw updateError;
    if (!updated) {
      return res.status(409).json({
        success: false,
        message: 'Conflict: The requisition was already acted upon.'
      });
    }

    return res.status(200).json({
      success: true,
      requisition: updated,
      message: 'Requisition cancelled successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('cancelRequisition failed:', error);
    } else {
      console.error(`cancelRequisition failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to cancel requisition.' });
  }
}

module.exports = {
  createRequisition,
  getRequisitions,
  getRequisitionById,
  actOnRequisition,
  cancelRequisition
};
