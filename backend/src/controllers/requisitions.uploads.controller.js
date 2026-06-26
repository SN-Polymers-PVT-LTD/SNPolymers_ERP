'use strict';

const { supabase } = require('../db/supabase');

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_MIME = 'application/pdf';

// Sanitize filename: only allow [A-Za-z0-9_\-.]
function sanitizeFilename(str) {
  if (!str) return '';
  return str.replace(/[^A-Za-z0-9_\-.]/g, '_');
}

/**
 * POST /api/v1/auth/requisitions/upload/requisition-pdf
 * Uploads a Requisition PDF to Supabase Storage.
 * Body (multipart/form-data): file, requisition_no
 */
async function uploadRequisitionPdf(req, res) {
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

  const sanitizedReqNo = sanitizeFilename(requisition_no.trim());
  const storagePath = `${sanitizedReqNo}.pdf`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('requisition-pdfs')
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: false
      });

    if (uploadError) {
      if (uploadError.statusCode === '409' || uploadError.message?.includes('already exists')) {
        return res.status(409).json({
          success: false,
          message: `A PDF for requisition number '${requisition_no.trim()}' already exists.`
        });
      }
      throw uploadError;
    }

    // Generate signed URL (1-hour TTL) for immediate preview
    const { data: signedData, error: signError } = await supabase.storage
      .from('requisition-pdfs')
      .createSignedUrl(storagePath, 3600);

    if (signError) throw signError;

    return res.status(201).json({
      success: true,
      storagePath,
      signedUrl: signedData.signedUrl,
      message: 'Requisition PDF uploaded successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('uploadRequisitionPdf failed:', error);
    } else {
      console.error(`uploadRequisitionPdf failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload requisition PDF.' });
  }
}

/**
 * POST /api/v1/auth/requisitions/upload/gst-bill
 * Uploads a GST Bill PDF to Supabase Storage.
 * Body (multipart/form-data): file, requisition_no
 */
async function uploadGstBillPdf(req, res) {
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

  const sanitizedReqNo = sanitizeFilename(requisition_no.trim());
  const storagePath = `${sanitizedReqNo}_gst.pdf`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('gst-bills')
      .upload(storagePath, file.buffer, {
        contentType: 'application/pdf',
        upsert: true // Allows replacement before final save
      });

    if (uploadError) throw uploadError;

    // Generate signed URL (1-hour TTL) for immediate preview
    const { data: signedData, error: signError } = await supabase.storage
      .from('gst-bills')
      .createSignedUrl(storagePath, 3600);

    if (signError) throw signError;

    return res.status(201).json({
      success: true,
      storagePath,
      signedUrl: signedData.signedUrl,
      message: 'GST Bill PDF uploaded successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('uploadGstBillPdf failed:', error);
    } else {
      console.error(`uploadGstBillPdf failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload GST bill PDF.' });
  }
}

module.exports = {
  uploadRequisitionPdf,
  uploadGstBillPdf,
  sanitizeFilename
};
