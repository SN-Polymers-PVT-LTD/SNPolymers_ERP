'use strict';

const { supabase } = require('../db/supabase');
const { v4: uuidv4 } = require('uuid');

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png'];
const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/png': 'png'
};

/**
 * POST /api/v1/auth/daily-progress/upload/photo
 * Uploads a site photo to Supabase Storage.
 * Body (multipart/form-data): file (field name: 'file')
 */
async function uploadSitePhoto(req, res) {
  const file = req.file;

  if (!file) {
    return res.status(400).json({ success: false, message: 'No file uploaded.' });
  }

  // Server-side MIME validation (do not trust extensions alone)
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return res.status(400).json({
      success: false,
      message: 'Only image files are accepted (JPEG, JPG, PNG).'
    });
  }

  // Size limit validation
  if (file.size > MAX_FILE_SIZE) {
    return res.status(400).json({
      success: false,
      message: 'File size must not exceed 10MB.'
    });
  }

  // Generate UUID-based path to guarantee uniqueness and prevent directory traversal
  const ext = MIME_TO_EXT[file.mimetype];
  const storagePath = `${uuidv4()}.${ext}`;

  try {
    const { error: uploadError } = await supabase.storage
      .from('daily-progress-photos')
      .upload(storagePath, file.buffer, {
        contentType: file.mimetype,
        upsert: false // Each upload gets a new UUID path
      });

    if (uploadError) throw uploadError;

    return res.status(200).json({
      success: true,
      photo_url: storagePath, // bucket-relative path
      original_filename: file.originalname,
      message: 'Site photo uploaded successfully.'
    });

  } catch (error) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('uploadSitePhoto failed:', error);
    } else {
      console.error(`uploadSitePhoto failed: ${error.message}`);
    }
    return res.status(500).json({ success: false, message: 'Failed to upload site photo.' });
  }
}

module.exports = {
  uploadSitePhoto
};
