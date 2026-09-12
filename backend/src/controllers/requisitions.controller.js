'use strict';

const crypto = require('crypto');
const { supabase } = require('../db/supabase');
const { computeMainHeadCapacity, computeSubcontractorCapacity } = require('../services/mainHeadCapacity.service');
const { getActiveIndianBanks, validateActiveIndianBank, invalidateBankCache } = require('../services/indianBanks.service');
const { BeneficiaryValidationError, resolveBeneficiaryBank, upsertProjectsBeneficiary: upsertSharedBeneficiary } = require('../services/beneficiaryMaster.service');
const validate = require('../validation/validate');
const {
  createRequisitionSchema, actOnRequisitionSchema, cancelRequisitionSchema, adjustSubcontractorBalanceSchema,
  payFromZoBalanceSchema, sendToAccountsSchema, upsertProjectsBeneficiarySchema, upsertIndianBankSchema
} = require('../validation/requisition.schema');

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
    material_sub_head,
    material_details,
    requisition_pdf_attachment_id,
    gst_bill_pdf_attachment_id,
    original_filename,
    requisition_amount,
    gst_bill,
    bank_details,
    beneficiary_id,
    beneficiary_name,
    beneficiary_ac_no,
    beneficiary_ifsc,
    beneficiary_bank_name,
    beneficiary_bank_id,
    expen_head_remarks
  } = req.body;

  // Populated once the corresponding attachment is resolved (step 0 below). Only ever
    // holds attachments this request has actually claimed the right to use — cleanup never
    // touches storage/rows it hasn't verified ownership of.
    let resolvedReqPdf = null; // { attachmentId, storagePath, uploadedBy }
    let resolvedGstPdf = null; // { attachmentId, storagePath, uploadedBy }

  const cleanupUploadedFiles = async () => {
    try {
      if (resolvedReqPdf) {
        await supabase.storage.from('requisition-pdfs').remove([resolvedReqPdf.storagePath]);
        await supabase
          .from('requisition_attachments')
          .delete()
          .eq('attachment_id', resolvedReqPdf.attachmentId)
          .eq('uploaded_by', resolvedReqPdf.uploadedBy)
          .eq('status', 'pending');
      }
      if (resolvedGstPdf) {
        await supabase.storage.from('gst-bills').remove([resolvedGstPdf.storagePath]);
        await supabase
          .from('requisition_attachments')
          .delete()
          .eq('attachment_id', resolvedGstPdf.attachmentId)
          .eq('uploaded_by', resolvedGstPdf.uploadedBy)
          .eq('status', 'pending');
      }
    } catch (err) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('Failed to clean up files:', err);
      }
    }
  };

  let rowCommitted = false;

  try {
    // 0. Resolve & validate the attachment(s) this request claims to use — must exist,
    //    belong to this user (or admin), still be unclaimed ('pending'), and be the right
    //    kind. This is what replaces trusting a raw, client-suppliable storage path string.
    const { data: reqAttachment, error: reqAttErr } = await supabase
      .from('requisition_attachments')
      .select('storage_path, kind, uploaded_by, status')
      .eq('attachment_id', requisition_pdf_attachment_id)
      .maybeSingle();
    if (reqAttErr) throw reqAttErr;
    if (
      !reqAttachment ||
      reqAttachment.kind !== 'requisition_pdf' ||
      reqAttachment.status !== 'pending' ||
      (reqAttachment.uploaded_by !== req.user.mobile_number && req.user.role !== 'admin')
    ) {
      return res.status(400).json({ success: false, message: 'Invalid or already-used requisition PDF attachment. Please re-upload.' });
    }
    resolvedReqPdf = {
      attachmentId: requisition_pdf_attachment_id,
      storagePath: reqAttachment.storage_path,
      uploadedBy: reqAttachment.uploaded_by
    };

    if (gst_bill === 'Yes') {
      const { data: gstAttachment, error: gstAttErr } = await supabase
        .from('requisition_attachments')
        .select('storage_path, kind, uploaded_by, status')
        .eq('attachment_id', gst_bill_pdf_attachment_id)
        .maybeSingle();
      if (gstAttErr) throw gstAttErr;
      if (
        !gstAttachment ||
        gstAttachment.kind !== 'gst_bill' ||
        gstAttachment.status !== 'pending' ||
        (gstAttachment.uploaded_by !== req.user.mobile_number && req.user.role !== 'admin')
      ) {
        await cleanupUploadedFiles();
        return res.status(400).json({ success: false, message: 'Invalid or already-used GST bill attachment. Please re-upload.' });
      }
      resolvedGstPdf = {
        attachmentId: gst_bill_pdf_attachment_id,
        storagePath: gstAttachment.storage_path,
        uploadedBy: gstAttachment.uploaded_by
      };
    }

    // 1. Unique check
    const { count, error: countError } = await supabase
      .from('requisitions')
      .select('requisition_no', { count: 'exact', head: true })
      .eq('requisition_no', requisition_no.trim())
      .neq('requisition_status', 'Cancelled');

    if (countError) throw countError;
    if (count && count > 0) {
      await cleanupUploadedFiles();
      return res.status(409).json({
        success: false,
        message: `A requisition with number ${requisition_no.trim()} already exists.`
      });
    }

    // 1a. Validate beneficiary_bank_id and resolve bank name snapshot
    let resolvedBankName, validatedBankId;
    try {
      ({ validatedBankId, resolvedBankName } = await resolveBeneficiaryBank(beneficiary_bank_id, beneficiary_bank_name));
    } catch (err) {
      if (err instanceof BeneficiaryValidationError) {
        await cleanupUploadedFiles();
        return res.status(err.status).json({ success: false, message: err.message });
      }
      throw err;
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

    if (material_main_head.trim() === 'Sub Contractor') {
      const { data: scExists, error: scErr } = await supabase
        .from('material_master')
        .select('id')
        .eq('Material_Main_Head', 'Sub Contractor')
        .eq('Material_Sub_Head', material_sub_head?.trim())
        .eq('Material_Details', material_details?.trim())
        .limit(1)
        .maybeSingle();
      if (scErr) throw scErr;
      if (!scExists) {
        await cleanupUploadedFiles();
        return res.status(400).json({
          success: false,
          message: `Subcontractor '${material_details}' under '${material_sub_head}' does not exist in Material Master.`
        });
      }
    }

    // Synthesize bank_details if not directly provided
    let effectiveBankDetails = (bank_details || '').trim();
    if (!effectiveBankDetails && (beneficiary_ac_no || beneficiary_name)) {
      effectiveBankDetails = [
        beneficiary_name?.trim(),
        beneficiary_ac_no?.trim() ? `A/C: ${beneficiary_ac_no.trim()}` : null,
        beneficiary_ifsc?.trim() ? `IFSC: ${beneficiary_ifsc.trim()}` : null,
        resolvedBankName ? `Bank: ${resolvedBankName}` : null
      ].filter(Boolean).join(' | ');
    }
    if (!effectiveBankDetails) {
      effectiveBankDetails = '—';
    }

    // 4c. Upsert into projects_beneficiary_master if account_no and ifsc provided
    const upsertedBeneficiaryId = await upsertSharedBeneficiary({
      acNo: beneficiary_ac_no,
      ifsc: beneficiary_ifsc,
      name: beneficiary_name,
      fallbackName: material_details,
      bankId: validatedBankId,
      bankName: resolvedBankName,
      actorMobile: req.user.mobile_number
    });
    const resolvedBeneficiaryId = upsertedBeneficiaryId || beneficiary_id || null;

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
      p_material_sub_head: material_sub_head?.trim() || null,
      p_material_details: material_details?.trim() || null,
      p_requisition_pdf_url: resolvedReqPdf.storagePath,
      p_original_filename: original_filename?.trim() || null,
      p_requisition_amount: Number(requisition_amount),
      p_gst_bill: gst_bill,
      p_gst_bill_pdf_url: gst_bill === 'Yes' ? resolvedGstPdf.storagePath : null,
      p_bank_details: effectiveBankDetails,
      p_expen_head_remarks: expen_head_remarks?.trim() || null,
      p_requisition_status: 'Pending',
      p_created_by: req.user.mobile_number,
      p_beneficiary_id: resolvedBeneficiaryId,
      p_beneficiary_name: beneficiary_name?.trim() || null,
      p_beneficiary_ac_no: beneficiary_ac_no?.trim() || null,
      p_beneficiary_ifsc: beneficiary_ifsc?.trim() || null,
      p_beneficiary_bank_name: resolvedBankName,
      p_beneficiary_bank_id: validatedBankId,
      p_zo_user_id: zo_user_id,
      p_requisition_pdf_attachment_id: requisition_pdf_attachment_id,
      p_gst_bill_pdf_attachment_id: gst_bill === 'Yes' ? gst_bill_pdf_attachment_id : null
    });

    if (rpcError) {
      if (rpcError.code === 'ATT01' || rpcError.message?.includes('attachment is invalid or no longer pending')) {
        // A concurrent submission may have claimed this attachment after the controller's
        // initial validation. Never clean it up here: it can now belong to that committed
        // requisition, and deleting its storage object would break the other record.
        return res.status(409).json({
          success: false,
          message: 'An uploaded attachment was changed or already used. Please re-upload and try again.'
        });
      }
      await cleanupUploadedFiles();
      if (rpcError.code === '23505') {
        return res.status(409).json({
          success: false,
          message: `A requisition with number ${requisition_no.trim()} already exists.`
        });
      }
      if (rpcError.code === 'BUD01' || rpcError.message?.includes('Main Head capacity') || rpcError.message?.includes('exceeds the remaining estimate balance')) {
        const capacity = await computeMainHeadCapacity(work_order_no.trim(), material_main_head.trim());

        return res.status(422).json({
          success: false,
          message: `Requisition amount exceeds the remaining Main Head capacity for '${material_main_head.trim()}'. Main Head Estimate: ₹${capacity.mainHeadEstimate.toLocaleString('en-IN')}. Cumulative ZO-Approved: ₹${capacity.cumulativeApproved.toLocaleString('en-IN')}. Remaining Capacity: ₹${capacity.remainingCapacity.toLocaleString('en-IN')}. Your Request: ₹${Number(requisition_amount).toLocaleString('en-IN')}.`
        });
      }
      if (rpcError.code === 'BUD03' || rpcError.message?.includes('Subcontractor Ledger balance')) {
        const capacity = await computeSubcontractorCapacity(work_order_no.trim(), material_sub_head.trim(), material_details.trim());
        return res.status(422).json({
          success: false,
          message: `Requisition amount exceeds the remaining Subcontractor Ledger balance for '${material_details.trim()}' (${material_sub_head.trim()}). Estimated Total: ₹${capacity.estimatedTotal.toLocaleString('en-IN')}. Paid So Far: ₹${capacity.paidTotal.toLocaleString('en-IN')}. Remaining Balance: ₹${capacity.availableBalance.toLocaleString('en-IN')}. Your Request: ₹${Number(requisition_amount).toLocaleString('en-IN')}.`
        });
      }
      if (rpcError.code === 'VAL01' || rpcError.message?.includes('material_sub_head and material_details are required')) {
        return res.status(400).json({
          success: false,
          message: 'material_sub_head and material_details are required for a Sub Contractor requisition.'
        });
      }
      if (rpcError.code === 'EST02' || rpcError.code === 'EST01') {
        return res.status(422).json({
          success: false,
          code: rpcError.code,
          message: rpcError.message
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

    // The row is now durably committed by the RPC — any failure from here on must NOT
    // trigger cleanupUploadedFiles(), since the requisition already references these files.
    rowCommitted = true;

    // zo_user_id is now set atomically inside create_requisition_secure (p_zo_user_id
    // above) — newReq.zo_user_id is already populated from the RPC's RETURNING row.

    if (validatedBankId) {
      newReq.beneficiary_bank = { id: validatedBankId, bank_name: resolvedBankName };
      newReq.beneficiary_bank_id = validatedBankId;
      newReq.beneficiary_bank_name = resolvedBankName;
    }

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

    // Resolve Main Head capacity metrics
    const {
      mainHeadEstimate,
      cumulativeApproved,
      remainingCapacity
    } = await computeMainHeadCapacity(work_order_no.trim(), material_main_head.trim());

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
      mainHeadEstimate,
      cumulativeApproved,
      remainingCapacity,
      message: 'Requisition created successfully.'
    });

  } catch (error) {
    if (!rowCommitted) {
      await cleanupUploadedFiles();
    }
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
        mobiles.push(r.zo_user_id);
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
          beneficiary_bank: r.beneficiary_bank_id ? {
            id: r.beneficiary_bank_id,
            bank_name: r.beneficiary_bank_name
          } : null,
          requester_name: userMap[r.requester_user_id] || r.requester_user_id || null,
          approved_name: userMap[r.approved_user_id] || r.approved_user_id || null,
          zo_name: userMap[r.zo_user_id] || userMap[r.approved_user_id] || r.zo_user_id || null,
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

    if (req.user.role === 'zo' && requisition.zo_user_id !== req.user.mobile_number) {
      return res.status(404).json({ success: false, message: 'Requisition not found.' });
    }

    const userMap = await resolveDisplayNames([
      requisition.requester_user_id,
      requisition.approved_user_id,
      requisition.zo_user_id,
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

    // If this requisition was routed to Accounts, resolve the destination sheet
    // so the frontend can deep-link straight to it.
    let accountsSheet = null;
    if (requisition.accounts_line_item_id) {
      const { data: lineItem } = await supabase
        .from('acct_requisition_line_items')
        .select('sheet_id, acct_requisition_sheets(id, sheet_number)')
        .eq('id', requisition.accounts_line_item_id)
        .maybeSingle();
      if (lineItem?.acct_requisition_sheets) {
        accountsSheet = {
          sheet_id: lineItem.acct_requisition_sheets.id,
          sheet_number: lineItem.acct_requisition_sheets.sheet_number
        };
      }
    }

    return res.status(200).json({
      success: true,
      requisition: {
        ...requisition,
        beneficiary_bank: requisition.beneficiary_bank_id ? {
          id: requisition.beneficiary_bank_id,
          bank_name: requisition.beneficiary_bank_name
        } : null,
        requester_name: userMap[requisition.requester_user_id] || requisition.requester_user_id || null,
        approved_name: userMap[requisition.approved_user_id] || requisition.approved_user_id || null,
        zo_name: userMap[requisition.zo_user_id] || userMap[requisition.approved_user_id] || requisition.zo_user_id || null,
        cancelled_name: userMap[requisition.cancelled_by] || requisition.cancelled_by || null,
        requisition_pdf_signed_url: signedUrl,
        gst_bill_pdf_signed_url: gstSignedUrl,
        remainingEstimateAmount,
        accounts_sheet: accountsSheet
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
        if (rpcErr.code === 'BAL01' || rpcErr.message?.includes('Insufficient available Zonal Office balance') || rpcErr.message?.includes('Insufficient available balance')) {
          return res.status(422).json({ success: false, message: 'Insufficient available Zonal Office balance.' });
        }
        if (rpcErr.code === 'BUD02' || rpcErr.message?.includes('exceeds the remaining Main Head capacity')) {
          return res.status(422).json({ success: false, message: rpcErr.message });
        }
        if (rpcErr.code === 'BUD04' || rpcErr.message?.includes('exceeds the remaining Subcontractor Ledger balance')) {
          return res.status(422).json({ success: false, message: rpcErr.message });
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
 * POST /api/v1/auth/requisitions/:id/pay-from-zo-balance
 * Selects the ZO Balance payment route for an Approved requisition - debits
 * the ZO's zo_balances float and writes a zo_fund_ledger entry (the logic
 * that used to run unconditionally inside approve_requisition_transact).
 */
async function payFromZoBalance(req, res) {
  if (!validate(req, res, payFromZoBalanceSchema)) return;

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

    if (req.user.role === 'zo' && reqRecord.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only action requisitions within your Zonal Office.' });
    }

    const { data: updated, error: rpcErr } = await supabase.rpc('select_zo_balance_payment_transact', {
      p_requisition_id: id,
      p_actioned_by: req.user.mobile_number
    });

    if (rpcErr) {
      if (rpcErr.code === 'BAL01' || rpcErr.message?.includes('Insufficient available Zonal Office balance')) {
        return res.status(422).json({ success: false, message: 'Insufficient available Zonal Office balance.' });
      }
      if (rpcErr.code === 'STA01') {
        return res.status(409).json({ success: false, message: rpcErr.message });
      }
      if (rpcErr.code === 'RTE01') {
        return res.status(409).json({ success: false, message: rpcErr.message });
      }
      if (rpcErr.code === 'P0002' || rpcErr.message?.includes('not found')) {
        return res.status(404).json({ success: false, message: rpcErr.message });
      }
      throw rpcErr;
    }

    return res.status(200).json({
      success: true,
      requisition: updated,
      message: 'Requisition will be paid from the Zonal Office balance.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('payFromZoBalance failed:', error);
    } else {
      console.error(`payFromZoBalance failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to select the ZO Balance payment route.' });
  }
}

/**
 * POST /api/v1/auth/requisitions/:id/send-to-accounts
 * Selects the Accounts payment route for an Approved requisition - creates an
 * Accounts line item (in an Open acct_requisition_sheets row) prefilled from
 * Finance data. Accounts fills in the debit account, payment mode, and cheque
 * details afterward through the existing line-item edit flow.
 */
async function sendToAccounts(req, res) {
  if (!validate(req, res, sendToAccountsSchema)) return;

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

    if (req.user.role === 'zo' && reqRecord.zo_user_id !== req.user.mobile_number) {
      return res.status(403).json({ success: false, message: 'Access denied. You can only action requisitions within your Zonal Office.' });
    }

    const { data, error: rpcErr } = await supabase.rpc('route_requisition_to_accounts_transact', {
      p_requisition_id: id,
      p_actor: req.user.mobile_number
    });

    if (rpcErr) {
      if (rpcErr.code === 'STA01') {
        return res.status(409).json({ success: false, message: rpcErr.message });
      }
      if (rpcErr.code === 'RTE01') {
        return res.status(409).json({ success: false, message: rpcErr.message });
      }
      if (rpcErr.code === 'P0002' || rpcErr.message?.includes('not found')) {
        return res.status(404).json({ success: false, message: rpcErr.message });
      }
      throw rpcErr;
    }

    return res.status(200).json({
      success: true,
      requisition: data.requisition,
      message: 'Requisition sent to Accounts.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('sendToAccounts failed:', error);
    } else {
      console.error(`sendToAccounts failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to send the requisition to Accounts.' });
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

    const { data: attachments, error: attachmentError } = await supabase
      .from('requisition_attachments')
      .select('attachment_id, bucket, storage_path')
      .eq('requisition_id', id)
      .eq('status', 'committed');
    if (attachmentError) throw attachmentError;

    // Mark the row cancelled and clear references before external storage work.
    // Storage deletion is retried per attachment below; the cancelled row remains
    // safe to retry and never points at a file that should be used operationally.
    const { data: updated, error: updateError } = await supabase
      .from('requisitions')
      .update({
        requisition_status: 'Cancelled',
        cancelled_by: req.user.mobile_number,
        cancelled_at: new Date().toISOString(),
        requisition_pdf_url: null,
        gst_bill_pdf_url: null
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

    const cleanupFailures = [];
    for (const attachment of attachments || []) {
      const { error: removeError } = await supabase.storage
        .from(attachment.bucket)
        .remove([attachment.storage_path]);
      if (removeError) {
        cleanupFailures.push({ attachment_id: attachment.attachment_id, error: removeError.message });
        continue;
      }
      const { error: deleteError } = await supabase
        .from('requisition_attachments')
        .delete()
        .eq('attachment_id', attachment.attachment_id)
        .eq('requisition_id', id);
      if (deleteError) cleanupFailures.push({ attachment_id: attachment.attachment_id, error: deleteError.message });
    }

    return res.status(200).json({
      success: true,
      requisition: updated,
      message: cleanupFailures.length
        ? 'Requisition cancelled; some attachment cleanup will require retry.'
        : 'Requisition cancelled successfully.',
      cleanup_pending: cleanupFailures.length > 0
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

/**
 * GET /api/v1/auth/requisitions/capacity
 * Fetches current Main Head Estimated Amount, Total ZO-Approved Amount, and Remaining Main Head Capacity.
 */
async function getMainHeadCapacity(req, res) {
  const { work_order_no, material_main_head } = req.query;

  if (!work_order_no || !material_main_head) {
    return res.status(400).json({
      success: false,
      message: 'work_order_no and material_main_head query parameters are required.'
    });
  }

  try {
    const capacity = await computeMainHeadCapacity(work_order_no, material_main_head);

    return res.status(200).json({
      success: true,
      mainHeadEstimate: capacity.mainHeadEstimate,
      cumulativeApproved: capacity.cumulativeApproved,
      remainingCapacity: capacity.remainingCapacity,
      estimateLifecycle: capacity.estimateLifecycle
    });
  } catch (error) {
    console.error(`getMainHeadCapacity failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to retrieve Main Head capacity.'
    });
  }
}

/**
 * GET /api/v1/auth/requisitions/subcontractor-capacity
 * Fetches current Estimated Total, Paid So Far, and Remaining Balance for a
 * (work_order_no, material_sub_head, material_details) Subcontractor Ledger
 * entry, read straight from subcontractor_balances (a persisted cache, not
 * a live SUM — unlike computeMainHeadCapacity, this balance must survive an
 * estimate reopen, during which there is briefly no 'Final Approved'
 * estimate row for the work order to sum from).
 */
async function getSubcontractorCapacity(req, res) {
  const { work_order_no, material_sub_head, material_details } = req.query;

  if (!work_order_no || !material_sub_head || !material_details) {
    return res.status(400).json({
      success: false,
      message: 'work_order_no, material_sub_head, and material_details query parameters are required.'
    });
  }

  try {
    const capacity = await computeSubcontractorCapacity(work_order_no, material_sub_head, material_details);
    return res.status(200).json({ success: true, ...capacity });
  } catch (error) {
    console.error(`getSubcontractorCapacity failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Subcontractor Ledger capacity.' });
  }
}

/**
 * GET /api/v1/auth/requisitions/subcontractor-ledger
 * Browse view over subcontractor_balances (047_subcontractor_ledger.sql) —
 * one row per (work_order_no, material_sub_head, material_details), i.e.
 * per subcontractor-on-a-work-order. Optional work_order_no filter and a
 * free-text search over sub head / subcontractor name. Enriched with each
 * work order's department/site_details for display, the same shape
 * getCreditLedger uses for its beneficiary/source enrichment.
 */
async function getSubcontractorLedger(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page) || 1, 1);
    let limit = parseInt(query.limit) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('subcontractor_balance_summary')
      .select('*', { count: 'exact' });

    if (query.work_order_no) {
      dbQuery = dbQuery.eq('work_order_no', query.work_order_no.trim());
    }

    if (query.search) {
      const s = query.search.trim().replace(/[,()]/g, ' ').trim();
      if (s) {
        dbQuery = dbQuery.or(`material_details.ilike.%${s}%,material_sub_head.ilike.%${s}%,work_order_no.ilike.%${s}%`);
      }
    }

    dbQuery = dbQuery.order('updated_at', { ascending: false }).range(offset, offset + limit - 1);

    const { data: balances, count, error } = await dbQuery;
    if (error) throw error;

    const workOrderNos = [...new Set((balances || []).map(b => b.work_order_no))];
    let projectMap = {};
    if (workOrderNos.length > 0) {
      const { data: projects } = await supabase
        .from('projects_master')
        .select('work_order_no, department, site_details')
        .in('work_order_no', workOrderNos);
      projectMap = (projects || []).reduce((acc, p) => { acc[p.work_order_no] = p; return acc; }, {});
    }

    const enriched = (balances || []).map(b => ({
      ...b,
      project: projectMap[b.work_order_no] || null
    }));

    return res.status(200).json({
      success: true,
      balances: enriched,
      pagination: { page, limit, total: count || 0, totalPages: Math.max(Math.ceil((count || 0) / limit), 1) }
    });
  } catch (error) {
    console.error(`getSubcontractorLedger failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Subcontractor Ledger.' });
  }
}

/**
 * GET /api/v1/auth/requisitions/subcontractor-ledger/entries
 * The append-only transaction trail (subcontractor_ledger) — every credit
 * (estimate item HO approval), debit (requisition approval), and administrative
 * adjustment, newest first, with actor names, requisition numbers, remarks,
 * credit/debit breakdown, and chronological running balances.
 * Supports filtering by work_order_no, material_sub_head, material_details,
 * search term, and date range.
 */
async function getSubcontractorLedgerEntries(req, res) {
  const { work_order_no, material_sub_head, material_details, search, date_from, date_to } = req.query || {};

  try {
    let dbQuery = supabase
      .from('subcontractor_ledger')
      .select('*')
      .eq('ledger_visible', true);

    if (work_order_no) {
      dbQuery = dbQuery.eq('work_order_no', work_order_no.trim());
    }
    if (material_sub_head) {
      dbQuery = dbQuery.eq('material_sub_head', material_sub_head.trim());
    }
    if (material_details) {
      dbQuery = dbQuery.eq('material_details', material_details.trim());
    }
    if (search) {
      const s = search.trim();
      dbQuery = dbQuery.or(`material_details.ilike.%${s}%,material_sub_head.ilike.%${s}%,work_order_no.ilike.%${s}%`);
    }
    if (date_from) {
      dbQuery = dbQuery.gte('created_at', `${date_from}T00:00:00+05:30`);
    }
    if (date_to) {
      dbQuery = dbQuery.lte('created_at', `${date_to}T23:59:59.999+05:30`);
    }

    dbQuery = dbQuery.order('created_at', { ascending: false });

    const { data: entries, error } = await dbQuery;

    if (error) throw error;

    const rawEntries = entries || [];

    // 1. Resolve user display names
    const userMap = await resolveDisplayNames(rawEntries.map(e => e.created_by));

    // 2. Resolve Requisitions details (requisition_no, remarks, amounts)
    const reqIds = rawEntries
      .filter(e => e.reference_type === 'REQUISITION' && e.reference_id)
      .map(e => e.reference_id);
    let reqMap = {};
    if (reqIds.length > 0) {
      const { data: reqRows } = await supabase
        .from('requisitions')
        .select('requisition_id, requisition_no, requisition_amount, approved_amount, requisition_status, remarks, remarks_approved_authority')
        .in('requisition_id', reqIds);
      reqMap = (reqRows || []).reduce((acc, r) => {
        acc[r.requisition_id] = r;
        return acc;
      }, {});
    }

    // 3. Resolve Estimate Items details
    const itemIds = rawEntries
      .filter(e => e.reference_type === 'ESTIMATE_ITEM' && e.reference_id)
      .map(e => e.reference_id);
    let itemMap = {};
    if (itemIds.length > 0) {
      const { data: itemRows } = await supabase
        .from('project_cost_estimate_items')
        .select('item_id, description, estimate_id')
        .in('item_id', itemIds);
      itemMap = (itemRows || []).reduce((acc, it) => {
        acc[it.item_id] = it;
        return acc;
      }, {});
    }

    // 4. Resolve Admin Adjustments remarks from audit_log
    const adjIds = rawEntries
      .filter(e => e.reference_type === 'MANUAL_ADJUSTMENT' && e.reference_id)
      .map(e => e.reference_id);
    let adjMap = {};
    if (adjIds.length > 0) {
      const { data: auditRows } = await supabase
        .from('audit_log')
        .select('new_value')
        .eq('action', 'ADMIN_ADJUST_SUBCONTRACTOR_BALANCE');
      adjMap = (auditRows || []).reduce((acc, a) => {
        if (a.new_value?.adjustment_id) {
          acc[a.new_value.adjustment_id] = a.new_value.remarks;
        }
        return acc;
      }, {});
    }

    // 5. Compute chronological running balance per (work_order_no, material_sub_head, material_details)
    const runningBalances = {};
    // Chronological order (oldest first)
    const entriesAsc = [...rawEntries].reverse();
    for (const e of entriesAsc) {
      const key = `${e.work_order_no}|||${e.material_sub_head}|||${e.material_details}`;
      runningBalances[key] = Number(((runningBalances[key] || 0) + Number(e.amount || 0)).toFixed(2));
      e.running_balance = runningBalances[key];
      e.credit_amount = Number(e.amount) > 0 ? Number(e.amount) : 0;
      e.debit_amount = Number(e.amount) < 0 ? Math.abs(Number(e.amount)) : 0;
    }

    // 6. Enrich entries (returned newest first)
    const enriched = rawEntries.map(e => {
      const reqInfo = reqMap[e.reference_id];
      const itemInfo = itemMap[e.reference_id];
      const adjRemarks = adjMap[e.reference_id];

      return {
        ...e,
        created_by_name: userMap[e.created_by] || e.created_by,
        requisition_no: reqInfo?.requisition_no || null,
        reference_doc_no: reqInfo?.requisition_no || (itemInfo ? `Item: ${e.reference_id.slice(0, 8)}` : e.reference_id ? `${e.reference_type}: ${e.reference_id.slice(0, 8)}` : null),
        remarks: reqInfo ? (reqInfo.remarks_approved_authority || reqInfo.remarks || null) : (adjRemarks || itemInfo?.description || null),
        item_description: itemInfo?.description || null
      };
    });

    return res.status(200).json({ success: true, entries: enriched });
  } catch (error) {
    console.error(`getSubcontractorLedgerEntries failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Subcontractor Ledger entries.' });
  }
}

/**
 * GET /api/v1/auth/requisitions/subcontractor-ledger/requisitions
 * Every Requisition raised against a Sub Contractor, across every work
 * order — the raw material for "group by subcontractor" reporting, since
 * subcontractor_balances itself is deliberately scoped per work order (see
 * 047_subcontractor_ledger.sql's design notes) and can't answer "show me
 * everything raised against this person." Filterable by work_order_no,
 * a sub head/subcontractor-name search, and a requisition creation date
 * range; grouping by (material_sub_head, material_details) is left to the
 * caller (the browse UI groups client-side; an Excel export just wants the
 * flat filtered rows).
 */
async function getSubcontractorRequisitions(req, res) {
  try {
    const query = req.query || {};
    const dateBasis = ['approved', 'paid'].includes(query.date_basis) ? query.date_basis : 'created';
    const dateCol = dateBasis === 'approved' ? 'zo_actioned_at' : dateBasis === 'paid' ? 'payment_date' : 'created_at';

    let dbQuery = supabase
      .from('requisitions')
      .select('*')
      .eq('material_main_head', 'Sub Contractor');

    if (query.work_order_no) {
      dbQuery = dbQuery.eq('work_order_no', query.work_order_no.trim());
    }

    if (dateBasis === 'approved') {
      dbQuery = dbQuery.not('zo_actioned_at', 'is', null);
    } else if (dateBasis === 'paid') {
      dbQuery = dbQuery.not('payment_date', 'is', null);
    }

    if (query.date_from) {
      dbQuery = dbQuery.gte(dateCol, `${query.date_from}T00:00:00+05:30`);
    }
    if (query.date_to) {
      dbQuery = dbQuery.lte(dateCol, `${query.date_to}T23:59:59.999+05:30`);
    }

    dbQuery = dbQuery.order('material_details', { ascending: true }).order('created_at', { ascending: false });

    const { data: requisitions, error } = await dbQuery;
    if (error) throw error;

    let filtered = requisitions || [];
    if (query.search) {
      const term = query.search.toLowerCase();
      filtered = filtered.filter(r =>
        r.material_sub_head?.toLowerCase().includes(term) ||
        r.material_details?.toLowerCase().includes(term) ||
        r.work_order_no?.toLowerCase().includes(term) ||
        r.requisition_no?.toLowerCase().includes(term)
      );
    }

    const userMap = await resolveDisplayNames(filtered.flatMap(r => [r.requester_user_id, r.approved_user_id]));
    const enriched = filtered.map(r => ({
      ...r,
      requester_name: userMap[r.requester_user_id] || r.requester_user_id || null,
      approved_name: userMap[r.approved_user_id] || r.approved_user_id || null
    }));

    return res.status(200).json({ success: true, requisitions: enriched });
  } catch (error) {
    console.error(`getSubcontractorRequisitions failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Subcontractor requisitions.' });
  }
}

/**
 * POST /api/v1/auth/requisitions/subcontractor-ledger/adjust
 * Admin balance adjustment for a subcontractor ledger entry (HO or Admin only).
 * Audited and idempotent via adjustment_id.
 */
async function adjustSubcontractorBalance(req, res) {
  const {
    adjustment_id = crypto.randomUUID(),
    work_order_no,
    material_sub_head,
    material_details,
    adjustment_amount,
    remarks
  } = req.body;

  const actioned_by = req.user?.mobile_number;

  try {
    const { data: updatedBalance, error } = await supabase.rpc('adjust_subcontractor_balance_transact', {
      p_adjustment_id: adjustment_id,
      p_work_order_no: work_order_no.trim(),
      p_material_sub_head: material_sub_head.trim(),
      p_material_details: material_details.trim(),
      p_adjustment_amount: Number(adjustment_amount),
      p_remarks: remarks.trim(),
      p_actioned_by: actioned_by
    });

    if (error) {
      if (error.code === 'AUTH1' || error.code === 'AUTH2') {
        return res.status(403).json({ success: false, message: error.message });
      }
      if (error.code === 'P0002') {
        return res.status(404).json({ success: false, message: error.message });
      }
      if (error.code === 'BAL01' || error.code === 'BAL02' || error.code === 'VAL09' || error.code === 'VAL10' || error.code === 'VAL11') {
        return res.status(422).json({ success: false, message: error.message, code: error.code });
      }
      throw error;
    }

    return res.status(200).json({
      success: true,
      message: 'Subcontractor balance adjusted successfully.',
      balance: updatedBalance
    });
  } catch (error) {
    console.error(`adjustSubcontractorBalance failed: ${error.message}`);
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to adjust subcontractor balance.'
    });
  }
}

/**
 * GET /requisitions/beneficiary-master?page=&limit=&search=
 * Paginated/searchable list backing the Beneficiary Master page, distinct
 * from searchProjectsBeneficiaries' typeahead below.
 */
async function getProjectsBeneficiaries(req, res) {
  try {
    const query = req.query || {};
    const page = Math.max(parseInt(query.page, 10) || 1, 1);
    let limit = parseInt(query.limit, 10) || 20;
    if (limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    const offset = (page - 1) * limit;

    let dbQuery = supabase
      .from('projects_beneficiary_master')
      .select('*, indian_bank_master:beneficiary_bank_id (id, bank_name)', { count: 'exact' });

    if (query.search) {
      const term = query.search.replace(/[%,]/g, '');
      dbQuery = dbQuery.or(`beneficiary_ac_no.ilike.%${term}%,beneficiary_name.ilike.%${term}%`);
    }

    const { data: beneficiaries, count, error } = await dbQuery
      .order('beneficiary_name', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw error;

    const enriched = (beneficiaries || []).map(b => ({
      ...b,
      beneficiary_bank: b.indian_bank_master ? {
        id: b.indian_bank_master.id,
        bank_name: b.indian_bank_master.bank_name
      } : null,
      beneficiary_bank_name: b.indian_bank_master?.bank_name || b.beneficiary_bank_name
    }));

    const total = count || 0;
    return res.status(200).json({
      success: true,
      beneficiaries: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(Math.ceil(total / limit), 1)
      }
    });
  } catch (error) {
    console.error(`getProjectsBeneficiaries failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve beneficiaries.' });
  }
}

/**
 * PUT /requisitions/beneficiary-master
 * Manual add/edit entry point for the Beneficiary Master page, distinct from
 * the automatic upsert createRequisition performs on submit.
 */
async function upsertProjectsBeneficiary(req, res) {
  if (!validate(req, res, upsertProjectsBeneficiarySchema)) return;
  const { beneficiary_ac_no, beneficiary_ifsc, beneficiary_name, beneficiary_bank_name, beneficiary_bank_id } = req.body;

  let resolvedBankId = beneficiary_bank_id || null;
  let resolvedBankName = beneficiary_bank_name?.trim() || null;

  if (resolvedBankId) {
    const bankCheck = await validateActiveIndianBank(resolvedBankId);
    if (!bankCheck.valid) {
      if (bankCheck.reason === 'NOT_FOUND') {
        return res.status(422).json({ success: false, message: 'Selected bank does not exist.' });
      }
      if (bankCheck.reason === 'INACTIVE') {
        return res.status(422).json({ success: false, message: 'Selected bank is currently inactive.' });
      }
    }
    resolvedBankName = bankCheck.bank.bank_name;
  } else if (resolvedBankName) {
    const { data: matchedBank } = await supabase
      .from('indian_bank_master')
      .select('id, bank_name, is_active')
      .ilike('bank_name', resolvedBankName)
      .maybeSingle();
    if (matchedBank) {
      resolvedBankId = matchedBank.id;
      resolvedBankName = matchedBank.bank_name;
    }
  }

  try {
    const { data, error } = await supabase
      .from('projects_beneficiary_master')
      .upsert(
        {
          beneficiary_ac_no,
          beneficiary_ifsc: beneficiary_ifsc.toUpperCase(),
          beneficiary_name,
          beneficiary_bank_id: resolvedBankId,
          beneficiary_bank_name: resolvedBankName,
          last_used_at: new Date().toISOString(),
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'beneficiary_ac_no,beneficiary_ifsc' }
      )
      .select('*, indian_bank_master:beneficiary_bank_id (id, bank_name)')
      .single();

    if (error) throw error;

    const enriched = {
      ...data,
      beneficiary_bank: data.indian_bank_master ? {
        id: data.indian_bank_master.id,
        bank_name: data.indian_bank_master.bank_name
      } : null,
      beneficiary_bank_name: data.indian_bank_master?.bank_name || data.beneficiary_bank_name
    };

    return res.status(200).json({ success: true, beneficiary: enriched, message: 'Beneficiary saved.' });
  } catch (error) {
    console.error(`upsertProjectsBeneficiary failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save beneficiary.' });
  }
}

/**
 * PUT /requisitions/indian-banks
 * Shared indian_bank_master table — same write path as the Accounts module's
 * equivalent endpoint, exposed here so Financial Twin users can add/deactivate
 * banks without needing Accounts access.
 */
async function upsertIndianBank(req, res) {
  if (!validate(req, res, upsertIndianBankSchema)) return;
  const { bank_name, is_active } = req.body;

  try {
    const { data, error } = await supabase
      .from('indian_bank_master')
      .upsert(
        {
          bank_name,
          is_active: is_active !== undefined ? is_active : true,
          created_by: req.user.mobile_number,
          updated_by: req.user.mobile_number
        },
        { onConflict: 'bank_name' }
      )
      .select()
      .single();

    if (error) throw error;

    invalidateBankCache();

    return res.status(200).json({ success: true, indianBank: data, message: 'Indian bank saved.' });
  } catch (error) {
    console.error(`upsertIndianBank failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to save Indian bank.' });
  }
}

/**
 * GET /api/v1/auth/requisitions/beneficiary-suggestions?prefix=...&limit=...
 * Live typeahead for project payment requisition beneficiary account numbers or names.
 */
async function searchProjectsBeneficiaries(req, res) {
  const prefix = (req.query?.prefix || '').trim().replace(/[%_]/g, '');
  if (prefix.length < 3) {
    return res.status(200).json({ success: true, beneficiaries: [] });
  }
  const limit = Math.min(parseInt(req.query?.limit, 10) || 8, 20);

  try {
    let query = supabase
      .from('projects_beneficiary_master')
      .select('id, beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, beneficiary_bank_name, beneficiary_bank_id, last_used_at, indian_bank_master:beneficiary_bank_id (id, bank_name)');

    if (/^\d+$/.test(prefix)) {
      query = query.like('beneficiary_ac_no', `${prefix}%`);
    } else {
      query = query.ilike('beneficiary_name', `%${prefix}%`);
    }

    const { data, error } = await query
      .order('last_used_at', { ascending: false, nullsFirst: false })
      .limit(limit);

    if (error) throw error;

    const enriched = (data || []).map(b => ({
      id: b.id,
      beneficiary_name: b.beneficiary_name,
      beneficiary_ac_no: b.beneficiary_ac_no,
      beneficiary_ifsc: b.beneficiary_ifsc,
      beneficiary_bank_id: b.beneficiary_bank_id,
      beneficiary_bank: b.indian_bank_master ? {
        id: b.indian_bank_master.id,
        bank_name: b.indian_bank_master.bank_name
      } : null,
      beneficiary_bank_name: b.indian_bank_master?.bank_name || b.beneficiary_bank_name,
      last_used_at: b.last_used_at
    }));

    return res.status(200).json({ success: true, beneficiaries: enriched });
  } catch (error) {
    console.error(`searchProjectsBeneficiaries failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to search project beneficiaries.' });
  }
}

/**
 * GET /requisitions/indian-banks
 * Returns active Indian banks for dropdown population.
 */
async function getIndianBanks(req, res) {
  try {
    const indianBanks = await getActiveIndianBanks();
    return res.status(200).json({ success: true, indianBanks });
  } catch (error) {
    console.error(`getIndianBanks failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve Indian banks.' });
  }
}

module.exports = {
  createRequisition,
  getRequisitions,
  getRequisitionById,
  actOnRequisition,
  payFromZoBalance,
  sendToAccounts,
  cancelRequisition,
  getMainHeadCapacity,
  getSubcontractorCapacity,
  getSubcontractorLedger,
  getSubcontractorLedgerEntries,
  getSubcontractorRequisitions,
  adjustSubcontractorBalance,
  searchProjectsBeneficiaries,
  getProjectsBeneficiaries,
  upsertProjectsBeneficiary,
  upsertIndianBank,
  getIndianBanks
};
