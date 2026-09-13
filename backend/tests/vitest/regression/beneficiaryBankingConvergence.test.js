import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const mockRes = require('../../helpers/mockRes');
const setupAttachment = require('../../helpers/setupAttachment');
const {
  seedAcctRequisitionScenario,
  cleanupAcctRequisitionScenario
} = require('../../helpers/acctRequisitionFixture');
const {
  validateActiveIndianBank
} = require('../../../src/services/indianBanks.service');
const {
  addLineItemSchema,
  updateLineItemSchema,
  upsertBeneficiarySchema
} = require('../../../src/validation/acctRequisition.schema');
const {
  createRequisitionSchema
} = require('../../../src/validation/requisition.schema');
const {
  createRequisition
} = require('../../../src/controllers/requisitions.controller');
const {
  createSheet,
  addLineItem,
  updateLineItem,
  upsertBeneficiary
} = require('../../../src/controllers/acctRequisition.controller');
const { supabase } = require('../../../src/db/supabase');

describe('Part 1 — Beneficiary Banking Convergence Suite', () => {
  let ctx;
  let activeBank;
  let inactiveBankId;

  beforeAll(async () => {
    ctx = await seedAcctRequisitionScenario();

    // Create a real sheet and line item for testing updateLineItem
    const sheetRes = mockRes();
    await createSheet({ body: {}, user: { role: 'accounts', mobile_number: ctx.accountsMobile } }, sheetRes);
    ctx.sheetId = sheetRes.jsonData.sheet.id;

    const itemRes = mockRes();
    await addLineItem({
      params: { sheetId: ctx.sheetId },
      body: { particulars: 'Initial Item' },
      user: { role: 'accounts', mobile_number: ctx.accountsMobile }
    }, itemRes);
    ctx.lineItemId = itemRes.jsonData.item.id;

    // Find an active bank from indian_bank_master
    const { data: banks } = await supabase
      .from('indian_bank_master')
      .select('*')
      .eq('is_active', true)
      .limit(1);

    if (banks && banks.length > 0) {
      activeBank = banks[0];
    } else {
      const { data: adminUser } = await supabase
        .from('authorised_users')
        .select('mobile_number')
        .ilike('role', 'admin')
        .limit(1)
        .single();

      const { data: newBank } = await supabase
        .from('indian_bank_master')
        .insert({
          bank_name: `Test Active Bank ${ctx.id}`,
          is_active: true,
          created_by: adminUser.mobile_number
        })
        .select()
        .single();
      activeBank = newBank;
    }

    // Insert a temporary inactive bank for validation testing
    const { data: adminUser } = await supabase
      .from('authorised_users')
      .select('mobile_number')
      .ilike('role', 'admin')
      .limit(1)
      .single();

    const { data: inBank } = await supabase
      .from('indian_bank_master')
      .insert({
        bank_name: `Test Inactive Bank ${ctx.id}`,
        is_active: false,
        created_by: adminUser.mobile_number
      })
      .select()
      .single();
    inactiveBankId = inBank?.id;
  });

  afterAll(async () => {
    if (inactiveBankId) {
      await supabase.from('indian_bank_master').delete().eq('id', inactiveBankId);
    }
    await cleanupAcctRequisitionScenario(ctx);
  });

  describe('1. Zod Schema Validation Contracts', () => {
    test('accepts valid UUID for beneficiary_bank_id in addLineItemSchema', () => {
      const parsed = addLineItemSchema.body.safeParse({
        beneficiary_bank_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      });
      expect(parsed.success).toBe(true);
    });

    test('accepts null or undefined for beneficiary_bank_id in addLineItemSchema', () => {
      expect(addLineItemSchema.body.safeParse({ beneficiary_bank_id: null }).success).toBe(true);
      expect(addLineItemSchema.body.safeParse({}).success).toBe(true);
    });

    test('rejects non-UUID string for beneficiary_bank_id in addLineItemSchema', () => {
      const parsed = addLineItemSchema.body.safeParse({
        beneficiary_bank_id: 'not-a-uuid'
      });
      expect(parsed.success).toBe(false);
    });

    test('accepts valid UUID in createRequisitionSchema', () => {
      const parsed = createRequisitionSchema.body.safeParse({
        work_order_no: 'WO/TEST/001',
        requisition_no: 'REQ-TEST-001',
        material_main_head: 'Labour',
        requisition_pdf_attachment_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
        original_filename: 'test.pdf',
        requisition_amount: 5000,
        gst_bill: 'No',
        bank_details: 'SBI',
        beneficiary_name: 'Test Beneficiary',
        beneficiary_ac_no: '9876543210',
        beneficiary_ifsc: 'SBIN0001234',
        beneficiary_bank_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
      });
      expect(parsed.success).toBe(true);
    });

    test('rejects non-UUID in createRequisitionSchema', () => {
      const parsed = createRequisitionSchema.body.safeParse({
        work_order_no: 'WO/TEST/001',
        requisition_no: 'REQ-TEST-001',
        material_main_head: 'Labour',
        requisition_pdf_attachment_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12',
        original_filename: 'test.pdf',
        requisition_amount: 5000,
        gst_bill: 'No',
        bank_details: 'SBI',
        beneficiary_name: 'Test Beneficiary',
        beneficiary_ac_no: '9876543210',
        beneficiary_ifsc: 'SBIN0001234',
        beneficiary_bank_id: 'invalid-id'
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe('2. Bank Service Validation (validateActiveIndianBank)', () => {
    test('valid active bank returns { valid: true, bank }', async () => {
      const result = await validateActiveIndianBank(activeBank.id);
      expect(result.valid).toBe(true);
      expect(result.bank.id).toBe(activeBank.id);
      expect(result.bank.bank_name).toBe(activeBank.bank_name);
    });

    test('unknown UUID returns { valid: false, reason: "NOT_FOUND" }', async () => {
      const result = await validateActiveIndianBank('00000000-0000-0000-0000-000000000000');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('NOT_FOUND');
    });

    test('inactive bank returns { valid: false, reason: "INACTIVE" }', async () => {
      const result = await validateActiveIndianBank(inactiveBankId);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('INACTIVE');
    });
  });

  describe('3. Controller Rejection Contracts (422 Unprocessable Entity)', () => {
    test('createRequisition rejects non-existent bank_id with 422', async () => {
      const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: ctx.accountsMobile });
      const req = {
        body: {
          work_order_no: 'WO_TEST_001',
          requisition_no: `REQ_${ctx.id.slice(0, 8)}`,
          material_main_head: 'Civil Works',
          requisition_pdf_attachment_id: attachment.attachmentId,
          original_filename: 'test.pdf',
          requisition_amount: 1000,
          gst_bill: 'No',
          bank_details: 'Test',
          beneficiary_name: 'Test Beneficiary',
          beneficiary_ac_no: '9876543210',
          beneficiary_ifsc: 'SBIN0001234',
          beneficiary_bank_id: '00000000-0000-0000-0000-000000000000'
        },
        user: { role: 'site_engineer', mobile_number: ctx.accountsMobile }
      };
      const res = mockRes();
      await createRequisition(req, res);
      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toBe('Selected bank does not exist.');
    });

    test('createRequisition rejects inactive bank_id with 422', async () => {
      const attachment = await setupAttachment({ kind: 'requisition_pdf', uploadedBy: ctx.accountsMobile });
      const req = {
        body: {
          work_order_no: 'WO_TEST_001',
          requisition_no: `REQ_${ctx.id.slice(0, 8)}`,
          material_main_head: 'Civil Works',
          requisition_pdf_attachment_id: attachment.attachmentId,
          original_filename: 'test.pdf',
          requisition_amount: 1000,
          gst_bill: 'No',
          bank_details: 'Test',
          beneficiary_name: 'Test Beneficiary',
          beneficiary_ac_no: '9876543210',
          beneficiary_ifsc: 'SBIN0001234',
          beneficiary_bank_id: inactiveBankId
        },
        user: { role: 'site_engineer', mobile_number: ctx.accountsMobile }
      };
      const res = mockRes();
      await createRequisition(req, res);
      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toBe('Selected bank is currently inactive.');
    });

    test('updateLineItem rejects non-existent bank_id with 422', async () => {
      const req = {
        params: { sheetId: ctx.sheetId, itemId: ctx.lineItemId },
        body: {
          beneficiary_bank_id: '00000000-0000-0000-0000-000000000000'
        },
        user: { role: 'accounts', mobile_number: ctx.accountsMobile }
      };
      const res = mockRes();
      await updateLineItem(req, res);
      expect(res.statusCode).toBe(422);
      expect(res.jsonData.message).toBe('Selected bank does not exist.');
    });
  });

  describe('4. End-to-End Roundtrip & Clearability', () => {
    test('saving line item with bank ID stores both ID and snapshot, and enriches response', async () => {
      const req = {
        params: { sheetId: ctx.sheetId, itemId: ctx.lineItemId },
        body: {
          beneficiary_bank_id: activeBank.id,
          beneficiary_ac_no: '1234567890',
          beneficiary_ifsc: 'SBIN0001234',
          beneficiary_name: 'Test Beneficiary Vendor'
        },
        user: { role: 'accounts', mobile_number: ctx.accountsMobile }
      };
      const res = mockRes();
      await updateLineItem(req, res);
      expect(res.statusCode).toBe(200);

      // Verify DB row
      const { data: row } = await supabase
        .from('acct_requisition_line_items')
        .select('beneficiary_bank_id, beneficiary_bank_name')
        .eq('id', ctx.lineItemId)
        .single();

      expect(row.beneficiary_bank_id).toBe(activeBank.id);
      expect(row.beneficiary_bank_name).toBe(activeBank.bank_name);

      // Verify API response enrichment
      expect(res.jsonData.item.beneficiary_bank).toEqual({
        id: activeBank.id,
        bank_name: activeBank.bank_name
      });
      expect(res.jsonData.item.beneficiary_bank_name).toBe(activeBank.bank_name);
    });

    test('clearing bank to null resets both beneficiary_bank_id and beneficiary_bank_name in DB', async () => {
      const req = {
        params: { sheetId: ctx.sheetId, itemId: ctx.lineItemId },
        body: {
          beneficiary_bank_id: null,
          beneficiary_bank_name: null
        },
        user: { role: 'accounts', mobile_number: ctx.accountsMobile }
      };
      const res = mockRes();
      await updateLineItem(req, res);
      expect(res.statusCode).toBe(200);

      // Verify DB row was cleared (no stubborn COALESCE retention)
      const { data: row } = await supabase
        .from('acct_requisition_line_items')
        .select('beneficiary_bank_id, beneficiary_bank_name')
        .eq('id', ctx.lineItemId)
        .single();

      expect(row.beneficiary_bank_id).toBeNull();
      expect(row.beneficiary_bank_name).toBeNull();
    });

    test('beneficiary_master upsert with bank ID enriches response and derives bank_name', async () => {
      const testAcNo = `987654321${ctx.id.slice(0, 5)}`;
      const req = {
        body: {
          account_number: testAcNo,
          ifsc: 'HDFC0000106',
          beneficiary_name: 'Master Payee',
          beneficiary_bank_id: activeBank.id
        },
        user: { role: 'accounts', mobile_number: ctx.accountsMobile }
      };
      const res = mockRes();
      await upsertBeneficiary(req, res);
      expect(res.statusCode).toBe(200);
      expect(res.jsonData.beneficiary.beneficiary_bank_id).toBe(activeBank.id);
      expect(res.jsonData.beneficiary.beneficiary_bank.bank_name).toBe(activeBank.bank_name);

      // Cleanup
      await supabase.from('beneficiary_master').delete().eq('account_number', testAcNo);
    });
  });

  describe('5. Admin-Only Attribution Convention', () => {
    test('all rows in indian_bank_master have created_by set to an admin user', async () => {
      const { data: banks } = await supabase
        .from('indian_bank_master')
        .select('bank_name, created_by, authorised_users!created_by(role)')
        .limit(10);

      expect(banks.length).toBeGreaterThan(0);
      for (const bank of banks) {
        expect(bank.created_by).toBeTruthy();
        expect(bank.authorised_users?.role?.toLowerCase()).toContain('admin');
      }
    });
  });
});
