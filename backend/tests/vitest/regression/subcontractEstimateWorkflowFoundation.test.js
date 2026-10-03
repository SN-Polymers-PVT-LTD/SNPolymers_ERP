import { describe, expect, test } from 'vitest';
const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontract Estimate Phase 4B M1 foundation', () => {
  test('protects approved contributions and workflow events inside a rollback-scoped transaction', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().slice(0, 8);

    try {
      await client.query('BEGIN');
      const { rows: users } = await client.query("SELECT mobile_number FROM public.authorised_users WHERE is_active = true LIMIT 1");
      expect(users[0]?.mobile_number).toBeTruthy();
      const actor = users[0].mobile_number;

      const project = await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department, created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'M1 test site', 'Test State', 'Test District', 'Test Zone', 'Test Department', $3, $3, 100000, 'Running')
         RETURNING work_order_no`,
        [`WO-SUB-M1-${suffix}`, `EST-SUB-M1-${suffix}`, actor]
      );
      const workOrderNo = project.rows[0].work_order_no;
      const work = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`M1 Head ${suffix}`, `M1 Work ${suffix}`, actor]
      );
      const subcontractor = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`M1 Contractor ${suffix}`, actor]
      );
      const estimate = await client.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id`,
        [workOrderNo, actor]
      );
      const line = await client.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 10, 100, 1000, $4) RETURNING line_id`,
        [estimate.rows[0].subcontract_estimate_id, subcontractor.rows[0].id, work.rows[0].id, actor]
      );
      const lineId = line.rows[0].line_id;

      await client.query(
        `UPDATE public.project_subcontract_estimate_lines
         SET final_approved_revision = 0, final_approved_at = now(), final_approved_by = $2
         WHERE line_id = $1`,
        [lineId, actor]
      );

      const expectDbError = async (statement, params, code) => {
        await client.query('SAVEPOINT m1_expected_error');
        let error;
        try {
          await client.query(statement, params);
        } catch (caught) {
          error = caught;
        }
        await client.query('ROLLBACK TO SAVEPOINT m1_expected_error');
        expect(error).toMatchObject({ code });
      };

      for (const statement of [
        `UPDATE public.project_subcontract_estimate_lines SET qty = 9 WHERE line_id = $1`,
        `UPDATE public.project_subcontract_estimate_lines SET entry_kind = 'ADDITION' WHERE line_id = $1`,
        `DELETE FROM public.project_subcontract_estimate_lines WHERE line_id = $1`
      ]) {
        await expectDbError(statement, [lineId], statement.startsWith('DELETE') ? 'P4B03' : 'P4B02');
      }

      const event = await client.query(
        `INSERT INTO public.project_subcontract_estimate_workflow_log
          (subcontract_estimate_id, revision, from_status, to_status, action, actor, actor_role, remarks)
         VALUES ($1, 0, 'Draft', 'Submitted', 'SUBMIT', $2, 'je', 'M1 test') RETURNING id`,
        [estimate.rows[0].subcontract_estimate_id, actor]
      );
      await expectDbError(
        `UPDATE public.project_subcontract_estimate_workflow_log SET remarks = 'changed' WHERE id = $1`,
        [event.rows[0].id],
        'P4B01'
      );
      await expectDbError(
        `DELETE FROM public.project_subcontract_estimate_workflow_log WHERE id = $1`,
        [event.rows[0].id],
        'P4B01'
      );
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
