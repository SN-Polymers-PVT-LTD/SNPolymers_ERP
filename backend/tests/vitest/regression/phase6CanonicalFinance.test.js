import { describe, expect, test, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function fixture(client, suffix) {
  const actor = `p6${suffix}01`;
  const workOrderNo = `WO-P6-${suffix}`;
  await client.query(`INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active) VALUES ($1, $2, 'admin', true)`, [actor, `P6 ${suffix}`]);
  await client.query(`INSERT INTO public.projects_master (work_order_no, estimate_no, site_details, state, district, zone, department, created_by, edited_by, work_order_value, status) VALUES ($1, $2, 'P6 site', 'State', 'District', 'Zone', 'Dept', $3, $3, 100000, 'Running')`, [workOrderNo, `EST-P6-${suffix}`, actor]);
  const { rows: works } = await client.query(`INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by) VALUES ($1, $2, 'Mtr', $3) RETURNING id`, [`P6 Work ${suffix}`, `P6 Details ${suffix}`, actor]);
  const { rows: contractors } = await client.query(`INSERT INTO public.subcontractor_master (subcontractor_name, created_by) VALUES ($1, $2) RETURNING id`, [`P6 Contractor ${suffix}`, actor]);
  const workId = works[0].id;
  const contractorId = contractors[0].id;
  const { rows: beneficiaries } = await client.query(`INSERT INTO public.projects_beneficiary_master (beneficiary_name, beneficiary_ac_no, beneficiary_ifsc, created_by, updated_by) VALUES ($1, $2, 'P6AB000001', $3, $3) RETURNING id`, [`P6 Beneficiary ${suffix}`, `98${suffix}1234`, actor]);
  await client.query(`UPDATE public.subcontractor_master SET primary_beneficiary_id = $1 WHERE id = $2`, [beneficiaries[0].id, contractorId]);
  const { rows: ce } = await client.query(`INSERT INTO public.project_cost_estimates (work_order_no, estimate_no, area_code, zonal_office_no, estimate_amount, estimate_status, created_by, last_modified_by) VALUES ($1, $2, 'P6', 'P6-ZO', 1000, 'Final Approved', $3, $3) RETURNING estimate_id`, [workOrderNo, `CE-P6-${suffix}`, actor]);
  await client.query(`SELECT set_config('app.phase5_sync', 'on', false)`);
  await client.query(`INSERT INTO public.project_cost_estimate_items (estimate_id, material_main_head, material_sub_head, material_details, unit, qty, rate, amount, source_type, subcontract_work_id) VALUES ($1, 'Sub Contractor', $2, $3, 'Mtr', 10, 100, 1000, 'SUBCONTRACT_ESTIMATE', $4)`, [ce[0].estimate_id, `P6 Work ${suffix}`, `P6 Details ${suffix}`, workId]);
  const { rows: se } = await client.query(`INSERT INTO public.project_subcontract_estimates (work_order_no, estimate_revision, estimate_amount, estimate_status, created_by, last_modified_by) VALUES ($1, 0, 1000, 'Final Approved', $2, $2) RETURNING subcontract_estimate_id`, [workOrderNo, actor]);
  await client.query(`INSERT INTO public.project_subcontract_estimate_lines (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, entry_kind, zo_office_approve, ho_office_approve, final_approved_revision, final_approved_at, final_approved_by, created_by) VALUES ($1, $2, $3, 10, 100, 1000, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)`, [se[0].subcontract_estimate_id, contractorId, workId, actor]);
  return { actor, workOrderNo, workId, contractorId, beneficiaryId: beneficiaries[0].id, ceId: ce[0].estimate_id, seId: se[0].subcontract_estimate_id, extraContractorIds: [] };
}

async function requisition(client, f, number, amount, contractorId = f.contractorId) {
  const { rows } = await client.query(`INSERT INTO public.requisitions (requester_user_id, work_order_no, estimate_no, estimate_amount, state, district, area_code, department, site_details, requisition_no, material_main_head, material_sub_head, material_details, requisition_pdf_url, requisition_amount, gst_bill, bank_details, requisition_status, created_by, subcontractor_id, subcontract_work_id) VALUES ($1, $2, 'CE', 1000, 'State', 'District', 'P6', 'Dept', 'P6 site', $3, 'Sub Contractor', 'P6 Work', 'P6 Details', 'p6.pdf', $4, 'No', 'P6 Bank', 'Pending', $1, $5, $6) RETURNING requisition_id`, [f.actor, f.workOrderNo, number, amount, contractorId, f.workId]);
  return rows[0].requisition_id;
}

async function cleanup(client, f) {
  await client.query("SET session_replication_role = 'replica'");
  await client.query('DELETE FROM public.subcontractor_ledger WHERE work_order_no = $1', [f.workOrderNo]);
  await client.query('DELETE FROM public.requisitions WHERE work_order_no = $1', [f.workOrderNo]);
  await client.query('DELETE FROM public.project_cost_estimate_items WHERE estimate_id = $1', [f.ceId]);
  await client.query('DELETE FROM public.project_cost_estimates WHERE estimate_id = $1', [f.ceId]);
  await client.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [f.seId]);
  await client.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [f.seId]);
  await client.query('DELETE FROM public.subcontractor_master WHERE id = $1', [f.contractorId]);
  for (const id of f.extraContractorIds || []) await client.query('DELETE FROM public.subcontractor_master WHERE id = $1', [id]);
  await client.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [f.workId]);
  await client.query('DELETE FROM public.projects_beneficiary_master WHERE id = $1', [f.beneficiaryId]);
  await client.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [f.workOrderNo]);
  await client.query('DELETE FROM public.authorised_users WHERE mobile_number = $1', [f.actor]);
  await client.query("SET session_replication_role = 'origin'");
}

describe('Phase 6 canonical subcontract finance', () => {
  let client;
  let f;

  beforeAll(async () => {
    client = await createPgClient(DB_URL);
    await client.connect();
    f = await fixture(client, crypto.randomUUID().slice(0, 8));
  }, 120000);

  afterAll(async () => {
    if (f) await cleanup(client, f);
    await client?.end();
  });

  test('returns contractor and pooled CE capacity from one primitive', async () => {
    const { rows } = await client.query('SELECT * FROM public.get_subcontract_finance_capacity($1, $2, $3)', [f.workOrderNo, f.contractorId, f.workId]);
    expect(Number(rows[0].approved_capacity)).toBe(1000);
    expect(Number(rows[0].available_cost_estimate_capacity)).toBe(1000);
    expect(Number(rows[0].effective_available_capacity)).toBe(1000);
  });

  test('canonical approval reserves without subcontractor_balances and reduces capacity', async () => {
    const id = await requisition(client, f, `REQ-P6-${crypto.randomUUID()}`, 600);
    await client.query('SELECT public.approve_requisition_transact($1, 600, $2, $3)', [id, f.actor, 'P6 approved']);
    const { rows } = await client.query('SELECT * FROM public.get_subcontract_finance_capacity($1, $2, $3)', [f.workOrderNo, f.contractorId, f.workId]);
    expect(Number(rows[0].reserved_amount)).toBe(600);
    expect(Number(rows[0].consumed_amount)).toBe(600);
    expect(Number(rows[0].effective_available_capacity)).toBe(400);
    const ledger = await client.query("SELECT COUNT(*)::int AS n FROM public.subcontractor_ledger WHERE reference_id = $1 AND transaction_type = 'REQUISITION_APPROVAL'", [id]);
    expect(ledger.rows[0].n).toBe(1);
  });

  test('pooled CE capacity rejects a second contractor above the shared ceiling', async () => {
    const { rows: contractors } = await client.query(`INSERT INTO public.subcontractor_master (subcontractor_name, created_by) VALUES ($1, $2) RETURNING id`, [`P6 Second ${f.workOrderNo}`, f.actor]);
    const secondId = contractors[0].id;
    f.extraContractorIds.push(secondId);
    await client.query(`INSERT INTO public.project_subcontract_estimate_lines (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, entry_kind, zo_office_approve, ho_office_approve, final_approved_revision, final_approved_at, final_approved_by, created_by) VALUES ($1, $2, $3, 10, 100, 1000, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)`, [f.seId, secondId, f.workId, f.actor]);
    const id = await requisition(client, f, `REQ-P6-SECOND-${crypto.randomUUID()}`, 500, secondId);
    await expect(client.query('SELECT public.approve_requisition_transact($1, 500, $2, $3)', [id, f.actor, 'P6 pooled overflow'])).rejects.toMatchObject({ code: 'P6F04' });
  });

  test('creation rejects a contractor whose effective approved scope is zero', async () => {
    const { rows: contractors } = await client.query(
      `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
       VALUES ($1, $2) RETURNING id`,
      [`P6 Zero ${f.workOrderNo}`, f.actor]
    );
    const zeroContractorId = contractors[0].id;
    f.extraContractorIds.push(zeroContractorId);
    const { rows: base } = await client.query(
      `INSERT INTO public.project_subcontract_estimate_lines
        (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate,
         amount, entry_kind, zo_office_approve, ho_office_approve,
         final_approved_revision, final_approved_at, final_approved_by, created_by)
       VALUES ($1, $2, $3, 1, 100, 100, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)
       RETURNING line_id`,
      [f.seId, zeroContractorId, f.workId, f.actor]
    );
    await client.query(
      `INSERT INTO public.project_subcontract_estimate_lines
        (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate,
         amount, entry_kind, adjusts_line_id, zo_office_approve, ho_office_approve,
         final_approved_revision, final_approved_at, final_approved_by, created_by)
       VALUES ($1, $2, $3, -1, 100, -100, 'ADJUSTMENT', $4, 'Approve', 'Approve', 0, now(), $5, $5)`,
      [f.seId, zeroContractorId, f.workId, base[0].line_id, f.actor]
    );

    await expect(client.query(
      `SELECT * FROM public.create_subcontract_requisition_secure(
        $1, $2, 'CE', 1000, 'State', 'District', 'P6', 'Dept', 'P6 site', $3,
        'Sub Contractor', 'p6-zero.pdf', 'p6-zero.pdf', 100, 'No', NULL,
        'P6 bank', 'P6 remarks', 'Pending', $1, 'P6 Work', 'P6 Details',
        NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $4, $5
      )`,
      [f.actor, f.workOrderNo, `REQ-P6-ZERO-${crypto.randomUUID()}`, zeroContractorId, f.workId]
    )).rejects.toMatchObject({ code: 'P6F01' });
  });

  test('payment replaces reservation in consumption instead of double counting', async () => {
    const { rows } = await client.query("SELECT requisition_id FROM public.requisitions WHERE work_order_no = $1 AND requisition_status = 'Approved' LIMIT 1", [f.workOrderNo]);
    await client.query('SELECT public.mark_subcontractor_requisition_settled($1, now(), $2)', [rows[0].requisition_id, f.actor]);
    await client.query('SELECT public.record_subcontractor_payment($1, 600, now(), $2)', [rows[0].requisition_id, f.actor]);
    const { rows: capacity } = await client.query('SELECT * FROM public.get_subcontract_finance_capacity($1, $2, $3)', [f.workOrderNo, f.contractorId, f.workId]);
    expect(Number(capacity[0].consumed_amount)).toBe(600);
    expect(Number(capacity[0].reserved_amount)).toBe(0);
    expect(Number(capacity[0].paid_or_settled_amount)).toBe(600);
  });

  test('canonical create defaults beneficiary from subcontractor master', async () => {
    const { rows } = await client.query(`SELECT * FROM public.create_subcontract_requisition_secure($1, $2, 'CE', 1000, 'State', 'District', 'P6', 'Dept', 'P6 site', $3, 'Sub Contractor', 'p6-create.pdf', 'p6-create.pdf', 100, 'No', NULL, 'P6 bank', 'P6 remarks', 'Pending', $1, 'P6 Work', 'P6 Details', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $4, $5)`, [f.actor, f.workOrderNo, `REQ-P6-CREATE-${crypto.randomUUID()}`, f.contractorId, f.workId]);
    expect(rows[0].beneficiary_id).toBe(f.beneficiaryId);
    expect(rows[0].subcontractor_id).toBe(f.contractorId);
    expect(rows[0].subcontract_work_id).toBe(f.workId);
  });
});

describe('Phase 6 pooled subcontract finance concurrency', () => {
  test('two contractors cannot concurrently consume the same pooled CE capacity', async () => {
    const setup = await createPgClient(DB_URL);
    const clientA = await createPgClient(DB_URL);
    const clientB = await createPgClient(DB_URL);
    await setup.connect();
    await clientA.connect();
    await clientB.connect();
    const f = await fixture(setup, crypto.randomUUID().slice(0, 8));
    try {
      const { rows: contractors } = await setup.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`P6 Concurrent Second ${f.workOrderNo}`, f.actor]
      );
      const secondContractorId = contractors[0].id;
      f.extraContractorIds.push(secondContractorId);
      await setup.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate,
           amount, entry_kind, zo_office_approve, ho_office_approve,
           final_approved_revision, final_approved_at, final_approved_by, created_by)
         VALUES ($1, $2, $3, 10, 100, 1000, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)`,
        [f.seId, secondContractorId, f.workId, f.actor]
      );
      const firstReq = await requisition(setup, f, `REQ-P6-CONCURRENT-A-${crypto.randomUUID()}`, 700);
      const secondReq = await requisition(setup, f, `REQ-P6-CONCURRENT-B-${crypto.randomUUID()}`, 700, secondContractorId);

      await clientA.query('BEGIN');
      // Hold the same production pooled lock so the second real approval call
      // is guaranteed to overlap and wait, without leaving the test itself
      // waiting for a transaction that cannot commit until the wait finishes.
      await clientA.query(
        'SELECT public.lock_subcontract_financial_scope_pooled($1, $2)',
        [f.workOrderNo, f.workId]
      );
      const firstApproval = clientA.query(
        'SELECT public.approve_requisition_transact($1, 700, $2, $3)',
        [firstReq, f.actor, 'Concurrent A']
      );
      await new Promise(resolve => setTimeout(resolve, 50));
      await clientB.query('BEGIN');
      const secondApproval = clientB.query(
        'SELECT public.approve_requisition_transact($1, 700, $2, $3)',
        [secondReq, f.actor, 'Concurrent B']
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      await clientA.query('COMMIT');
      const outcomes = await Promise.allSettled([firstApproval, secondApproval]);
      const successes = outcomes.filter(result => result.status === 'fulfilled');
      const failures = outcomes.filter(result => result.status === 'rejected');
      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(1);
      expect(failures[0].reason).toMatchObject({ code: 'P6F04' });
      await clientB.query('ROLLBACK');
      const ledger = await setup.query(
        `SELECT COUNT(*)::int AS count, COALESCE(SUM(abs(amount)), 0)::numeric AS total
         FROM public.subcontractor_ledger
         WHERE work_order_no = $1 AND transaction_type = 'REQUISITION_APPROVAL'`,
        [f.workOrderNo]
      );
      expect(ledger.rows[0]).toMatchObject({ count: 1, total: '700.00' });
      const requisitions = await setup.query(
        `SELECT requisition_id, requisition_status FROM public.requisitions
         WHERE requisition_id IN ($1, $2) ORDER BY requisition_id`,
        [firstReq, secondReq]
      );
      expect(requisitions.rows.filter(row => row.requisition_status === 'Approved')).toHaveLength(1);
      expect(requisitions.rows.filter(row => row.requisition_status === 'Pending')).toHaveLength(1);
    } finally {
      await clientA.query('ROLLBACK').catch(() => {});
      await clientB.query('ROLLBACK').catch(() => {});
      await cleanup(setup, f);
      await setup.end();
      await clientA.end();
      await clientB.end();
    }
  }, 120000);
});
