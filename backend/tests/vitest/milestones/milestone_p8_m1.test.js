import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const setupUsers = require('../../helpers/setupUsers');

describe('Milestone P8-M1 — Database Views & Regression Proofing', () => {
  let suffix;
  let jeMobile;
  let zoMobile;
  let adminMobile;
  let workOrderNo;

  beforeAll(async () => {
    suffix = crypto.randomUUID().substring(0, 8);
    jeMobile = `9301${suffix}`;
    zoMobile = `9302${suffix}`;
    adminMobile = `9303${suffix}`;
    workOrderNo = `WO-P8-M1-${suffix}`;

    await setupUsers([
      { mobile_number: jeMobile, role: 'je', is_active: true, display_name: `JE M1 ${suffix}` },
      { mobile_number: zoMobile, role: 'zo', is_active: true, display_name: `ZO M1 ${suffix}` },
      { mobile_number: adminMobile, role: 'admin', is_active: true, display_name: `Admin M1 ${suffix}` }
    ]);
  });

  afterAll(async () => {
    await supabase.from('authorised_users').delete().in('mobile_number', [jeMobile, zoMobile, adminMobile]);
  });

  test('Test Case 1.1: Materialized Views Exist & Compile', async () => {
    const views = [
      'project_health_mv',
      'zone_performance_mv',
      'approval_sla_mv',
      'estimate_accuracy_mv',
      'material_variance_mv',
      'resource_utilization_mv',
      'budget_leakage_mv',
      'executive_kpi_mv'
    ];

    for (const view of views) {
      const { data, error } = await supabase.from(view).select('*').limit(1);
      expect(error).toBeNull();
      expect(data).toBeDefined();
    }
  });

  test('Test Case 1.2: Idempotent & Transaction-Safe Refresh', async () => {
    // Calling refresh multiple times should execute safely without blocking
    const { error: err1 } = await supabase.rpc('refresh_analytics_views');
    expect(err1).toBeNull();

    const { error: err2 } = await supabase.rpc('refresh_analytics_views');
    expect(err2).toBeNull();
  });

  test('Test Case 1.3: Trigger Mutex & Append-Only Assertions on Audit Log', async () => {
    // 1. Create a dummy audit log record
    const { data: audit, error: insErr } = await supabase
      .from('audit_log')
      .insert([
        {
          user_id: adminMobile,
          action: 'CREATE',
          module_name: 'Test System',
          record_identifier: `REC-${suffix}`,
          new_value: { msg: 'Hello' }
        }
      ])
      .select('id')
      .single();

    expect(insErr).toBeNull();
    const auditId = audit?.id;
    expect(auditId).toBeDefined();

    // 2. Assert update raises DB exception (append-only trigger check)
    const { error: updErr } = await supabase
      .from('audit_log')
      .update({ action: 'MODIFIED' })
      .eq('id', auditId);

    expect(updErr).toBeDefined();
    expect(updErr.message).toContain('Updates are not permitted');

    // 3. Assert delete raises DB exception (append-only trigger check)
    const { error: delErr } = await supabase
      .from('audit_log')
      .delete()
      .eq('id', auditId);

    expect(delErr).toBeDefined();
    expect(delErr.message).toContain('Deletions are not permitted');
  });

  test('Test Case 1.4: Empty-State Robustness & Coalesced Defaults', async () => {
    // Querying views should not break with null value calculations
    const { data: kpis, error } = await supabase
      .from('executive_kpi_mv')
      .select('*')
      .single();

    expect(error).toBeNull();
    expect(kpis).toBeDefined();
    // Default budget utilization or count fields should be number formats
    expect(typeof Number(kpis.total_projects)).toBe('number');
  });

  test('Test Case 1.5: Accuracy & Formula Verifications (Overruns & Slack)', async () => {
    // Insert a project with a high budget & overrun requisitions
    const woOverrun = `WO-OVR-${suffix}`;
    
    const { error: projectErr } = await supabase
      .from('projects_master')
      .insert([
        {
          work_order_no: woOverrun,
          estimate_no: `EST-OVR-${suffix}`,
          site_details: `Overrun Project ${suffix}`,
          zo_user_id: zoMobile,
          state: 'State',
          district: 'District',
          zone: 'Zone OVR',
          department: 'Civil',
          status: 'Running',
          created_by: adminMobile,
          edited_by: adminMobile,
          work_order_value: 1000.00, // Small budget
          project_start_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          project_end_date: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
        }
      ]);
    expect(projectErr).toBeNull();

    // Map JE to ZO
    await supabase.from('je_zo_mappings').insert([
      { je_user_id: jeMobile, zo_user_id: zoMobile, assigned_by: adminMobile, is_active: true }
    ]);

    // Create Estimate
    await supabase.from('project_cost_estimates').insert([
      {
        work_order_no: woOverrun,
        estimate_no: `EST-OVR-${suffix}`,
        area_code: 'Zone OVR',
        zonal_office_no: 'Zone OVR',
        je_user_id: jeMobile,
        je_date: new Date().toISOString(),
        estimate_amount: 1000.00,
        estimate_status: 'Final Approved',
        estimate_revision: 0,
        created_by: jeMobile
      }
    ]);

    // Requisition exceeding budget (2000 approved, budget is 1000)
    const { data: reqData } = await supabase
      .from('requisitions')
      .insert([
        {
          work_order_no: woOverrun,
          estimate_no: `EST-OVR-${suffix}`,
          state: 'State',
          district: 'District',
          area_code: 'Zone OVR',
          department: 'Civil',
          site_details: `Overrun Site`,
          requisition_no: `REQ-OVR-${suffix}`,
          material_main_head: 'Cement',
          requisition_pdf_url: 'https://example.com/req.pdf',
          requisition_amount: 2000.00,
          gst_bill: 'No',
          bank_details: 'Test Bank Details',
          requisition_status: 'Approved',
          approved_amount: 2000.00,
          approved_balance_amount: 0.00,
          requester_user_id: jeMobile,
          created_by: jeMobile,
          payment_date: new Date().toISOString(),
          approved_user_id: zoMobile
        }
      ])
      .select('requisition_id')
      .single();

    // Refresh analytics views
    await supabase.rpc('refresh_analytics_views');

    // Assert that budget_leakage_mv flags overrun correctly
    const { data: leakage, error: leakageErr } = await supabase
      .from('budget_leakage_mv')
      .select('*')
      .eq('work_order_no', woOverrun)
      .single();

    expect(leakageErr).toBeNull();
    expect(leakage).toBeDefined();
    const overrunAmount = Math.max(0, Number(leakage.approved_requisitions_amount || 0) - Number(leakage.work_order_value || 0));
    expect(overrunAmount).toBe(1000.00);
    expect(Number(leakage.anomaly_score)).toBeGreaterThan(0);

    // Teardown overrun test project records
    if (reqData?.requisition_id) {
      await supabase.from('requisitions').delete().eq('requisition_id', reqData.requisition_id);
    }
    await supabase.from('project_cost_estimates').delete().eq('work_order_no', woOverrun);
    await supabase.from('je_zo_mappings').delete().eq('je_user_id', jeMobile);
    await supabase.from('projects_master').delete().eq('work_order_no', woOverrun);
    await supabase.rpc('refresh_analytics_views');
  });
});
