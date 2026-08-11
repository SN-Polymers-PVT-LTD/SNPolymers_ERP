'use strict';

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');
const { EDITABLE_STATUSES } = require('../workflow/estimate-rules');
const {
  getEstimateById,
  isOwnerOrAdmin,
  canViewEstimate,
  getEffectiveRole
} = require('./estimates.helpers');

const ALLOWED_MIMES = ['application/pdf'];
const MAX_FILE_SIZE = 15 * 1024 * 1024; // 15MB

/**
 * POST /api/v1/auth/estimates/:id/quotations
 * Uploads a quotation PDF, inserts metadata, and handles errors with orphan cleanup.
 */
async function uploadQuotation(req, res) {
  const { id } = req.params;
  const file = req.file;

  // Fail-fast checks (before fetching estimate from DB)
  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return res.status(400).json({ success: false, message: 'Only PDF files are accepted.' });
  }

  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({ success: false, message: 'File size must not exceed 15MB.' });
  }

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    if (!(await isOwnerOrAdmin(estimate, req.user))) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this estimate.' });
    }

    const effectiveRole = getEffectiveRole(req.user.role);
    const isAdmin = effectiveRole === 'admin';

    if (!isAdmin && !EDITABLE_STATUSES.includes(estimate.estimate_status)) {
      return res.status(403).json({ success: false, message: 'Estimate cannot be modified in its current status.' });
    }

    const storagePath = `${uuidv4()}.pdf`;

    // Upload to Supabase Storage Bucket
    const { error: uploadError } = await supabase.storage
      .from('estimate-quotations')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false
      });

    if (uploadError) throw uploadError;

    // Insert metadata row in PostgreSQL
    const vendorLabel = req.body.vendor_label ? String(req.body.vendor_label).slice(0, 100) : null;
    const { data: insertedRow, error: insertError } = await supabase
      .from('estimate_quotations')
      .insert({
        estimate_id: id,
        storage_path: storagePath,
        original_filename: file.originalname,
        vendor_label: vendorLabel,
        file_size: file.size,
        uploaded_by: req.user.mobile_number
      })
      .select()
      .single();

    if (insertError) {
      // Storage -> DB Orphan Cleanup: Remove the uploaded file if metadata insert fails
      await supabase.storage.from('estimate-quotations').remove([storagePath]);
      throw insertError;
    }

    return res.status(201).json({
      success: true,
      quotation: insertedRow,
      message: 'Quotation uploaded successfully.'
    });

  } catch (error) {
    console.error(`uploadQuotation failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to upload quotation.' });
  }
}

/**
 * GET /api/v1/auth/estimates/:id/quotations
 * Lists active quotations for JE/HO, and all (including soft-deleted) for ZO/Admin.
 * Dynamically generates signed URLs for active rows.
 */
async function listQuotations(req, res) {
  const { id } = req.params;

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    if (!(await canViewEstimate(estimate, req.user))) {
      return res.status(403).json({ success: false, message: 'Access denied. You cannot view this estimate.' });
    }

    const effectiveRole = getEffectiveRole(req.user.role);
    const isAdmin = effectiveRole === 'admin';
    const isZO = effectiveRole === 'zo';

    let query = supabase.from('estimate_quotations').select('*').eq('estimate_id', id);

    // Only ZO and Admin can see soft-deleted rows
    if (!isZO && !isAdmin) {
      query = query.eq('is_deleted', false);
    }

    const { data: rows, error: fetchError } = await query.order('uploaded_at', { ascending: true });
    if (fetchError) throw fetchError;

    // Dynamically generate signed URLs for active rows
    const enrichedRows = [];
    for (const row of rows || []) {
      let quotation_signed_url = null;
      if (!row.is_deleted && row.storage_path) {
        const { data: signData, error: signError } = await supabase.storage
          .from('estimate-quotations')
          .createSignedUrl(row.storage_path, 3600);
        if (!signError && signData) {
          quotation_signed_url = signData.signedUrl;
        }
      }
      enrichedRows.push({
        ...row,
        quotation_signed_url
      });
    }

    return res.status(200).json({
      success: true,
      quotations: enrichedRows
    });

  } catch (error) {
    console.error(`listQuotations failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to retrieve quotations.' });
  }
}

/**
 * DELETE /api/v1/auth/estimates/:id/quotations/:quotationId
 * Soft deletes an unlocked quotation during editable estimate status.
 */
async function deleteQuotation(req, res) {
  const { id, quotationId } = req.params;

  try {
    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    if (!(await isOwnerOrAdmin(estimate, req.user))) {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this estimate.' });
    }

    // Fetch the quotation row
    const { data: row, error: fetchError } = await supabase
      .from('estimate_quotations')
      .select('*')
      .eq('quotation_id', quotationId)
      .maybeSingle();

    if (fetchError || !row) {
      return res.status(404).json({ success: false, message: 'Quotation not found.' });
    }

    // Enforce explicit ownership correlation check
    if (row.estimate_id !== id) {
      return res.status(404).json({ success: false, message: 'Quotation not found.' });
    }

    if (row.is_locked) {
      return res.status(403).json({ success: false, message: 'Final approved quotations are locked and cannot be deleted.' });
    }

    const effectiveRole = getEffectiveRole(req.user.role);
    const isAdmin = effectiveRole === 'admin';

    if (!isAdmin && !EDITABLE_STATUSES.includes(estimate.estimate_status)) {
      return res.status(403).json({ success: false, message: 'Estimate cannot be modified in its current status.' });
    }

    // Perform Soft Delete
    const { error: updateError } = await supabase
      .from('estimate_quotations')
      .update({
        is_deleted: true,
        deleted_by: req.user.mobile_number,
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('quotation_id', quotationId);

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      message: 'Quotation deleted successfully.'
    });

  } catch (error) {
    console.error(`deleteQuotation failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to delete quotation.' });
  }
}

/**
 * PATCH /api/v1/auth/estimates/:id/quotations/:quotationId/flag
 * Toggles the flagged_for_replacement flag on any locked/unlocked quotation.
 */
async function toggleQuotationFlag(req, res) {
  const { id, quotationId } = req.params;
  const { flagged } = req.body;

  if (flagged === undefined || typeof flagged !== 'boolean') {
    return res.status(400).json({ success: false, message: 'flagged body parameter must be a boolean.' });
  }

  try {
    // Defense-in-depth role check in controller
    const effectiveRole = getEffectiveRole(req.user.role);
    if (!['zo', 'ho', 'admin'].includes(effectiveRole)) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const estimate = await getEstimateById(id);
    if (!estimate) {
      return res.status(404).json({ success: false, message: 'Estimate not found.' });
    }

    if (!(await canViewEstimate(estimate, req.user))) {
      return res.status(403).json({ success: false, message: 'Access denied. You cannot review this estimate.' });
    }

    // Fetch the quotation row
    const { data: row, error: fetchError } = await supabase
      .from('estimate_quotations')
      .select('*')
      .eq('quotation_id', quotationId)
      .maybeSingle();

    if (fetchError || !row) {
      return res.status(404).json({ success: false, message: 'Quotation not found.' });
    }

    // Enforce ownership correlation check
    if (row.estimate_id !== id) {
      return res.status(404).json({ success: false, message: 'Quotation not found.' });
    }

    // Perform flag update
    const { data: updatedRow, error: updateError } = await supabase
      .from('estimate_quotations')
      .update({
        flagged_for_replacement: flagged,
        updated_at: new Date().toISOString()
      })
      .eq('quotation_id', quotationId)
      .select()
      .single();

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      quotation: updatedRow,
      message: 'Quotation flag updated successfully.'
    });

  } catch (error) {
    console.error(`toggleQuotationFlag failed: ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update quotation flag.' });
  }
}

module.exports = {
  uploadQuotation,
  listQuotations,
  deleteQuotation,
  toggleQuotationFlag
};
