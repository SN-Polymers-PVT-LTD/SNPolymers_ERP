import { describe, test, expect, afterAll } from 'vitest';
const https = require('https');
const { supabase } = require('../../../src/db/supabase');
const { uploadSitePhoto } = require('../../../src/controllers/dailyProgress.uploads.controller');
const mockRes = require('../../helpers/mockRes');

function checkUrlPrivate(url) {
  return new Promise((resolve) => {
    https.get(url, (res) => {
      const isPrivate = res.statusCode === 400 || res.statusCode === 403;
      resolve(isPrivate);
    }).on('error', () => {
      resolve(true);
    });
  });
}

describe('Milestone P5-M4 — Daily Progress Photo Upload & Storage', () => {
  const jeUser = { role: 'je', mobile_number: '+917980526576' };
  let uploadedPhotoPath = null;

  afterAll(async () => {
    if (uploadedPhotoPath) {
      await supabase.storage.from('daily-progress-photos').remove([uploadedPhotoPath]);
    }
  });

  describe('File Validation checks', () => {
    test('Test 1: Blocks uploads with non-image MIME types with 400', async () => {
      const req = {
        user: jeUser,
        file: {
          fieldname: 'file',
          originalname: 'test.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock pdf content'),
          size: 25
        }
      };
      const res = mockRes();
      await uploadSitePhoto(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
    });

    test('Test 2: Blocks uploads exceeding 10MB limit with 400', async () => {
      const req = {
        user: jeUser,
        file: {
          fieldname: 'file',
          originalname: 'large.jpg',
          mimetype: 'image/jpeg',
          buffer: Buffer.alloc(11 * 1024 * 1024),
          size: 11 * 1024 * 1024
        }
      };
      const res = mockRes();
      await uploadSitePhoto(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
    });
  });

  describe('Upload Success & Storage Privacy', () => {
    test('Test 3: Uploads valid image successfully, obfuscates filename to UUID', async () => {
      const req = {
        user: jeUser,
        file: {
          fieldname: 'file',
          originalname: 'my-site-visit.jpg',
          mimetype: 'image/jpeg',
          buffer: Buffer.from('fake-jpeg-image-bytes-data'),
          size: 27
        }
      };
      const res = mockRes();
      await uploadSitePhoto(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.jsonData.success).toBe(true);

      uploadedPhotoPath = res.jsonData.photo_url;
      expect(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.jpg$/.test(uploadedPhotoPath)).toBe(true);
      expect(res.jsonData.original_filename).toBe('my-site-visit.jpg');
    });

    test('Test 4: Verifies direct public access to files in daily-progress-photos bucket is blocked', async () => {
      expect(uploadedPhotoPath).not.toBeNull();

      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/daily-progress-photos/${uploadedPhotoPath}`;
      const isPrivate = await checkUrlPrivate(publicUrl);

      expect(isPrivate).toBe(true);
    });

    test('Test 5: Gracefully handles storage upload failures returning 500', async () => {
      const originalFrom = supabase.storage.from;
      supabase.storage.from = (bucket) => {
        if (bucket === 'daily-progress-photos') {
          return {
            upload: async () => {
              return { error: new Error('Simulated Supabase Storage upload failure') };
            }
          };
        }
        return originalFrom.call(supabase.storage, bucket);
      };

      const reqFail = {
        user: jeUser,
        file: {
          fieldname: 'file',
          originalname: 'fail-site.png',
          mimetype: 'image/png',
          buffer: Buffer.from('png-bytes'),
          size: 9
        }
      };
      const resFail = mockRes();
      
      try {
        await uploadSitePhoto(reqFail, resFail);
      } finally {
        supabase.storage.from = originalFrom;
      }

      expect(resFail.statusCode).toBe(500);
      expect(resFail.jsonData.success).toBe(false);
      expect(resFail.jsonData.message).toContain('Failed to upload');
    });
  });
});
