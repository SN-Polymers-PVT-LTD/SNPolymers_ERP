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

const http = require('http');

function checkUrlPrivate(url) {
  const client = url.startsWith('https:') ? https : http;
  return new Promise((resolve) => {
    client.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        const isErrorJson = data.includes('"error"') || data.includes('Not Found') || data.includes('statusCode');
        const isPrivate = res.statusCode !== 200 || isErrorJson;
        resolve(isPrivate);
      });
    }).on('error', () => {
      resolve(true);
    });
  });
}

const setupProject = require('../../helpers/setupProject');
const setupUsers = require('../../helpers/setupUsers');

describe('Milestone P4-M4 — Requisitions File Upload & Storage', () => {
  let suffix;
  let testReqNo;
  let testMobile;
  let testWorkOrder;
  let uploadedRequisitionPath = null;
  let uploadedRequisitionAttachmentId = null;
  let uploadedGstPath = null;
  let tempRequisitionId = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testReqNo = `REQ_M4_FILE_${suffix}`;
    testMobile = `9301${suffix}`;
    testWorkOrder = `WO_P4M4_${suffix}`;

    await setupUsers([
      { mobile_number: testMobile, role: 'admin', is_active: true, display_name: `Test Staff ${suffix}` }
    ]);
    await setupProject(testWorkOrder, `EST_M4_${suffix}`, 500000.00, testMobile);
  });

  afterAll(async () => {
    // Delete files from storage
    if (uploadedRequisitionPath) {
      await supabase.storage.from('requisition-pdfs').remove([uploadedRequisitionPath]);
    }
    if (uploadedGstPath) {
      await supabase.storage.from('gst-bills').remove([uploadedGstPath]);
    }
    // Delete attachment tracking rows (the requisition row inserted directly in Test 9
    // never claimed them, so they'd otherwise be left dangling as 'pending')
    if (uploadedRequisitionPath || uploadedGstPath) {
      await supabase.from('requisition_attachments').delete().in('storage_path', [uploadedRequisitionPath, uploadedGstPath].filter(Boolean));
    }
    // Delete temp DB record
    if (tempRequisitionId) {
      await supabase.from('requisitions').delete().eq('requisition_id', tempRequisitionId);
    }
    if (testWorkOrder) {
      await supabase.from('projects_master').delete().eq('work_order_no', testWorkOrder);
    }
    if (testMobile) {
      await supabase.from('authorised_users').delete().eq('mobile_number', testMobile);
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
        user: { mobile_number: testMobile, role: 'admin' },
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
        user: { mobile_number: testMobile, role: 'admin' },
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
        user: { mobile_number: testMobile, role: 'admin' },
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
    test('Test 5: Uploads valid Requisition PDF successfully, path is UUID-based, pending attachment row is created', async () => {
      const req = {
        user: { mobile_number: testMobile, role: 'admin' },
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
      // No longer name-derived — a fresh UUID + .pdf, independent of requisition_no.
      expect(uploadedRequisitionPath).toMatch(/^[0-9a-f-]{36}\.pdf$/);
      expect(typeof res.jsonData.signedUrl).toBe('string');
      expect(typeof res.jsonData.attachmentId).toBe('string');
      uploadedRequisitionAttachmentId = res.jsonData.attachmentId;

      const { data: row, error } = await supabase
        .from('requisition_attachments')
        .select('bucket, storage_path, kind, uploaded_by, status, requisition_id')
        .eq('attachment_id', uploadedRequisitionAttachmentId)
        .single();
      expect(error).toBeNull();
      expect(row.bucket).toBe('requisition-pdfs');
      expect(row.storage_path).toBe(uploadedRequisitionPath);
      expect(row.kind).toBe('requisition_pdf');
      expect(row.uploaded_by).toBe(testMobile);
      expect(row.status).toBe('pending');
      expect(row.requisition_id).toBeNull();
    });

    test('Test 6: A second upload for the same requisition_no produces an independent pending row (UUID paths never collide)', async () => {
      expect(uploadedRequisitionPath).not.toBeNull();

      const req = {
        user: { mobile_number: testMobile, role: 'admin' },
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: `${testReqNo}.pdf`,
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock pdf body, second upload'),
          size: 38
        }
      };
      const res = mockRes();
      await uploadRequisitionPdf(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);
      expect(res.jsonData.storagePath).not.toBe(uploadedRequisitionPath);
      expect(res.jsonData.attachmentId).not.toBe(uploadedRequisitionAttachmentId);

      // Clean up the second (throwaway) upload — the rest of the suite keeps using the
      // first one (uploadedRequisitionPath / uploadedRequisitionAttachmentId).
      await supabase.storage.from('requisition-pdfs').remove([res.jsonData.storagePath]);
      await supabase.from('requisition_attachments').delete().eq('attachment_id', res.jsonData.attachmentId);
    });

    test('Test 7: Uploads GST PDF successfully with its own UUID path and pending attachment row', async () => {
      const req = {
        user: { mobile_number: testMobile, role: 'admin' },
        body: { requisition_no: testReqNo },
        file: {
          fieldname: 'file',
          originalname: `${testReqNo}_gst.pdf`,
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.4 mock gst pdf body'),
          size: 26
        }
      };
      const res = mockRes();
      await uploadGstBillPdf(req, res);

      expect(res.statusCode).toBe(201);
      expect(res.jsonData.success).toBe(true);
      uploadedGstPath = res.jsonData.storagePath;
      expect(uploadedGstPath).toMatch(/^[0-9a-f-]{36}\.pdf$/);

      const { data: row, error } = await supabase
        .from('requisition_attachments')
        .select('bucket, kind, status')
        .eq('attachment_id', res.jsonData.attachmentId)
        .single();
      expect(error).toBeNull();
      expect(row.bucket).toBe('gst-bills');
      expect(row.kind).toBe('gst_bill');
      expect(row.status).toBe('pending');
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
          requester_user_id: testMobile,
          work_order_no: testWorkOrder,
          estimate_no: `EST_M4_${suffix}`,
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
          created_by: testMobile
        }])
        .select()
        .single();

      if (error) throw error;
      tempRequisitionId = tempRecord.requisition_id;

      const reqGet = {
        params: { id: tempRequisitionId },
        user: { role: 'je', mobile_number: testMobile }
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
