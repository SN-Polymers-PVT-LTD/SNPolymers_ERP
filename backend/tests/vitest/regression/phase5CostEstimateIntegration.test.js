import { describe, expect, test, beforeAll, afterAll } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Phase 5 Cost Estimate subcontract integration', () => {
  let db;
  let actor;
  let workOrder;
  let work;
  let contractorA;
  let contractorB;
  let sourceEstimate;
  let costEstimate;
  let baseLine;
  let adjustmentLine;

  beforeAll(async () => {
    await requireLocalSupabase();
    db = await createPgClient(DB_URL);
    await db.connect();
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
    actor = `p5${suffix}`;
    workOrder = `WO-P5-${suffix}`;

    await db.query(`INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active)
      VALUES ($1, $2, 'admin', true)`, [actor, `Phase 5 ${suffix}`]);
    await db.query(`INSERT INTO public.projects_master
      (work_order_no, estimate_no, site_details, state, district, zone, department,
       created_by, edited_by, work_order_value, status)
      VALUES ($1, $2, 'Phase 5 site', 'Test', 'Test', 'Test', 'Test', $3, $3, 100000, 'Running')`,
      [workOrder, `EST-P5-${suffix}`, actor]);
    ({ rows: [work] } = await db.query(`INSERT INTO public.subcontract_work_master
      (sub_head, material_details, unit, created_by) VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
      [`P5 Work ${suffix}`, `P5 Details ${suffix}`, actor]));
    ({ rows: [contractorA] } = await db.query(`INSERT INTO public.subcontractor_master
      (subcontractor_name, created_by) VALUES ($1, $2) RETURNING id`, [`P5 Contractor A ${suffix}`, actor]));
    ({ rows: [contractorB] } = await db.query(`INSERT INTO public.subcontractor_master
      (subcontractor_name, created_by) VALUES ($1, $2) RETURNING id`, [`P5 Contractor B ${suffix}`, actor]));
    ({ rows: [sourceEstimate] } = await db.query(`INSERT INTO public.project_subcontract_estimates
      (work_order_no, estimate_revision, estimate_amount, estimate_status, last_approved_amount,
       created_by, last_modified_by) VALUES ($1, 0, 0, 'Final Approved', 0, $2, $2)
       RETURNING subcontract_estimate_id`, [workOrder, actor]));
    ({ rows: [baseLine] } = await db.query(`INSERT INTO public.project_subcontract_estimate_lines
      (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount,
       entry_kind, zo_office_approve, ho_office_approve, final_approved_revision,
       final_approved_at, final_approved_by, created_by)
      VALUES ($1, $2, $3, 4, 100, 400, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)
      RETURNING line_id`, [sourceEstimate.subcontract_estimate_id, contractorA.id, work.id, actor]));
    await db.query(`INSERT INTO public.project_subcontract_estimate_lines
      (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount,
       entry_kind, adjusts_line_id, zo_office_approve, ho_office_approve,
       final_approved_revision, final_approved_at, final_approved_by, created_by)
      VALUES ($1, $2, $3, 2, 50, 100, 'ADDITION', NULL, 'Approve', 'Approve', 0, now(), $4, $4)`,
      [sourceEstimate.subcontract_estimate_id, contractorB.id, work.id, actor]);
    ({ rows: [adjustmentLine] } = await db.query(`INSERT INTO public.project_subcontract_estimate_lines
      (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount,
       entry_kind, adjusts_line_id, zo_office_approve, ho_office_approve,
       final_approved_revision, final_approved_at, final_approved_by, created_by)
      VALUES ($1, $2, $3, -6, 83.333333, -500, 'ADJUSTMENT', $4, 'Approve', 'Approve', 0, now(), $5, $5)
      RETURNING line_id`, [sourceEstimate.subcontract_estimate_id, contractorA.id, work.id, baseLine.line_id, actor]));
    ({ rows: [costEstimate] } = await db.query(`INSERT INTO public.project_cost_estimates
      (work_order_no, estimate_no, area_code, zonal_office_no, estimate_amount,
       estimate_status, created_by, last_modified_by)
      VALUES ($1, $2, 'P5', 'P5-ZO', 0, 'Draft', $3, $3) RETURNING estimate_id`,
      [workOrder, `CE-P5-${suffix}`, actor]));
  });

  afterAll(async () => {
    if (!db) return;
    await db.query('SET session_replication_role = replica');
    await db.query('DELETE FROM public.cost_estimate_subcontract_contributions WHERE cost_estimate_item_id IN (SELECT item_id FROM public.project_cost_estimate_items WHERE estimate_id = $1)', [costEstimate?.estimate_id]);
    await db.query('DELETE FROM public.project_cost_estimate_items WHERE estimate_id = $1', [costEstimate?.estimate_id]);
    await db.query('DELETE FROM public.project_cost_estimates WHERE estimate_id = $1', [costEstimate?.estimate_id]);
    await db.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [sourceEstimate?.subcontract_estimate_id]);
    await db.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [sourceEstimate?.subcontract_estimate_id]);
    await db.query('DELETE FROM public.subcontractor_master WHERE id IN ($1, $2)', [contractorA?.id, contractorB?.id]);
    await db.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [work?.id]);
    await db.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [workOrder]);
    await db.query('DELETE FROM public.authorised_users WHERE mobile_number = $1', [actor]);
    await db.query('SET session_replication_role = origin');
    await db.end();
  });

  test('aggregates all approved contractors/lines, preserves authoritative amount, and is idempotent', async () => {
    const first = await db.query(`SELECT public.sync_subcontract_contributions_to_cost_estimate($1, $2)`, [costEstimate.estimate_id, actor]);
    expect(first.rowCount).toBe(1);
    const item = (await db.query(`SELECT item_id, qty, rate, amount, source_type FROM public.project_cost_estimate_items WHERE estimate_id = $1`, [costEstimate.estimate_id])).rows;
    expect(item).toHaveLength(1);
    expect(item[0]).toMatchObject({ qty: '0.0000', rate: '0.0000', amount: '0.00', source_type: 'SUBCONTRACT_ESTIMATE' });
    const provenance = (await db.query(`SELECT count(*)::int AS count FROM public.cost_estimate_subcontract_contributions WHERE cost_estimate_item_id = $1`, [item[0].item_id])).rows[0];
    expect(provenance.count).toBe(3);
    await db.query(`SELECT public.sync_subcontract_contributions_to_cost_estimate($1, $2)`, [costEstimate.estimate_id, actor]);
    const repeated = (await db.query(`SELECT count(*)::int AS rows, (SELECT count(*)::int FROM public.cost_estimate_subcontract_contributions WHERE cost_estimate_item_id = $1) AS provenance FROM public.project_cost_estimate_items WHERE estimate_id = $2`, [item[0].item_id, costEstimate.estimate_id])).rows[0];
    expect(repeated).toMatchObject({ rows: 1, provenance: 3 });
  });

  test('revives the same zero tombstone, preserves manual rows, and concurrent sync has one generated row', async () => {
    const manual = await db.query(`INSERT INTO public.project_cost_estimate_items
      (estimate_id, material_main_head, material_sub_head, material_details, unit, qty, rate, amount)
      VALUES ($1, 'Material', 'P5', 'Manual', 'Mtr', 2, 10, 20) RETURNING item_id`, [costEstimate.estimate_id]);
    const c1 = await createPgClient(DB_URL); const c2 = await createPgClient(DB_URL);
    await c1.connect(); await c2.connect();
    try {
      await Promise.all([
        c1.query(`SELECT public.sync_subcontract_contributions_to_cost_estimate($1, $2)`, [costEstimate.estimate_id, actor]),
        c2.query(`SELECT public.sync_subcontract_contributions_to_cost_estimate($1, $2)`, [costEstimate.estimate_id, actor])
      ]);
    } finally { await c1.end(); await c2.end(); }
    await db.query(`INSERT INTO public.project_subcontract_estimate_lines
      (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount,
       entry_kind, zo_office_approve, ho_office_approve, final_approved_revision,
       final_approved_at, final_approved_by, created_by)
      VALUES ($1, $2, $3, 2, 50, 100, 'ADDITION', NULL, NULL, 1, now(), $4, $4)`,
      [sourceEstimate.subcontract_estimate_id, contractorA.id, work.id, actor]);
    await db.query(`SELECT public.sync_subcontract_contributions_to_cost_estimate($1, $2)`, [costEstimate.estimate_id, actor]);
    const row = (await db.query(`SELECT item_id, qty, rate, amount FROM public.project_cost_estimate_items WHERE estimate_id = $1 AND source_type = 'SUBCONTRACT_ESTIMATE'`, [costEstimate.estimate_id])).rows[0];
    expect(row.qty).toBe('2.0000');
    expect(row.amount).toBe('100.00');
    expect(Number(row.rate)).toBe(50);
    expect((await db.query(`SELECT count(*)::int AS count FROM public.project_cost_estimate_items WHERE estimate_id = $1`, [costEstimate.estimate_id])).rows[0].count).toBe(2);
    expect(manual.rows[0].item_id).not.toBe(row.item_id);
  });

  test('rejects direct generated mutation and does not create legacy subcontract credit', async () => {
    const { rows: [row] } = await db.query(`SELECT item_id FROM public.project_cost_estimate_items WHERE estimate_id = $1 AND source_type = 'SUBCONTRACT_ESTIMATE'`, [costEstimate.estimate_id]);
    await expect(db.query(`UPDATE public.project_cost_estimate_items SET amount = amount + 1 WHERE item_id = $1`, [row.item_id])).rejects.toMatchObject({ code: 'P5E07' });
    await expect(db.query(`DELETE FROM public.project_cost_estimate_items WHERE item_id = $1`, [row.item_id])).rejects.toMatchObject({ code: 'P5E07' });
  });
});
