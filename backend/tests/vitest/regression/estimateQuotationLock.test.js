import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { seedFinancialScenario, cleanupFinancialScenario } = require('../../helpers/financialFixture');
const mockRes = require('../../helpers/mockRes');

describe('Milestone 1 — lock_estimate_quotations and triggers', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedFinancialScenario();
  });

  afterAll(async () => {
    if (ctx && ctx.estimateId) {
      await supabase.from('estimate_quotations').delete().eq('estimate_id', ctx.estimateId);
    }
    await cleanupFinancialScenario(ctx);
  });

  test('lock_estimate_quotations locks active quotations and is idempotent', async () => {
    // 1. Insert 2 quotation rows
    const quot1 = {
      estimate_id: ctx.estimateId,
      storage_path: `test-${crypto.randomUUID()}.pdf`,
      original_filename: 'quote1.pdf',
      vendor_label: 'Vendor A',
      file_size: 1024,
      uploaded_by: ctx.jeMobile
    };
    const quot2 = {
      estimate_id: ctx.estimateId,
      storage_path: `test-${crypto.randomUUID()}.pdf`,
      original_filename: 'quote2.pdf',
      vendor_label: 'Vendor B',
      file_size: 2048,
      uploaded_by: ctx.jeMobile
    };

    const { data: inserted, error: insError } = await supabase
      .from('estimate_quotations')
      .insert([quot1, quot2])
      .select()
      .order('original_filename', { ascending: true });

    expect(insError).toBeNull();
    expect(inserted).toHaveLength(2);

    const q1 = inserted[0];
    const q2 = inserted[1];

    // Assert audit log has CREATE logs
    const { data: auditLogs, error: auditError } = await supabase
      .from('audit_log')
      .select('*')
      .eq('module_name', 'Estimate Quotation')
      .eq('action', 'CREATE');
    expect(auditError).toBeNull();
    const identifiers = auditLogs.map(l => l.record_identifier);
    expect(identifiers).toContain(q1.quotation_id);
    expect(identifiers).toContain(q2.quotation_id);

    // 2. Call RPC lock_estimate_quotations
    const { error: lockError } = await supabase.rpc('lock_estimate_quotations', {
      p_estimate_id: ctx.estimateId
    });
    expect(lockError).toBeNull();

    // Verify both are locked
    const { data: locked, error: fetchError } = await supabase
      .from('estimate_quotations')
      .select('*')
      .eq('estimate_id', ctx.estimateId)
      .order('original_filename', { ascending: true });
    expect(fetchError).toBeNull();
    expect(locked).toHaveLength(2);
    expect(locked[0].is_locked).toBe(true);
    expect(locked[0].locked_at).not.toBeNull();
    expect(locked[1].is_locked).toBe(true);
    expect(locked[1].locked_at).not.toBeNull();

    // Verify audit log has LOCK logs
    const { data: lockAuditLogs } = await supabase
      .from('audit_log')
      .select('*')
      .eq('module_name', 'Estimate Quotation')
      .eq('action', 'LOCK');
    const lockIdentifiers = lockAuditLogs.map(l => l.record_identifier);
    expect(lockIdentifiers).toContain(q1.quotation_id);
    expect(lockIdentifiers).toContain(q2.quotation_id);

    // 3. Insert 3rd row and call lock again
    const quot3 = {
      estimate_id: ctx.estimateId,
      storage_path: `test-${crypto.randomUUID()}.pdf`,
      original_filename: 'quote3.pdf',
      vendor_label: 'Vendor C',
      file_size: 4096,
      uploaded_by: ctx.jeMobile
    };
    const { data: inserted3, error: insError3 } = await supabase
      .from('estimate_quotations')
      .insert([quot3])
      .select();
    expect(insError3).toBeNull();
    const q3 = inserted3[0];

    // Call lock RPC again
    const { error: lockError2 } = await supabase.rpc('lock_estimate_quotations', {
      p_estimate_id: ctx.estimateId
    });
    expect(lockError2).toBeNull();

    // Verify 3rd is locked, and previous locked_at is unchanged (idempotency check)
    const { data: lockedFinal } = await supabase
      .from('estimate_quotations')
      .select('*')
      .eq('estimate_id', ctx.estimateId)
      .order('original_filename', { ascending: true });
    
    expect(lockedFinal).toHaveLength(3);
    expect(lockedFinal[0].is_locked).toBe(true);
    expect(lockedFinal[1].is_locked).toBe(true);
    expect(lockedFinal[2].is_locked).toBe(true);
    
    const q1_locked = lockedFinal.find(q => q.quotation_id === q1.quotation_id);
    const q2_locked = lockedFinal.find(q => q.quotation_id === q2.quotation_id);
    const q3_locked = lockedFinal.find(q => q.quotation_id === q3.quotation_id);

    const firstLock1 = locked.find(q => q.quotation_id === q1.quotation_id);
    const firstLock2 = locked.find(q => q.quotation_id === q2.quotation_id);
    expect(q1_locked.locked_at).toBe(firstLock1.locked_at);
    expect(q2_locked.locked_at).toBe(firstLock2.locked_at);
    expect(q3_locked.locked_at).not.toBeNull();
  });

  test('lock_estimate_quotations skips soft-deleted rows', async () => {
    const quot = {
      estimate_id: ctx.estimateId,
      storage_path: `test-${crypto.randomUUID()}.pdf`,
      original_filename: 'quote_deleted.pdf',
      vendor_label: 'Vendor D',
      file_size: 512,
      uploaded_by: ctx.jeMobile,
      is_deleted: true,
      deleted_by: ctx.jeMobile,
      deleted_at: new Date().toISOString()
    };

    const { data: inserted, error: insError } = await supabase
      .from('estimate_quotations')
      .insert([quot])
      .select()
      .single();
    expect(insError).toBeNull();

    // Call lock RPC
    const { error: lockError } = await supabase.rpc('lock_estimate_quotations', {
      p_estimate_id: ctx.estimateId
    });
    expect(lockError).toBeNull();

    // Verify it is still unlocked
    const { data: row } = await supabase
      .from('estimate_quotations')
      .select('*')
      .eq('quotation_id', inserted.quotation_id)
      .single();
    expect(row.is_locked).toBe(false);
    expect(row.locked_at).toBeNull();
  });
});

describe('Milestone 3 — End-to-End Workflow & Lock Integration', () => {
  let ctx;

  beforeAll(async () => {
    ctx = await seedFinancialScenario();
  });

  afterAll(async () => {
    if (ctx && ctx.estimateId) {
      await supabase.from('estimate_quotations').delete().eq('estimate_id', ctx.estimateId);
    }
    await cleanupFinancialScenario(ctx);
  });

  test('E2E workflow: Uploading in Draft -> Approving to Final Approved locks quotations -> Reopening preserves locks', async () => {
    // 1. Set status to Draft and upload a quotation
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Draft' })
      .eq('estimate_id', ctx.estimateId);

    const quot1 = {
      estimate_id: ctx.estimateId,
      storage_path: `test-${crypto.randomUUID()}.pdf`,
      original_filename: 'quote_workflow_1.pdf',
      vendor_label: 'Vendor X',
      file_size: 512,
      uploaded_by: ctx.jeMobile
    };
    const { data: q1, error: insErr } = await supabase
      .from('estimate_quotations')
      .insert([quot1])
      .select()
      .single();
    expect(insErr).toBeNull();
    expect(q1.is_locked).toBe(false);

    // 2. Fast-forward status to 'Under HO Review' and approve seeded line items in the DB
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review' })
      .eq('estimate_id', ctx.estimateId);

    await supabase
      .from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' })
      .eq('estimate_id', ctx.estimateId);

    // 3. HO Approves the estimate (invoking submitReview)
    const approveReq = {
      params: { id: ctx.estimateId },
      user: { role: 'ho', mobile_number: ctx.hoMobile },
      body: { remarks: 'HO Approved' }
    };
    const approveRes = mockRes();

    const { submitReview: submitReviewWorkflow } = require('../../../src/controllers/estimates.workflow.controller');
    await submitReviewWorkflow(approveReq, approveRes);
    expect(approveRes.statusCode).toBe(200);

    // 4. Verify estimate is now Final Approved and quotation is locked
    const { data: estFinal } = await supabase
      .from('project_cost_estimates')
      .select('estimate_status')
      .eq('estimate_id', ctx.estimateId)
      .single();
    expect(estFinal.estimate_status).toBe('Final Approved');

    const { data: q1Locked } = await supabase
      .from('estimate_quotations')
      .select('is_locked, locked_at')
      .eq('quotation_id', q1.quotation_id)
      .single();
    expect(q1Locked.is_locked).toBe(true);
    expect(q1Locked.locked_at).not.toBeNull();

    // 5. HO Reopens the estimate
    const reopenReq = {
      params: { id: ctx.estimateId },
      user: { role: 'ho', mobile_number: ctx.hoMobile }
    };
    const reopenRes = mockRes();

    const { reopenEstimate: reopenEstimateWorkflow } = require('../../../src/controllers/estimates.workflow.controller');
    await reopenEstimateWorkflow(reopenReq, reopenRes);
    expect(reopenRes.statusCode).toBe(200);

    // 6. Verify previously locked quotation remains locked
    const { data: q1PostReopen } = await supabase
      .from('estimate_quotations')
      .select('is_locked')
      .eq('quotation_id', q1.quotation_id)
      .single();
    expect(q1PostReopen.is_locked).toBe(true);

    // 7. JE uploads a second quotation post-reopen (starts unlocked)
    const quot2 = {
      estimate_id: ctx.estimateId,
      storage_path: `test-${crypto.randomUUID()}.pdf`,
      original_filename: 'quote_workflow_2.pdf',
      vendor_label: 'Vendor Y',
      file_size: 1024,
      uploaded_by: ctx.jeMobile
    };
    const { data: q2, error: insErr2 } = await supabase
      .from('estimate_quotations')
      .insert([quot2])
      .select()
      .single();
    expect(insErr2).toBeNull();
    expect(q2.is_locked).toBe(false);

    // 8. Fast-forward to Under HO Review again and re-approve to Final Approved
    await supabase
      .from('project_cost_estimates')
      .update({ estimate_status: 'Under HO Review' })
      .eq('estimate_id', ctx.estimateId);

    await supabase
      .from('project_cost_estimate_items')
      .update({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' })
      .eq('estimate_id', ctx.estimateId);

    const approveReq2 = {
      params: { id: ctx.estimateId },
      user: { role: 'ho', mobile_number: ctx.hoMobile },
      body: { remarks: 'HO Re-Approved' }
    };
    const approveRes2 = mockRes();
    await submitReviewWorkflow(approveReq2, approveRes2);
    expect(approveRes2.statusCode).toBe(200);

    // 9. First quotation stays locked; second quotation is now locked
    const { data: q1AfterReApprove } = await supabase
      .from('estimate_quotations')
      .select('is_locked')
      .eq('quotation_id', q1.quotation_id)
      .single();
    expect(q1AfterReApprove.is_locked).toBe(true);

    const { data: q2Locked } = await supabase
      .from('estimate_quotations')
      .select('is_locked, locked_at')
      .eq('quotation_id', q2.quotation_id)
      .single();
    expect(q2Locked.is_locked).toBe(true);
    expect(q2Locked.locked_at).not.toBeNull();

    // Clean up created rows in test
    await supabase.from('estimate_quotations').delete().eq('estimate_id', ctx.estimateId);
  });
});
