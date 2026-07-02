import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const https = require('https');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const {
  uploadRequisitionPdf,
  uploadGstBillPdf,
  sanitizeFilename
} = require('../../../src/controllers/requisitions.uploads.controller');
const { getRequisitionById } = require('../../../src/controllers/requisitions.controller');

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

describe('Milestone P4-M4 — Requisitions File Upload & Storage', () => {
  let suffix;
  let testReqNo;
  let uploadedRequisitionPath = null;
  let uploadedGstPath = null;
  let tempRequisitionId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testReqNo = `REQ_M4_FILE_${suffix}`;
  });

  afterAll(async () => {
    // Delete files from storage
    if (uploadedRequisitionPath) {
      await supabase.storage.from('requisition-pdfs').remove([uploadedRequisitionPath]);
    }
    if (uploadedGstPath) {
      await supabase.storage.from('gst-bills').remove([uploadedGstPath]);
    }
    // Delete temp DB record
    if (tempRequisitionId) {
      await supabase.from('requisitions').delete().eq('requisition_id', tempRequisitionId);
    }
  });

  describe('Filename Sanitization', () => {
    test('Test 1: Sanitizes path traversal characters from filename', () => {
      const inputPath = '../../../etc/passwd';
      const sanitized = sanitizeFilename(inputPath);
      expect(sanitized.includes('/')).toBe(false);
      expect(sanitized.includes('\\')).toBe(false);
      expect(sanitized).toBe('.._.._.._etc_passwd');
    });
  });

  describe('File Upload Gating & Validation', () => {
    test('Test 2: Blocks uploads with non-PDF MIME types with 400', async () => {
      const req = {
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: 'test.jpg',
          mimetype: 'image/jpeg',
          buffer: Buffer.from('fake image content'),
          size: 18
        }
      };
      const res = mockRes();
      await uploadRequisitionPdf(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
    });

    test('Test 3: Blocks file uploads exceeding 5MB with 400', async () => {
      const req = {
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: 'large.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.alloc(6 * 1024 * 1024),
          size: 6 * 1024 * 1024
        }
      };
      const res = mockRes();
      await uploadRequisitionPdf(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
    });

    test('Test 4: Blocks file uploads when requisition_no is missing with 400', async () => {
      const req = {
        body: {},
        file: {
          fieldname: 'file',
          originalname: 'test.pdf',
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 test'),
          size: 14
        }
      };
      const res = mockRes();
      await uploadRequisitionPdf(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.jsonData.success).toBe(false);
    });
  });

  describe('Successful Upload Operations & Storage Privacy', () => {
    test('Test 5: Uploads valid Requisition PDF successfully', async () => {
      const req = {
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: `${testReqNo}.pdf`,
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock pdf body'),
          size: 23
        }
      };
      const res = mockRes();
      await uploadRequisitionPdf(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);

      uploadedRequisitionPath = res.jsonData.storagePath;
      expect(uploadedRequisitionPath).toBe(`${testReqNo}.pdf`);
      expect(typeof res.jsonData.signedUrl).toBe('string');
    });

    test('Test 6: Blocks duplicate Requisition PDF upload with 409', async () => {
      expect(uploadedRequisitionPath).not.toBeNull();

      const req = {
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: `${testReqNo}.pdf`,
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock pdf body'),
          size: 23
        }
      };
      const res = mockRes();
      await uploadRequisitionPdf(req, res);

      expect(res.statusCode).toBe(409);
      expect(res.jsonData.success).toBe(false);
    });

    test('Test 7: Uploads GST PDF successfully and overrides on duplicates (upsert)', async () => {
      const req = {
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: `${testReqNo}_gst.pdf`,
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock gst pdf body v1'),
          size: 26
        }
      };
      const resGst1 = mockRes();
      await uploadGstBillPdf(req, resGst1);

      expect(resGst1.statusCode).toBe(201);
      expect(resGst1.jsonData.success).toBe(true);
      uploadedGstPath = resGst1.jsonData.storagePath;
      expect(uploadedGstPath).toBe(`${testReqNo}_gst.pdf`);

      const reqOverride = {
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: `${testReqNo}_gst.pdf`,
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock gst pdf body v2 (updated)'),
          size: 38
        }
      };
      const resGst2 = mockRes();
      await uploadGstBillPdf(reqOverride, resGst2);

      expect(resGst2.statusCode).toBe(201);
      expect(resGst2.jsonData.success).toBe(true);
    });

    test('Test 8: Verifies direct public access to files in the bucket is blocked', async () => {
      expect(uploadedRequisitionPath).not.toBeNull();

      const publicUrl = `${process.env.SUPABASE_URL}/storage/v1/object/public/requisition-pdfs/${uploadedRequisitionPath}`;
      const isPrivate = await checkUrlPrivate(publicUrl);

      expect(isPrivate).toBe(true);
    });

    test('Test 9: Dynamic signed URLs are generated successfully during requisition detail query', async () => {
      expect(uploadedRequisitionPath).not.toBeNull();
      expect(uploadedGstPath).not.toBeNull();

      const { data: tempRecord, error } = await supabase
        .from('requisitions')
        .insert([{
          requester_user_id: '+918276071523',
          work_order_no: 'WB_BAN_102',
          estimate_no: 'BAN_2',
          estimate_amount: 1000.00,
          state: 'West Bengal',
          district: 'Bankura',
          area_code: 'South Bengal',
          department: 'PWD',
          site_details: 'Mock site details',
          requisition_no: `REQ_M4_READ_${suffix}`,
          material_main_head: 'Pipes',
          requisition_pdf_url: uploadedRequisitionPath,
          requisition_amount: 500.00,
          gst_bill: 'Yes',
          gst_bill_pdf_url: uploadedGstPath,
          bank_details: 'SBI Account 1234567890',
          requisition_status: 'Pending',
          created_by: '+918276071523'
        }])
        .select()
        .single();

      if (error) throw error;
      tempRequisitionId = tempRecord.requisition_id;

      const reqGet = {
        params: { id: tempRequisitionId },
        user: { role: 'je', mobile_number: '+918276071523' }
      };
      const resGet = mockRes();
      await getRequisitionById(reqGet, resGet);

      expect(resGet.statusCode).toBe(200);
      expect(resGet.jsonData.success).toBe(true);

      const reqData = resGet.jsonData.requisition;
      expect(reqData.requisition_pdf_signed_url.startsWith('http')).toBe(true);
      expect(reqData.gst_bill_pdf_signed_url.startsWith('http')).toBe(true);
    });
  });
});
