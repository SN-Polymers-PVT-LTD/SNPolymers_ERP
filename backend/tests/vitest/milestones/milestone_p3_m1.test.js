import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');

describe('Milestone P3-M1 — Database Foundation Verification', () => {
  let suffix;
  let testZofrNo1;
  let testZofrNo2;
  const testZoMobile = '+918000000001'; 
  const testAdminMobile = '+918276071523';
  let insertedRequest1 = null;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    testZofrNo1 = `TEST_ZO_FR_${suffix}_1`;
    testZofrNo2 = `TEST_ZO_FR_${suffix}_2`;
  });

  describe('Fund Request Operations', () => {
    test('Test 1: Inserts a valid fund request row successfully', async () => {
      const { data: fr1, error: errFr1 } = await supabase
        .from('fund_requests')
        .insert([
          {
            zo_user_id: testZoMobile,
            zo_fr_no: testZofrNo1,
            zo_fr_amount: 50000.00,
            zo_remarks: 'Test Request 1',
            created_by: testZoMobile
          }
        ])
        .select()
        .single();

      expect(errFr1).toBeNull();
      expect(fr1).toBeDefined();
      insertedRequest1 = fr1;
    });

    test('Test 2: Blocks duplicate request number via unique constraint', async () => {
      const { error: errFrDup } = await supabase
        .from('fund_requests')
        .insert([
          {
            zo_user_id: testZoMobile,
            zo_fr_no: testZofrNo1, // Duplicate
            zo_fr_amount: 25000.00,
            created_by: testZoMobile
          }
        ]);

      expect(errFrDup).not.toBeNull();
      expect(errFrDup.code).toBe('23505'); // unique_violation
    });

    test('Test 3: Inserts request with different request number successfully', async () => {
      const { data: fr2, error: errFr2 } = await supabase
        .from('fund_requests')
        .insert([
          {
            zo_user_id: testZoMobile,
            zo_fr_no: testZofrNo2,
            zo_fr_amount: 15000.00,
            created_by: testZoMobile
          }
        ])
        .select()
        .single();

      expect(errFr2).toBeNull();
      expect(fr2).toBeDefined();
    });

    test('Test 4: Blocks hard delete of fund request via trigger', async () => {
      expect(insertedRequest1).not.toBeNull();

      const { error: errDelete } = await supabase
        .from('fund_requests')
        .delete()
        .eq('fund_request_id', insertedRequest1.fund_request_id);

      expect(errDelete).not.toBeNull();
      expect(errDelete.message).toContain('permanently prohibited');
    });

    test('Test 5: Verifying status change audit trigger captures status update', async () => {
      expect(insertedRequest1).not.toBeNull();

      const { error: errUpdateStatus } = await supabase
        .from('fund_requests')
        .update({
          request_status: 'Cancelled',
          cancelled_by: testZoMobile,
          cancelled_at: new Date().toISOString()
        })
        .eq('fund_request_id', insertedRequest1.fund_request_id);

      expect(errUpdateStatus).toBeNull();

      const { data: auditLog, error: errAudit } = await supabase
        .from('audit_log')
        .select('*')
        .eq('record_identifier', insertedRequest1.fund_request_id)
        .eq('action', 'STATUS_CHANGE')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();

      expect(errAudit).toBeNull();
      expect(auditLog).not.toBeNull();
      expect(auditLog.new_value?.request_status).toBe('Cancelled');
    });

    test('Test 6: Verifying updated_at trigger updates timestamp on record updates', async () => {
      expect(insertedRequest1).not.toBeNull();

      const { data: frBefore } = await supabase
        .from('fund_requests')
        .select('updated_at')
        .eq('fund_request_id', insertedRequest1.fund_request_id)
        .single();

      // Wait a moment to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 1000));

      const { data: frAfter, error: errUpdateRemarks } = await supabase
        .from('fund_requests')
        .update({ zo_remarks: 'Updated Remarks' })
        .eq('fund_request_id', insertedRequest1.fund_request_id)
        .select()
        .single();

      expect(errUpdateRemarks).toBeNull();
      expect(frAfter).toBeDefined();

      const timeBefore = new Date(frBefore.updated_at).getTime();
      const timeAfter = new Date(frAfter.updated_at).getTime();
      expect(timeAfter).toBeGreaterThan(timeBefore);
    });
  });
});
