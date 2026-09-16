import { describe, expect, test } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function createFixture(client, suffix, requisitionAmount = 700) {
  const actor = `p4b${suffix}01`;
  const workOrderNo = `WO-P4B-RACE-${suffix}`;
  await client.query(
    `INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active)
     VALUES ($1, $2, 'admin', true)`,
    [actor, `P4B race ${suffix}`]
  );
  await client.query(
    `INSERT INTO public.projects_master
      (work_order_no, estimate_no, site_details, state, district, zone, department,
       created_by, edited_by, work_order_value, status)
     VALUES ($1, $2, 'P4B race site', 'Test State', 'Test District', 'Test Zone',
             'Test Department', $3, $3, 100000, 'Running')`,
    [workOrderNo, `EST-P4B-RACE-${suffix}`, actor]
  );
  const { rows: works } = await client.query(
    `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
     VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
    [`P4B Race Head ${suffix}`, `P4B Race Work ${suffix}`, actor]
  );
  const { rows: contractors } = await client.query(
    `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
     VALUES ($1, $2) RETURNING id`,
    [`P4B Race Contractor ${suffix}`, actor]
  );
  const subcontractWorkId = works[0].id;
  const subcontractorId = contractors[0].id;

  const { rows: costEstimates } = await client.query(
    `INSERT INTO public.project_cost_estimates
      (work_order_no, estimate_no, area_code, zonal_office_no, estimate_amount,
       estimate_status, created_by, last_modified_by)
     VALUES ($1, $2, 'P4B', 'P4B-ZO', 1000, 'Final Approved', $3, $3)
     RETURNING estimate_id`,
    [workOrderNo, `COST-P4B-${suffix}`, actor]
  );
  await client.query(
    `INSERT INTO public.project_cost_estimate_items
      (estimate_id, material_main_head, material_sub_head, material_details,
       unit, qty, rate, amount)
     VALUES ($1, 'Sub Contractor', $2, $3, 'Mtr', 10, 100, 1000)`,
    [costEstimates[0].estimate_id, `P4B Race Head ${suffix}`, `P4B Race Work ${suffix}`]
  );
  await client.query(
    `INSERT INTO public.subcontractor_balances
      (work_order_no, material_main_head, material_sub_head, material_details,
       subcontractor_id, subcontract_work_id, estimated_total, available_balance)
     VALUES ($1, 'Sub Contractor', $2, $3, $4, $5, 1000, 1000)`,
    [workOrderNo, `P4B Race Head ${suffix}`, `P4B Race Work ${suffix}`, subcontractorId, subcontractWorkId]
  );

  const { rows: estimates } = await client.query(
    `INSERT INTO public.project_subcontract_estimates
      (work_order_no, estimate_revision, estimate_amount, estimate_status,
       last_approved_amount, created_by, last_modified_by)
     VALUES ($1, 1, 600, 'Under HO Review', 1000, $2, $2)
     RETURNING subcontract_estimate_id, updated_at`,
    [workOrderNo, actor]
  );
  const estimateId = estimates[0].subcontract_estimate_id;
  const { rows: baseLines } = await client.query(
    `INSERT INTO public.project_subcontract_estimate_lines
      (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate,
       amount, entry_kind, zo_office_approve, ho_office_approve,
       final_approved_revision, final_approved_at, final_approved_by, created_by)
     VALUES ($1, $2, $3, 10, 100, 1000, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)
     RETURNING line_id`,
    [estimateId, subcontractorId, subcontractWorkId, actor]
  );
  await client.query(
    `INSERT INTO public.project_subcontract_estimate_lines
      (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate,
       amount, entry_kind, adjusts_line_id, zo_office_approve,
       ho_office_approve, created_by)
     VALUES ($1, $2, $3, -4, 100, -400, 'ADJUSTMENT', $4, 'Approve', 'Approve', $5)`,
    [estimateId, subcontractorId, subcontractWorkId, baseLines[0].line_id, actor]
  );

  const { rows: requisitions } = await client.query(
    `INSERT INTO public.requisitions
      (requester_user_id, work_order_no, estimate_no, estimate_amount, state,
       district, area_code, department, site_details, requisition_no,
       material_main_head, material_sub_head, material_details,
       requisition_pdf_url, requisition_amount, gst_bill, bank_details,
       requisition_status, created_by, subcontractor_id, subcontract_work_id)
     VALUES ($1, $2, $3, 1000, 'Test State', 'Test District', 'P4B',
             'Test Department', 'P4B race site', $4, 'Sub Contractor', $5, $6,
      'p4b.pdf', $7, 'No', 'P4B bank', 'Pending', $1, $8, $9)
     RETURNING requisition_id`,
    [actor, workOrderNo, `COST-P4B-${suffix}`, `REQ-P4B-${suffix}`,
      `P4B Race Head ${suffix}`, `P4B Race Work ${suffix}`, requisitionAmount, subcontractorId, subcontractWorkId]
  );
  return { actor, workOrderNo, estimateId, requisitionId: requisitions[0].requisition_id, subcontractorId, subcontractWorkId };
}

async function cleanup(client, fixture) {
  await client.query("SET session_replication_role = 'replica'");
  await client.query('DELETE FROM public.subcontractor_ledger WHERE work_order_no = $1', [fixture.workOrderNo]);
  await client.query('DELETE FROM public.requisitions WHERE requisition_id = $1', [fixture.requisitionId]);
  await client.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [fixture.estimateId]);
  await client.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [fixture.estimateId]);
  await client.query('DELETE FROM public.project_cost_estimate_items WHERE estimate_id IN (SELECT estimate_id FROM public.project_cost_estimates WHERE work_order_no = $1)', [fixture.workOrderNo]);
  await client.query('DELETE FROM public.project_cost_estimates WHERE work_order_no = $1', [fixture.workOrderNo]);
  await client.query('DELETE FROM public.subcontractor_balances WHERE work_order_no = $1', [fixture.workOrderNo]);
  await client.query('DELETE FROM public.subcontractor_master WHERE id = $1', [fixture.subcontractorId]);
  await client.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [fixture.subcontractWorkId]);
  await client.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [fixture.workOrderNo]);
  await client.query('DELETE FROM public.authorised_users WHERE mobile_number = $1', [fixture.actor]);
  await client.query("SET session_replication_role = 'origin'");
}

describe('Phase 4B production-path financial scope serialization', () => {
  test('Finance reservation first is observed by HO Final Approval and blocks an unsafe reduction', async () => {
    await requireLocalSupabase();
    const finance = await createPgClient(DB_URL);
    const ho = await createPgClient(DB_URL);
    await finance.connect(); await ho.connect();
    const fixture = await createFixture(finance, crypto.randomUUID().replace(/-/g, '').slice(0, 8));
    try {
      await finance.query('BEGIN');
      await finance.query(
        `SELECT public.approve_requisition_transact($1, 700, $2, 'Finance first')`,
        [fixture.requisitionId, fixture.actor]
      );
      const expected = (await ho.query('SELECT updated_at::text AS updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [fixture.estimateId])).rows[0].updated_at;
      const hoAttempt = ho.query(
        `SELECT public.transition_subcontract_estimate_workflow($1, $2, 'HO_APPROVE', NULL, $3, 24)`,
        [fixture.estimateId, fixture.actor, expected]
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      await finance.query('COMMIT');
      await expect(hoAttempt).rejects.toMatchObject({ code: 'P4B18' });

      const state = (await ho.query('SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [fixture.estimateId])).rows[0];
      const requisition = (await ho.query('SELECT requisition_status, approved_amount FROM public.requisitions WHERE requisition_id = $1', [fixture.requisitionId])).rows[0];
      const consumption = (await ho.query('SELECT public.get_subcontract_financial_consumption($1, $2, $3) AS consumed', [fixture.workOrderNo, fixture.subcontractorId, fixture.subcontractWorkId])).rows[0];
      expect(state.estimate_status).toBe('Under HO Review');
      expect(requisition).toMatchObject({ requisition_status: 'Approved', approved_amount: '700.00' });
      expect(consumption.consumed).toBe('700.00');
    } finally {
      await finance.query('ROLLBACK').catch(() => {});
      await cleanup(ho, fixture);
      await finance.end(); await ho.end();
    }
  });

  test('HO Final Approval first commits before Finance reservation and Finance then fits the approved capacity', async () => {
    await requireLocalSupabase();
    const ho = await createPgClient(DB_URL);
    const finance = await createPgClient(DB_URL);
    await ho.connect(); await finance.connect();
    const fixture = await createFixture(ho, crypto.randomUUID().replace(/-/g, '').slice(0, 8), 500);
    try {
      await ho.query('BEGIN');
      const expected = (await ho.query('SELECT updated_at::text AS updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [fixture.estimateId])).rows[0].updated_at;
      await ho.query(
        `SELECT public.transition_subcontract_estimate_workflow($1, $2, 'HO_APPROVE', NULL, $3, 24)`,
        [fixture.estimateId, fixture.actor, expected]
      );
      await finance.query('BEGIN');
      const financeAttempt = finance.query(
        `SELECT public.approve_requisition_transact($1, 500, $2, 'Finance after HO')`,
        [fixture.requisitionId, fixture.actor]
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      await ho.query('COMMIT');
      await financeAttempt;
      await finance.query('COMMIT');

      const state = (await finance.query('SELECT estimate_status, last_approved_amount FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [fixture.estimateId])).rows[0];
      const requisition = (await finance.query('SELECT requisition_status, approved_amount FROM public.requisitions WHERE requisition_id = $1', [fixture.requisitionId])).rows[0];
      const line = (await finance.query(`SELECT final_approved_revision FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 AND entry_kind = 'ADJUSTMENT'`, [fixture.estimateId])).rows[0];
      const consumption = (await finance.query('SELECT public.get_subcontract_financial_consumption($1, $2, $3) AS consumed', [fixture.workOrderNo, fixture.subcontractorId, fixture.subcontractWorkId])).rows[0];
      expect(state).toMatchObject({ estimate_status: 'Final Approved', last_approved_amount: '600.00' });
      expect(requisition).toMatchObject({ requisition_status: 'Approved', approved_amount: '500.00' });
      expect(line.final_approved_revision).toBe(1);
      expect(consumption.consumed).toBe('500.00');
      expect(Number(consumption.consumed)).toBeLessThanOrEqual(Number(state.last_approved_amount));
    } finally {
      await ho.query('ROLLBACK').catch(() => {});
      await finance.query('ROLLBACK').catch(() => {});
      await cleanup(finance, fixture);
      await ho.end(); await finance.end();
    }
  });
});
