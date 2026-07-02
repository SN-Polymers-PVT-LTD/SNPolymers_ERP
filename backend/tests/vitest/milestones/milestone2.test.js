import { describe, test, expect, beforeEach, afterEach } from 'vitest';
const { supabase } = require('../../../src/db/supabase');
const requireRole = require('../../../src/middleware/requireRole');
const mockRes = require('../../helpers/mockRes');
const {
  getPurchaseOptions,
  createPurchaseOption,
  updatePurchaseOption,
  togglePurchaseOptionStatus
} = require('../../../src/controllers/purchaseData.controller');

describe('Milestone 2 — Integration Tests', () => {
  beforeEach(async () => {
    // Clean up any test leftovers
    await supabase.from('purchase_data').delete().filter('name', 'ilike', 'TEST_M2_%');
  });

  afterEach(async () => {
    // Clean up all M2 test rows
    await supabase.from('purchase_data').delete().filter('name', 'ilike', 'TEST_M2_%');
  });

  describe('requireRole Middleware', () => {
    test('blocks unauthorized roles (returns 403)', () => {
      const jeGuard = requireRole(['je', 'admin']);
      let nextCalled = false;
      const reqZo = { user: { role: 'zo' } };
      const resZo = mockRes();

      jeGuard(reqZo, resZo, () => { nextCalled = true; });

      expect(nextCalled).toBe(false);
      expect(resZo.statusCode).toBe(403);
    });

    test('allows authorized roles', () => {
      const jeGuard = requireRole(['je', 'admin']);
      let nextCalled = false;
      const reqJe = { user: { role: 'je' } };
      const resJe = mockRes();

      jeGuard(reqJe, resJe, () => { nextCalled = true; });

      expect(nextCalled).toBe(true);
    });
  });

  describe('Purchase Options CRUD Operations', () => {
    test('creates a valid purchase option and trims leading/trailing spaces', async () => {
      const reqCreate = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        body: { name: '  TEST_M2_Local Market  ' }
      };
      const resCreate = mockRes();
      await createPurchaseOption(reqCreate, resCreate);

      expect(resCreate.statusCode).toBe(201);
      expect(resCreate.jsonData.success).toBe(true);
      expect(resCreate.jsonData.purchaseOption.name).toBe('TEST_M2_Local Market');
    });

    test('blocks duplicate purchase option names case-insensitively', async () => {
      // Setup first option
      await supabase.from('purchase_data').insert([{ name: 'TEST_M2_Local Market', created_by: '+918276071523' }]);

      // Attempt duplicate
      const reqDuplicate = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        body: { name: 'test_m2_local market' }
      };
      const resDuplicate = mockRes();
      await createPurchaseOption(reqDuplicate, resDuplicate);

      expect(resDuplicate.statusCode).toBe(409);
      expect(resDuplicate.jsonData.success).toBe(false);
    });

    test('rejects blank/whitespace purchase option names', async () => {
      const reqBlank = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        body: { name: '   ' }
      };
      const resBlank = mockRes();
      await createPurchaseOption(reqBlank, resBlank);

      expect(resBlank.statusCode).toBe(400);
      expect(resBlank.jsonData.success).toBe(false);
    });

    test('updates option name with duplicate protection and trimming', async () => {
      // Setup options
      const { data: option1 } = await supabase.from('purchase_data').insert([{ name: 'TEST_M2_Local Market', created_by: '+918276071523' }]).select().single();
      const { data: option2 } = await supabase.from('purchase_data').insert([{ name: 'TEST_M2_Other Option', created_by: '+918276071523' }]).select().single();

      // Update option2 to duplicate name of option1
      const reqUpdateDup = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: option2.id },
        body: { name: 'test_m2_local market' }
      };
      const resUpdateDup = mockRes();
      await updatePurchaseOption(reqUpdateDup, resUpdateDup);

      expect(resUpdateDup.statusCode).toBe(409);

      // Update option2 to valid name with trimming
      const reqUpdateOk = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: option2.id },
        body: { name: '  TEST_M2_Third Option  ' }
      };
      const resUpdateOk = mockRes();
      await updatePurchaseOption(reqUpdateOk, resUpdateOk);

      expect(resUpdateOk.statusCode).toBe(200);
      expect(resUpdateOk.jsonData.purchaseOption.name).toBe('TEST_M2_Third Option');
    });

    test('toggles active status atomically', async () => {
      const { data: option } = await supabase.from('purchase_data').insert([{ name: 'TEST_M2_Local Market', created_by: '+918276071523' }]).select().single();

      const reqToggle = {
        user: { role: 'admin', mobile_number: '+918276071523' },
        params: { id: option.id }
      };
      
      // First toggle (true -> false)
      const resToggle1 = mockRes();
      await togglePurchaseOptionStatus(reqToggle, resToggle1);
      expect(resToggle1.jsonData.purchaseOption.is_active).toBe(false);

      // Second toggle (false -> true)
      const resToggle2 = mockRes();
      await togglePurchaseOptionStatus(reqToggle, resToggle2);
      expect(resToggle2.jsonData.purchaseOption.is_active).toBe(true);
    });

    test('sorts list case-insensitively and filters active options for non-admins', async () => {
      // Seed sorting options
      const optionsToCreate = [
        { name: 'TEST_M2_C Option', created_by: '+918276071523' },
        { name: 'TEST_M2_a Option', created_by: '+918276071523' },
        { name: 'TEST_M2_B Option', created_by: '+918276071523' }
      ];
      await supabase.from('purchase_data').insert(optionsToCreate);

      // Get options as non-admin (JE)
      const reqGetNonAdmin = {
        user: { role: 'je', mobile_number: '+919999999999' }
      };
      const resGetNonAdmin = mockRes();
      await getPurchaseOptions(reqGetNonAdmin, resGetNonAdmin);

      const m2Options = resGetNonAdmin.jsonData.purchaseOptions.filter(o => o.name.startsWith('TEST_M2_'));
      const names = m2Options.map(o => o.name);

      // Verify relative case-insensitive sorting (a < B < C)
      const indexA = names.indexOf('TEST_M2_a Option');
      const indexB = names.indexOf('TEST_M2_B Option');
      const indexC = names.indexOf('TEST_M2_C Option');

      expect(indexA).toBeGreaterThan(-1);
      expect(indexB).toBeGreaterThan(-1);
      expect(indexC).toBeGreaterThan(-1);
      expect(indexA).toBeLessThan(indexB);
      expect(indexB).toBeLessThan(indexC);

      // Deactivate one option and verify non-admin cannot see it but admin can
      const { data: optionToDeactivate } = await supabase.from('purchase_data').select('id').eq('name', 'TEST_M2_a Option').single();
      await supabase.from('purchase_data').update({ is_active: false }).eq('id', optionToDeactivate.id);

      // Check non-admin again
      const resGetNonAdmin2 = mockRes();
      await getPurchaseOptions(reqGetNonAdmin, resGetNonAdmin2);
      const isVisibleToNonAdmin = resGetNonAdmin2.jsonData.purchaseOptions.some(o => o.id === optionToDeactivate.id);
      expect(isVisibleToNonAdmin).toBe(false);

      // Check admin
      const reqGetAdmin = {
        user: { role: 'admin', mobile_number: '+918276071523' }
      };
      const resGetAdmin = mockRes();
      await getPurchaseOptions(reqGetAdmin, resGetAdmin);
      const isVisibleToAdmin = resGetAdmin.jsonData.purchaseOptions.some(o => o.id === optionToDeactivate.id);
      expect(isVisibleToAdmin).toBe(true);
    });
  });
});
