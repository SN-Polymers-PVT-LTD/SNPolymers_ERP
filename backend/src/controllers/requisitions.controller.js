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

  const cleanupUploadedFiles = async () => {
    try {
      if (requisition_pdf_url) {
        await supabase.storage
          .from('requisition-pdfs')
          .remove([requisition_pdf_url]);
      }
      if (gst_bill === 'Yes' && gst_bill_pdf_url) {
        await supabase.storage
          .from('gst-bills')
          .remove([gst_bill_pdf_url]);
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to clean up files:', err);
      }
    }
  };

  try {
    // 1. Unique check
    const { count, error: countError } = await supabase
      .from('requisitions')
      .select('requisition_no', { count: 'exact', head: true })
      .eq('requisition_no', requisition_no.trim());

    if (countError) throw countError;
    if (count && count > 0) {
      await cleanupUploadedFiles();
      return res.status(409).json({
        success: false,
        message: `A requisition with number ${requisition_no.trim()} already exists.`
      });
    }

    // 1b. Verify JE is actively mapped to the work order
    const { data: woMapping, error: woMapErr } = await supabase
      .from('work_order_mappings')
      .select('id')
      .eq('work_order_no', work_order_no.trim())
      .eq('je_user_id', req.user.mobile_number)
      .eq('is_active', true)
      .maybeSingle();

    if (woMapErr) throw woMapErr;
    if (!woMapping) {
      await cleanupUploadedFiles();
      return res.status(403).json({ success: false, message: 'You are not assigned to this Work Order.' });
    }

    // 1c. Fetch JE's active Zonal Office mapping
    const { data: jeMapping, error: jeMapErr } = await supabase
      .from('je_zo_mappings')
      .select('zo_user_id')
      .eq('je_user_id', req.user.mobile_number)
      .eq('is_active', true)
      .maybeSingle();

    if (jeMapErr) throw jeMapErr;
    if (!jeMapping) {
      await cleanupUploadedFiles();
      return res.status(400).json({ success: false, message: 'Junior Engineer has no active Zonal Office mapping.' });
    }
    const zo_user_id = jeMapping.zo_user_id;

    // 2. Validate work_order_no exists and fetch details
    const { data: project, error: projectErr } = await supabase
      .from('projects_master')
      .select('estimate_no, state, district, zone, department, site_details')
      .eq('work_order_no', work_order_no.trim())
      .maybeSingle();

    if (projectErr) throw projectErr;
    if (!project) {
      await cleanupUploadedFiles();
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
      await cleanupUploadedFiles();
      return res.status(400).json({
        success: false,
        message: `material_main_head '${material_main_head}' does not exist in Material Master.`
      });
    }

    // 5. Call the transactional RPC create_requisition_secure to insert atomically with lock and budget check
    const { data: newReq, error: rpcError } = await supabase.rpc('create_requisition_secure', {
      p_requester_user_id: req.user.mobile_number,
      p_work_order_no: work_order_no.trim(),
      p_estimate_no: project.estimate_no,
      p_estimate_amount: estimateAmount,
      p_state: project.state,
      p_district: project.district,
      p_area_code: project.zone,
      p_department: project.department,
      p_site_details: project.site_details,
      p_requisition_no: requisition_no.trim(),
      p_material_main_head: material_main_head.trim(),
      p_requisition_pdf_url: requisition_pdf_url.trim(),
      p_original_filename: original_filename?.trim() || null,
      p_requisition_amount: Number(requisition_amount),
      p_gst_bill: gst_bill,
      p_gst_bill_pdf_url: gst_bill === 'Yes' ? gst_bill_pdf_url.trim() : null,
      p_bank_details: bank_details.trim(),
      p_expen_head_remarks: expen_head_remarks?.trim() || null,
      p_requisition_status: 'Pending',
      p_created_by: req.user.mobile_number
    });

    if (rpcError) {
      await cleanupUploadedFiles();
      if (rpcError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `A requisition with number ${requisition_no.trim()} already exists.`
        });
      }
      if (rpcError.code === 'BUD01' || rpcError.message?.includes('exceeds the remaining estimate balance')) {
        const { data: committedRes } = await supabase
          .from('requisitions')
          .select('requisition_amount, requisition_status, approved_amount')
          .eq('work_order_no', work_order_no.trim())
          .neq('requisition_status', 'Cancelled');
        const committedAmt = (committedRes || []).reduce((sum, r) => {
          if (r.requisition_status === 'Approved') {
            return sum + Number(r.approved_amount !== null && r.approved_amount !== undefined ? r.approved_amount : r.requisition_amount);
          }
          return sum + Number(r.requisition_amount);
        }, 0);
        const remainingAmt = estimateAmount - committedAmt;
        
        return res.status(422).json({
          success: false,
          message: `Requisition amount exceeds the remaining estimate balance. Estimate Amount: ₹${estimateAmount.toLocaleString('en-IN')}. Already Committed: ₹${committedAmt.toLocaleString('en-IN')}. Remaining: ₹${remainingAmt.toLocaleString('en-IN')}. Your Request: ₹${Number(requisition_amount).toLocaleString('en-IN')}.`
        });
      }
      if (rpcError.code === 'PR001' || rpcError.message?.includes('Closed')) {
        return res.status(403).json({
          success: false,
          message: 'Cannot create requisitions for projects with "Closed" status. All linked reports are immutable.'
        });
      }
      throw rpcError;
    }

    // Set zo_user_id in database
    const { error: updateZoErr } = await supabase
      .from('requisitions')
      .update({ zo_user_id })
      .eq('requisition_id', newReq.requisition_id);

    if (updateZoErr) throw updateZoErr;
    newReq.zo_user_id = zo_user_id;

    // 6. Calculate remaining amount for response
    const { data: committedRes } = await supabase
      .from('requisitions')
      .select('requisition_amount, requisition_status, approved_amount')
      .eq('work_order_no', work_order_no.trim())
      .neq('requisition_status', 'Cancelled');
    const committedAmt = (committedRes || []).reduce((sum, r) => {
      if (r.requisition_status === 'Approved') {
        return sum + Number(r.approved_amount !== null && r.approved_amount !== undefined ? r.approved_amount : r.requisition_amount);
      }
      return sum + Number(r.requisition_amount);
    }, 0);
    const resRemaining = estimateAmount !== null ? estimateAmount - committedAmt : null;

    const { notifyZoRequisitionSubmitted, notifyHoRequisitionSubmitted } = require('../services/telegram.service');
    notifyZoRequisitionSubmitted(newReq).catch(err => {
      console.error(`[REQUISITION] Telegram notification failed: ${err.message}`);
    });
    notifyHoRequisitionSubmitted(newReq).catch(err => {
      console.error(`[REQUISITION] Telegram notification to HO failed: ${err.message}`);
    });

    return res.status(201).json({
      success: true,
      requisition: newReq,
      estimateAmount: estimateAmount,
      committedAmount: committedAmt,
      remainingAmount: resRemaining,
      remainingAmountAfter: resRemaining,
      message: 'Requisition created successfully.'
    });

  } catch (error) {
    await cleanupUploadedFiles();
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

    if (req.user.role === 'zo') {
      dbQuery = dbQuery.eq('zo_user_id', req.user.mobile_number);
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
            .select('requisition_amount, requisition_status, approved_amount')
            .eq('work_order_no', r.work_order_no)
            .neq('requisition_status', 'Cancelled');
          const commAmt = (comm || []).reduce((sum, item) => {
            if (item.requisition_status === 'Approved') {
              return sum + Number(item.approved_amount !== null && item.approved_amount !== undefined ? item.approved_amount : item.requisition_amount);
            }
            return sum + Number(item.requisition_amount);
          }, 0);
          remainingEstimateAmount = Number(r.estimate_amount) - commAmt;
        }

        enriched.push({
          ...r,
          requester_name: userMap[r.requester_user_id] || r.requester_user_id || null,
          approved_name: userMap[r.approved_user_id] || r.approved_user_id || null,
          cancelled_name: userMap[r.cancelled_by] || r.cancelled_by || null,
          remainingEstimateAmount,
          requisition_pdf_signed_url: null,
          gst_bill_pdf_signed_url: null
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

    if (req.user.role === 'zo' && requisition.zo_user_id !== req.user.mobile_number) {
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
        .select('requisition_amount, requisition_status, approved_amount')
        .eq('work_order_no', requisition.work_order_no)
        .neq('requisition_status', 'Cancelled');
      const commAmt = (comm || []).reduce((sum, item) => {
        if (item.requisition_status === 'Approved') {
          return sum + Number(item.approved_amount !== null && item.approved_amount !== undefined ? item.approved_amount : item.requisition_amount);
        }
        return sum + Number(item.requisition_amount);
      }, 0);
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

    // ZO validation guard
    if (req.user.role === 'zo' && reqRecord.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only action requisitions within your Zonal Office.' });
    }

    let updated;

    if (action === 'Hold') {
      let updatePayload = {
        approved_user_id: req.user.mobile_number,
        payment_date: new Date().toISOString(),
        remarks_approved_authority: remarks_approved_authority.trim(),
        requisition_status: 'Hold',
        approve_type: 'Hold'
      };

      const { data: heldReq, error: updateError } = await supabase
        .from('requisitions')
        .update(updatePayload)
        .eq('requisition_id', id)
        .in('requisition_status', ['Pending', 'Hold'])
        .select()
        .maybeSingle();

      if (updateError) throw updateError;
      if (!heldReq) {
        return res.status(409).json({
          success: false,
          message: 'Conflict: The requisition status was already changed by another action.'
        });
      }
      updated = heldReq;
    }

    if (action === 'Approve') {
      const hoAmount = Number(approved_amount);
      if (hoAmount > Number(reqRecord.requisition_amount)) {
        return res.status(400).json({
          success: false,
          message: 'Approved amount cannot exceed requisition amount.'
        });
      }

      // Call transactional RPC
      const { data: approvedReq, error: rpcErr } = await supabase.rpc('approve_requisition_transact', {
        p_requisition_id: id,
        p_approved_amount: hoAmount,
        p_actioned_by: req.user.mobile_number,
        p_remarks_approved_authority: remarks_approved_authority.trim()
      });

      if (rpcErr) {
        if (rpcErr.message && rpcErr.message.includes('Insufficient available balance')) {
          return res.status(422).json({ success: false, message: 'Insufficient available balance.' });
        }
        throw rpcErr;
      }
      updated = approvedReq;
    }

    const { notifyJeRequisitionActed, notifyZoAndHoRequisitionActed } = require('../services/telegram.service');
    notifyJeRequisitionActed(reqRecord, updated).catch(err => {
      console.error(`[REQUISITION] Telegram notification failed: ${err.message}`);
    });
    notifyZoAndHoRequisitionActed(reqRecord, updated).catch(err => {
      console.error(`[REQUISITION] Telegram ZO/HO notification failed: ${err.message}`);
    });

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
    if (reqRecord.requisition_status !== 'Pending' && reqRecord.requisition_status !== 'Hold') {
      return res.status(403).json({
        success: false,
        message: `Only Pending or Hold requisitions can be cancelled. Current status: ${reqRecord.requisition_status}`
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
      .in('requisition_status', ['Pending', 'Hold'])
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
