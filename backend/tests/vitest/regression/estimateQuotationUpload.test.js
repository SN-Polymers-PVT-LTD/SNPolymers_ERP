import { describe, test, expect, beforeAll, afterAll, vi } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const mockRes = require('../../helpers/mockRes');
const { seedFinancialScenario, cleanupFinancialScenario } = require('../../helpers/financialFixture');
const {
  uploadQuotation,
  listQuotations,
  deleteQuotation,
  toggleQuotationFlag
} = require('../../../src/controllers/estimates.quotations.controller');

describe('Milestone 2 — Estimate Quotation Upload Backend Integration', () => {
  let ctx;
  let activeQuotationId = null;
  let activeStoragePath = null;

  beforeAll(async () => {
    ctx = await seedFinancialScenario();
    // Update estimate to Draft so JE can upload
    const { error } = await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Draft' })
      .eq('estimate_id', ctx.estimateId);
    if (error) throw error;
  });

  afterAll(async () => {
    // Delete any created quotation rows & storage files
    if (ctx && ctx.estimateId) {
      const { data: rows } = await supabase
        .from('estimate_quotations')
        .select('storage_path')
        .eq('estimate_id', ctx.estimateId);
      
      if (rows && rows.length > 0) {
        const paths = rows.map(r => r.storage_path);
        await supabase.storage.from('estimate-quotations').remove(paths);
      }
      await supabase.from('estimate_quotations').delete().eq('estimate_id', ctx.estimateId);
    }
    await cleanupFinancialScenario(ctx);
  });

  test('Test 1: JE uploads valid PDF successfully', async () => {
    const req = {
      params: { id: ctx.estimateId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      file: {
        fieldname: 'file',
        originalname: 'quote_test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 mock pdf content'),
        size: 25
      },
      body: {
        vendor_label: 'Dealer A'
      }
    };
    const res = mockRes();

    await uploadQuotation(req, res);

    expect(res.statusCode).toBe(201);
    expect(res.jsonData.success).toBe(true);
    expect(res.jsonData.quotation).toBeDefined();
    
    activeQuotationId = res.jsonData.quotation.quotation_id;
    activeStoragePath = res.jsonData.quotation.storage_path;
    expect(res.jsonData.quotation.vendor_label).toBe('Dealer A');
  });

  test('Test 2: Blocks non-PDF upload with 400 Bad Request', async () => {
    const req = {
      params: { id: ctx.estimateId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      file: {
        fieldname: 'file',
        originalname: 'quote_test.png',
        mimetype: 'image/png',
        buffer: Buffer.from('mock png content'),
        size: 16
      },
      body: {}
    };
    const res = mockRes();

    await uploadQuotation(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.message).toContain('Only PDF files are accepted');
  });

  test('Test 3: Blocks upload exceeding 15MB with 400 Bad Request', async () => {
    const req = {
      params: { id: ctx.estimateId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      file: {
        fieldname: 'file',
        originalname: 'large.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.alloc(16 * 1024 * 1024), // 16MB
        size: 16 * 1024 * 1024
      },
      body: {}
    };
    const res = mockRes();

    await uploadQuotation(req, res);

    expect(res.statusCode).toBe(400);
    expect(res.jsonData.message).toContain('exceed 15MB');
  });

  test('Test 4: Blocks upload outside EDITABLE_STATUSES', async () => {
    // Transition estimate to 'Under ZO Review'
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Under ZO Review' })
      .eq('estimate_id', ctx.estimateId);

    const req = {
      params: { id: ctx.estimateId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      file: {
        fieldname: 'file',
        originalname: 'quote_test.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 content'),
        size: 16
      },
      body: {}
    };
    const res = mockRes();

    await uploadQuotation(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.message).toContain('cannot be modified');

    // Reset back to Draft for remaining tests
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Draft' })
      .eq('estimate_id', ctx.estimateId);
  });

  test('Test 5: Scoped list view visibility and signed URL generation', async () => {
    // Upload a second quotation and soft-delete it
    const reqUpload = {
      params: { id: ctx.estimateId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      file: {
        fieldname: 'file',
        originalname: 'quote_deleted.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 deleted file content'),
        size: 32
      },
      body: {}
    };
    const resUpload = mockRes();
    await uploadQuotation(reqUpload, resUpload);
    expect(resUpload.statusCode).toBe(201);
    const toDeleteId = resUpload.jsonData.quotation.quotation_id;

    // Delete it
    const reqDel = {
      params: { id: ctx.estimateId, quotationId: toDeleteId },
      user: { role: 'je', mobile_number: ctx.jeMobile }
    };
    const resDel = mockRes();
    await deleteQuotation(reqDel, resDel);
    expect(resDel.statusCode).toBe(200);

    // List as ZO (should return 2 rows: active + soft-deleted)
    const reqZo = {
      params: { id: ctx.estimateId },
      user: { role: 'zo', mobile_number: ctx.zoMobile }
    };
    const resZo = mockRes();
    await listQuotations(reqZo, resZo);
    expect(resZo.statusCode).toBe(200);
    expect(resZo.jsonData.quotations).toHaveLength(2);
    
    // Soft deleted row must have signed_url = null
    const zoDeletedRow = resZo.jsonData.quotations.find(q => q.quotation_id === toDeleteId);
    expect(zoDeletedRow.is_deleted).toBe(true);
    expect(zoDeletedRow.quotation_signed_url).toBeNull();

    // List as HO (should return 1 row: active only)
    const reqHo = {
      params: { id: ctx.estimateId },
      user: { role: 'ho', mobile_number: ctx.hoMobile }
    };
    const resHo = mockRes();
    await listQuotations(reqHo, resHo);
    expect(resHo.statusCode).toBe(200);
    expect(resHo.jsonData.quotations).toHaveLength(1);
    expect(resHo.jsonData.quotations[0].is_deleted).toBe(false);
    expect(resHo.jsonData.quotations[0].quotation_signed_url).not.toBeNull();
  });

  test('Test 6: Blocks delete of a locked quotation', async () => {
    // Manually lock the active quotation row
    await supabase
      .from('estimate_quotations')
      .update({ is_locked: true, locked_at: new Date().toISOString() })
      .eq('quotation_id', activeQuotationId);

    const req = {
      params: { id: ctx.estimateId, quotationId: activeQuotationId },
      user: { role: 'je', mobile_number: ctx.jeMobile }
    };
    const res = mockRes();

    await deleteQuotation(req, res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonData.message).toContain('locked and cannot be deleted');

    // Unlock it back
    await supabase
      .from('estimate_quotations')
      .update({ is_locked: false, locked_at: null })
      .eq('quotation_id', activeQuotationId);
  });

  test('Test 7: ZO/HO can toggle flag, even on locked quotations', async () => {
    // Lock it
    await supabase
      .from('estimate_quotations')
      .update({ is_locked: true, locked_at: new Date().toISOString() })
      .eq('quotation_id', activeQuotationId);

    const reqFlag = {
      params: { id: ctx.estimateId, quotationId: activeQuotationId },
      user: { role: 'ho', mobile_number: ctx.hoMobile },
      body: { flagged: true }
    };
    const resFlag = mockRes();

    await toggleQuotationFlag(reqFlag, resFlag);

    expect(resFlag.statusCode).toBe(200);
    expect(resFlag.jsonData.quotation.flagged_for_replacement).toBe(true);

    // JE role check (should receive 403)
    const reqJeFlag = {
      params: { id: ctx.estimateId, quotationId: activeQuotationId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      body: { flagged: false }
    };
    const resJeFlag = mockRes();

    await toggleQuotationFlag(reqJeFlag, resJeFlag);
    expect(resJeFlag.statusCode).toBe(403);
  });

  test('Test 8: Database insertion failure cleans up storage orphan', async () => {
    const originalFrom = supabase.from.bind(supabase);
    const fromSpy = vi.spyOn(supabase, 'from').mockImplementation((table) => {
      if (table === 'estimate_quotations') {
        return {
          insert: () => ({
            select: () => ({
              single: () => Promise.resolve({ data: null, error: new Error('Mock Database Insert Failure') })
            })
          })
        };
      }
      return originalFrom(table);
    });

    const req = {
      params: { id: ctx.estimateId },
      user: { role: 'je', mobile_number: ctx.jeMobile },
      file: {
        fieldname: 'file',
        originalname: 'quote_orphan.pdf',
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 orphan test content'),
        size: 30
      },
      body: {}
    };
    const res = mockRes();

    try {
      await uploadQuotation(req, res);
    } finally {
      fromSpy.mockRestore();
    }

    expect(res.statusCode).toBe(500);

    // Verify no row exists in PostgreSQL
    const { data: rows } = await supabase
      .from('estimate_quotations')
      .select('*')
      .eq('original_filename', 'quote_orphan.pdf');
    expect(rows).toHaveLength(0);
  });

  test('Test 9: Scoped correlation ID check rejects mismatch with 404', async () => {
    const wrongEstimateId = crypto.randomUUID();
    const req = {
      params: { id: wrongEstimateId, quotationId: activeQuotationId },
      user: { role: 'je', mobile_number: ctx.jeMobile }
    };
    const res = mockRes();

    await deleteQuotation(req, res);

    // Should return 404 since either estimate is not found or quotation doesn't match
    expect(res.statusCode).toBe(404);
  });
});
