'use strict';

const crypto = require('crypto');
const { supabase } = require('../db/supabase');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = 'application/pdf';

// Sanitize filename: only allow [A-Za-z0-9_\-.] — retained as a pure utility (still
// exercised as a unit test) even though upload paths are UUID-based, not name-derived.
function sanitizeFilename(str) {
  if (!str) return '';
  return str.replace(/[^A-Za-z0-9_\-.]/g, '_');
}

/**
 * Shared upload handler for both PDF kinds. Storage path is a fresh UUID — never derived
 * from requisition_no — so two uploads never collide and the requisition number stays
 * free to edit right up until the moment a requisition actually claims the attachment
 * (create_requisition_secure, migration 056). A `pending` row is registered in
 * requisition_attachments immediately after the storage upload succeeds; it's claimed
 * (status -> 'committed', requisition_id set) atomically inside the RPC when a
 * requisition is created, and otherwise deleted directly (clear/cancel in the UI) or by
 * the stale-attachment sweep (Phase 3) if it's ever abandoned.
 */
async function handleUpload(req, res, { bucket, kind, upsert }) {
  const file = req.file;
  const { requisition_no } = req.body;

  if (!requisition_no || !requisition_no.trim()) {
    return res.status(400).json({ success: false, message: 'requisition_no is required.' });
  }

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  if (file.mimetype !== ALLOWED_MIME) {
    return res.status(400).json({ success: false, message: 'Only PDF files are accepted.' });
  }

  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({ success: false, message: 'File size must not exceed 5MB.' });
  }

  const storagePath = `${crypto.randomUUID()}.pdf`;
  let uploaded = false;
  let attachmentId = null;

  try {
    // If a requisition with this number already exists, only its owner (or admin) may
    // attach files to it. A brand-new requisition (the common case) has no row yet, so
    // this check is skipped — nothing to own until create_requisition_secure runs.
    const { data: requisition, error: fetchErr } = await supabase
      .from('requisitions')
      .select('requester_user_id')
      .eq('requisition_no', requisition_no.trim())
      .neq('requisition_status', 'Cancelled')
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    if (requisition && requisition.requester_user_id !== req.user.mobile_number && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied. You do not own this requisition.' });
    }

    const { error: uploadError } = await supabase.storage
      .from(bucket)
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: Boolean(upsert)
      });

    if (uploadError) throw uploadError;
    uploaded = true;

    const { data: attachment, error: attachmentErr } = await supabase
      .from('requisition_attachments')
      .insert({
        bucket,
        storage_path: storagePath,
        kind,
        uploaded_by: req.user.mobile_number,
        status: 'pending'
      })
      .select('attachment_id')
      .single();

    if (attachmentErr) {
      // Attachment bookkeeping failed after the file landed in storage — remove the
      // orphaned object rather than leaving it untracked (the sweep can only reclaim
      // rows it knows about).
      await supabase.storage.from(bucket).remove([storagePath]);
      throw attachmentErr;
    }
    attachmentId = attachment.attachment_id;

    // Generate signed URL (1-hour TTL) for immediate preview
    const { data: signedData, error: signError } = await supabase.storage
      .from(bucket)
      .createSignedUrl(storagePath, 3600);

    if (signError) {
      // No response has exposed this attachment yet, so it is safe to reclaim both
      // records immediately instead of leaving an orphaned pending upload.
      await supabase.storage.from(bucket).remove([storagePath]);
      await supabase
        .from('requisition_attachments')
        .delete()
        .eq('attachment_id', attachmentId)
        .eq('uploaded_by', req.user.mobile_number)
        .eq('status', 'pending');
      uploaded = false;
      attachmentId = null;
      throw signError;
    }

    return res.status(201).json({
      success: true,
      storagePath,
      attachmentId: attachment.attachment_id,
      signedUrl: signedData.signedUrl,
      message: 'File uploaded successfully.'
    });

  } catch (error) {
    // Covers an unexpected failure after the attachment row was created. The explicit
    // signed-URL branch above normally handles this, but keeping this cleanup here
    // prevents future edits from reintroducing an orphaned upload path.
    if (uploaded && attachmentId) {
      try {
        await supabase.storage.from(bucket).remove([storagePath]);
        await supabase
          .from('requisition_attachments')
          .delete()
          .eq('attachment_id', attachmentId)
          .eq('uploaded_by', req.user.mobile_number)
          .eq('status', 'pending');
      } catch (cleanupErr) {
        console.error(`Failed to clean up unsuccessful upload: ${cleanupErr.message}`);
      }
    }
    if (process.env.NODE_ENV !== 'production') {
      console.error('handleUpload failed:', error);
    } else {
      console.error(`handleUpload failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload file.' });
  }
}

/**
 * POST /api/v1/auth/requisitions/upload/requisition-pdf
 * Body (multipart/form-data): file, requisition_no
 */
async function uploadRequisitionPdf(req, res) {
  return handleUpload(req, res, { bucket: 'requisition-pdfs', kind: 'requisition_pdf', upsert: false });
}

/**
 * POST /api/v1/auth/requisitions/upload/gst-bill
 * Body (multipart/form-data): file, requisition_no
 */
async function uploadGstBillPdf(req, res) {
  return handleUpload(req, res, { bucket: 'gst-bills', kind: 'gst_bill', upsert: false });
}

/**
 * Shared delete handler. Deletes a `pending` attachment the caller owns — once an
 * attachment is `committed` (claimed by a requisition), it can no longer be removed
 * through this endpoint; that would silently break a saved requisition's PDF reference.
 */
async function handleDelete(req, res, { kind }) {
  const attachment_id = req.body.attachment_id || req.query.attachment_id;
  if (!attachment_id) {
    return res.status(400).json({ success: false, message: 'attachment_id is required.' });
  }

  try {
    const { data: attachment, error: acquireErr } = await supabase.rpc('acquire_requisition_attachment_delete', {
      p_attachment_id: attachment_id, p_actor: req.user.mobile_number, p_kind: kind
    });
    if (acquireErr) {
      if (acquireErr.code === 'P0002') return res.status(404).json({ success: false, message: 'Attachment not found.' });
      if (acquireErr.code === '42501') return res.status(403).json({ success: false, message: 'Access denied. You do not own this attachment.' });
      if (acquireErr.code === 'STA08') return res.status(409).json({ success: false, message: acquireErr.message });
      throw acquireErr;
    }

    const { error: removeErr } = await supabase.storage
      .from(attachment.bucket)
      .remove([attachment.storage_path]);

    if (removeErr) throw removeErr;

    const { data: finalized, error: finalizeErr } = await supabase.rpc('finalize_requisition_attachment_delete', {
      p_attachment_id: attachment_id
    });
    if (finalizeErr) throw finalizeErr;
    if (!finalized) throw new Error('Attachment deletion was not finalized.');

    return res.status(200).json({
      success: true,
      message: 'Attachment deleted successfully.'
    });
  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('handleDelete failed:', error);
    } else {
      console.error(`handleDelete failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to delete attachment.' });
  }
}

async function deleteRequisitionPdf(req, res) {
  return handleDelete(req, res, { kind: 'requisition_pdf' });
}

async function deleteGstBillPdf(req, res) {
  return handleDelete(req, res, { kind: 'gst_bill' });
}

module.exports = {
  uploadRequisitionPdf,
  uploadGstBillPdf,
  deleteRequisitionPdf,
  deleteGstBillPdf,
  sanitizeFilename
};
