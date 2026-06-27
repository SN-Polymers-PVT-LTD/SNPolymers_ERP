'use strict';

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE = 5 * 1024 * 1024;  // 5MB

// SEC-P6-2: MIME type whitelist — includes both PDF and image types
const ALLOWED_MIMES = [
  'application/pdf',
  'image/jpeg',
  'image/png'
];

// Maps MIME type to file extension for UUID-based storage path
const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'image/jpeg':      'jpg',
  'image/png':       'png'
};

/**
 * POST /api/v1/auth/ra-final-bills/upload/bill-copy
 * Uploads a bill copy (PDF/JPG/JPEG/PNG) to Supabase Storage.
 * Body (multipart/form-data): file (field name: 'file')
 *
 * Security Controls:
 *   SEC-P6-2: MIME type validated server-side — never trust file extension
 *   SEC-P6-3: File size capped at 5MB (also enforced by multer limits)
 *   SEC-P6-9: Storage path is UUID-based — user-supplied filename never reaches storage path
 */
async function uploadBillCopy(req, res) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  // SEC-P6-2: MIME type validation — reject anything not in the whitelist
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Only PDF, JPG, JPEG, or PNG files are accepted.'
    });
  }

  // SEC-P6-3: Re-validate size in controller (belt-and-suspenders after multer)
  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({
      success: false,
      message: 'File size must not exceed 5MB.'
    });
  }

  // SEC-P6-9: Generate UUID-based path — user-supplied filename is NEVER used in storage path
  const ext = MIME_TO_EXT[file.mimetype];
  const storagePath = `${uuidv4()}.${ext}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('ra-bill-copies')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false  // Each bill copy gets a unique UUID path — no overwrites
      });

    if (uploadError) throw uploadError;

    return res.status(200).json({
      success: true,
      bill_copy_url: storagePath,             // Relative storage path (stored in DB)
      original_filename: file.originalname,   // User's original filename (stored separately)
      message: 'Bill copy uploaded successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('uploadBillCopy failed:', error);
    } else {
      console.error(`uploadBillCopy failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload bill copy.' });
  }
}

module.exports = { uploadBillCopy };
