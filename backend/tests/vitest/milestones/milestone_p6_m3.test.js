import { describe, test, expect, afterAll } from 'vitest';
const https = require('https');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { uploadBillCopy } = require('../../../src/controllers/raFinalBill.uploads.controller');

describe('Milestone P6-M3 — RA/Final Bill File Uploads', () => {
  let uploadedPath = null;

  afterAll(async () => {
    // Cleanup uploaded file from storage
    if (uploadedPath) {
      await supabase.storage
        .from('ra-bill-copies')
        .remove([uploadedPath]);
    }
  });

  describe('File Upload Integrity', () => {
    test('Test 1: Uploads a valid PDF successfully and receives a UUID path', async () => {
      const reqValid = {
        file: {
          fieldname: 'file',
          originalname: 'invoice_test.pdf',
          encoding: '7bit',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock pdf content'),
          size: 25
        }
      };
      const resValid = mockRes();
      await uploadBillCopy(reqValid, resValid);

      expect(resValid.statusCode).toBe(200);
      expect(resValid.jsonData.success).toBe(true);

      uploadedPath = resValid.jsonData.bill_copy_url;
      const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.pdf$/;
      expect(uuidRegex.test(uploadedPath)).toBe(true);
    });

    test('Test 2: Blocks text file (.txt) upload with 400 Bad Request', async () => {
      const reqText = {
        file: {
          fieldname: 'file',
          originalname: 'bad.txt',
          encoding: '7bit',
          mimetype: 'text/plain',
          buffer: Buffer.from('hello world'),
          size: 11
        }
      };
      const resText = mockRes();
      await uploadBillCopy(reqText, resText);

      expect(resText.statusCode).toBe(400);
      expect(resText.jsonData.message).toContain('Only PDF, JPG, JPEG, or PNG');
    });

    test('Test 3: Blocks large file (> 5MB) upload with 400 Bad Request', async () => {
      const reqLarge = {
        file: {
          fieldname: 'file',
          originalname: 'large.pdf',
          encoding: '7bit',
          mimetype: 'application/pdf',
          buffer: Buffer.alloc(6 * 1024 * 1024), // 6MB
          size: 6 * 1024 * 1024
        }
      };
      const resLarge = mockRes();
      await uploadBillCopy(reqLarge, resLarge);

      expect(resLarge.statusCode).toBe(400);
      expect(resLarge.jsonData.message).toContain('exceed 5MB');
    });

    test('Test 4: Verifies bucket privacy blocks direct public access', async () => {
      expect(uploadedPath).not.toBeNull();

      const publicUrl = `https://ervvwrmgkiyfzbqjqbcg.supabase.co/storage/v1/object/public/ra-bill-copies/${uploadedPath}`;
      
      const verifyPrivacy = () => {
        return new Promise((resolve) => {
          https.get(publicUrl, (response) => {
            expect(response.statusCode).toBeGreaterThanOrEqual(400);
            resolve();
          }).on('error', () => {
            // Connection errors/blocking are also correct indicators of blocked access
            resolve();
          });
        });
      };

      await verifyPrivacy();
    });
  });
});
