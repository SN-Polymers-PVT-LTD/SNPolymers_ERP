import { describe, expect, test } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

const DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Subcontract Work first-use identity serialization', () => {
  test('an identity edit that starts first wins, and first line use locks the new identity', async () => {
    await requireLocalSupabase();
    const editor = await createPgClient(DB_URL);
    const author = await createPgClient(DB_URL);
    await editor.connect(); await author.connect();
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const actor = `p4w${suffix}01`;
    const workOrderNo = `WO-P4W-${suffix}`;
    let workId;
    let estimateId;
    let contractorId;
    try {
      await editor.query("INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active) VALUES ($1, $2, 'admin', true)", [actor, `P4W ${suffix}`]);
      await editor.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'P4W site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 10000, 'Running')`,
        [workOrderNo, `EST-P4W-${suffix}`, actor]
      );
      ({ rows: [{ id: workId }] } = await editor.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`P4W Original ${suffix}`, `P4W Details ${suffix}`, actor]
      ));
      ({ rows: [{ id: contractorId }] } = await editor.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`P4W Contractor ${suffix}`, actor]
      ));
      ({ rows: [{ subcontract_estimate_id: estimateId }] } = await editor.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id`,
        [workOrderNo, actor]
      ));

      await editor.query('BEGIN');
      await editor.query('UPDATE public.subcontract_work_master SET sub_head = $2 WHERE id = $1', [workId, `P4W Edited ${suffix}`]);

      await author.query('BEGIN');
      const firstUse = author.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 1, 100, 100, $4)`,
        [estimateId, contractorId, workId, actor]
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      await editor.query('COMMIT');
      await firstUse;
      await author.query('COMMIT');

      const work = (await author.query('SELECT sub_head, identity_locked_at FROM public.subcontract_work_master WHERE id = $1', [workId])).rows[0];
      const line = (await author.query('SELECT subcontract_work_id FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId])).rows[0];
      expect(work.sub_head).toBe(`P4W Edited ${suffix}`);
      expect(work.identity_locked_at).not.toBeNull();
      expect(line.subcontract_work_id).toBe(workId);
    } finally {
      await editor.query('ROLLBACK').catch(() => {});
      await author.query('ROLLBACK').catch(() => {});
      await editor.query("SET session_replication_role = 'replica'");
      await editor.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId]);
      await editor.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      await editor.query('DELETE FROM public.subcontractor_master WHERE id = $1', [contractorId]);
      await editor.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [workId]);
      await editor.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [workOrderNo]);
      await editor.query('DELETE FROM public.authorised_users WHERE mobile_number = $1', [actor]);
      await editor.query("SET session_replication_role = 'origin'");
      await editor.end(); await author.end();
    }
  });

  test('first line use that starts first wins the identity lock and rejects the waiting edit', async () => {
    await requireLocalSupabase();
    const author = await createPgClient(DB_URL);
    const editor = await createPgClient(DB_URL);
    await author.connect(); await editor.connect();
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const actor = `p4w${suffix}02`;
    const workOrderNo = `WO-P4W-${suffix}-B`;
    let workId;
    let estimateId;
    let contractorId;
    try {
      await author.query("INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active) VALUES ($1, $2, 'admin', true)", [actor, `P4W ${suffix} B`]);
      await author.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'P4W site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 10000, 'Running')`,
        [workOrderNo, `EST-P4W-${suffix}-B`, actor]
      );
      ({ rows: [{ id: workId }] } = await author.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`P4W Original ${suffix} B`, `P4W Details ${suffix} B`, actor]
      ));
      ({ rows: [{ id: contractorId }] } = await author.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`P4W Contractor ${suffix} B`, actor]
      ));
      ({ rows: [{ subcontract_estimate_id: estimateId }] } = await author.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id`,
        [workOrderNo, actor]
      ));

      await author.query('BEGIN');
      await author.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 1, 100, 100, $4)`,
        [estimateId, contractorId, workId, actor]
      );

      await editor.query('BEGIN');
      const identityEdit = editor.query(
        'UPDATE public.subcontract_work_master SET sub_head = $2 WHERE id = $1',
        [workId, `P4W Edited ${suffix} B`]
      );
      await new Promise(resolve => setTimeout(resolve, 100));
      await author.query('COMMIT');
      await expect(identityEdit).rejects.toMatchObject({ code: '23514' });
      await editor.query('ROLLBACK');

      const work = (await author.query('SELECT sub_head, identity_locked_at FROM public.subcontract_work_master WHERE id = $1', [workId])).rows[0];
      const line = (await author.query('SELECT subcontract_work_id FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId])).rows[0];
      expect(work.sub_head).toBe(`P4W Original ${suffix} B`);
      expect(work.identity_locked_at).not.toBeNull();
      expect(line.subcontract_work_id).toBe(workId);
    } finally {
      await author.query('ROLLBACK').catch(() => {});
      await editor.query('ROLLBACK').catch(() => {});
      await author.query("SET session_replication_role = 'replica'");
      await author.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId]);
      await author.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      await author.query('DELETE FROM public.subcontractor_master WHERE id = $1', [contractorId]);
      await author.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [workId]);
      await author.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [workOrderNo]);
      await author.query('DELETE FROM public.authorised_users WHERE mobile_number = $1', [actor]);
      await author.query("SET session_replication_role = 'origin'");
      await author.end(); await editor.end();
    }
  });
});
