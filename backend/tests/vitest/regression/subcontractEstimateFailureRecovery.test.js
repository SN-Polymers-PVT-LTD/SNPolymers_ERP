import { describe, expect, test } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontract Estimate Phase 4B M6 failure recovery and concurrency', () => {
  test('retries and concurrent actions cannot duplicate transitions or bypass stale-state guards', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    const contender = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    const reopenContender = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    await contender.connect();
    await reopenContender.connect();

    const suffix = crypto.randomUUID().slice(0, 8);
    let estimateId;
    let workId;
    let contractorId;
    let workOrderNo;
    let actor;

    const currentTimestamp = async db => {
      const { rows } = await db.query('SELECT updated_at::text AS updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      return rows[0].updated_at;
    };
    const transition = (db, action, expected, remarks = null) => db.query(
      `SELECT public.transition_subcontract_estimate_workflow(
         $1, $2, $3, $4, $5, 24
       )`,
      [estimateId, actor, action, remarks, expected]
    );
    const expectCode = async (promise, code) => {
      await expect(promise).rejects.toMatchObject({ code });
    };

    try {
      const { rows: actors } = await client.query("SELECT mobile_number FROM public.authorised_users WHERE role = 'admin' AND is_active = true LIMIT 1");
      actor = actors[0]?.mobile_number;
      expect(actor).toBeTruthy();
      workOrderNo = `WO-SUB-M6-${suffix}`;

      await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'M6 test site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 100000, 'Running')`,
        [workOrderNo, `EST-SUB-M6-${suffix}`, actor]
      );
      const { rows: works } = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`M6 Head ${suffix}`, `M6 Work ${suffix}`, actor]
      );
      workId = works[0].id;
      const { rows: contractors } = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`M6 Contractor ${suffix}`, actor]
      );
      contractorId = contractors[0].id;
      const { rows: estimates } = await client.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id`,
        [workOrderNo, actor]
      );
      estimateId = estimates[0].subcontract_estimate_id;
      await client.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 10, 100, 1000, $4)`,
        [estimateId, contractorId, workId, actor]
      );

      const initialTimestamp = await currentTimestamp(client);

      // A lost response followed by a retry must not create a second transition.
      await transition(client, 'SUBMIT', initialTimestamp);
      await expectCode(transition(client, 'SUBMIT', initialTimestamp), 'P4B13');
      let { rows } = await client.query('SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      expect(rows[0].estimate_status).toBe('Submitted');
      ({ rows } = await client.query("SELECT count(*)::int AS count FROM public.project_subcontract_estimate_workflow_log WHERE subcontract_estimate_id = $1 AND action = 'SUBMIT'", [estimateId]));
      expect(rows[0].count).toBe(1);

      // Two reviewers using the same loaded version produce one transition and one stale conflict.
      const reviewTimestamp = await currentTimestamp(client);
      const reviewResults = await Promise.allSettled([
        transition(client, 'OPEN_ZO_REVIEW', reviewTimestamp),
        transition(contender, 'OPEN_ZO_REVIEW', reviewTimestamp)
      ]);
      expect(reviewResults.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(reviewResults.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(reviewResults.find(result => result.status === 'rejected').reason.code).toBe('P4B13');
      ({ rows } = await client.query("SELECT count(*)::int AS count FROM public.project_subcontract_estimate_workflow_log WHERE subcontract_estimate_id = $1 AND action = 'OPEN_ZO_REVIEW'", [estimateId]));
      expect(rows[0].count).toBe(1);

      // A stale row-review tab cannot mutate the row after a newer transition.
      await expectCode(client.query(
        `SELECT public.review_subcontract_estimate_rows(
           $1, $2, 'ZO', $3::jsonb, $4
         )`,
        [estimateId, actor, JSON.stringify([{ line_id: crypto.randomUUID(), approve_status: 'Approve' }]), initialTimestamp]
      ), 'P4B23');
      ({ rows } = await client.query('SELECT zo_office_approve FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId]));
      expect(rows[0].zo_office_approve).toBeNull();

      await client.query("UPDATE public.project_subcontract_estimate_lines SET zo_office_approve = 'Approve' WHERE subcontract_estimate_id = $1", [estimateId]);
      await transition(client, 'ZO_APPROVE', await currentTimestamp(client));
      await transition(client, 'OPEN_HO_REVIEW', await currentTimestamp(client));
      await client.query("UPDATE public.project_subcontract_estimate_lines SET ho_office_approve = 'Approve' WHERE subcontract_estimate_id = $1", [estimateId]);
      await transition(client, 'HO_APPROVE', await currentTimestamp(client));

      // Two HO reopen requests also serialize on the estimate row.
      const reopenTimestamp = await currentTimestamp(client);
      const reopenResults = await Promise.allSettled([
        client.query('SELECT public.reopen_subcontract_estimate($1, $2, $3, $4)', [estimateId, actor, 'M6 reopen', reopenTimestamp]),
        reopenContender.query('SELECT public.reopen_subcontract_estimate($1, $2, $3, $4)', [estimateId, actor, 'M6 duplicate reopen', reopenTimestamp])
      ]);
      expect(reopenResults.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      expect(reopenResults.filter(result => result.status === 'rejected')).toHaveLength(1);
      expect(['P4B33', 'P4B34']).toContain(reopenResults.find(result => result.status === 'rejected').reason.code);
      ({ rows } = await client.query('SELECT estimate_status, estimate_revision FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]));
      expect(rows[0]).toMatchObject({ estimate_status: 'Estimate Reopened', estimate_revision: 1 });
      ({ rows } = await client.query("SELECT count(*)::int AS count FROM public.project_subcontract_estimate_workflow_log WHERE subcontract_estimate_id = $1 AND action = 'REOPEN'", [estimateId]));
      expect(rows[0].count).toBe(1);

      // A current revision may retain an inactive persisted master, but a new
      // selection may not introduce an inactive master.
      await client.query(
        `SELECT public.reconcile_subcontract_estimate_lines(
           $1, $2, $3, $4::jsonb
         )`,
        [estimateId, actor, await currentTimestamp(client), JSON.stringify([{ subcontractor_id: contractorId, subcontract_work_id: workId, qty: 2, rate: 100, entry_kind: 'ADDITION' }])]
      );
      ({ rows } = await client.query('SELECT line_id, qty, rate FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 AND final_approved_revision IS NULL', [estimateId]));
      expect(rows).toHaveLength(1);
      const currentLine = rows[0];
      await client.query('UPDATE public.subcontractor_master SET is_active = false WHERE id = $1', [contractorId]);
      await client.query('UPDATE public.subcontract_work_master SET is_active = false WHERE id = $1', [workId]);
      await client.query(
        `SELECT public.reconcile_subcontract_estimate_lines(
           $1, $2, $3, $4::jsonb
         )`,
        [estimateId, actor, await currentTimestamp(client), JSON.stringify([{ line_id: currentLine.line_id, subcontractor_id: contractorId, subcontract_work_id: workId, qty: 3, rate: 100, entry_kind: 'ADDITION' }])]
      );
      await expectCode(client.query(
        `SELECT public.reconcile_subcontract_estimate_lines(
           $1, $2, $3, $4::jsonb
         )`,
        [estimateId, actor, await currentTimestamp(client), JSON.stringify([{ subcontractor_id: contractorId, subcontract_work_id: workId, qty: 1, rate: 100, entry_kind: 'ADDITION' }])]
      ), 'P4B48');
      ({ rows } = await client.query('SELECT line_id FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 AND final_approved_revision IS NULL', [estimateId]));
      expect(rows).toHaveLength(1);

      // Database actor status is authoritative even if an old browser token
      // would still satisfy the route-level role middleware.
      await client.query('UPDATE public.authorised_users SET is_active = false WHERE mobile_number = $1', [actor]);
      await expectCode(client.query(
        'SELECT public.submit_reopened_subcontract_estimate($1, $2, $3)',
        [estimateId, actor, await currentTimestamp(client)]
      ), 'P4B52');
      await client.query('UPDATE public.authorised_users SET is_active = true WHERE mobile_number = $1', [actor]);
    } finally {
      // This test intentionally commits the fixture so separate sessions can race.
      // Disable triggers only for deleting these uniquely generated test rows.
      await client.query("SET session_replication_role = 'replica'");
      await client.query('DELETE FROM public.project_subcontract_estimate_workflow_log WHERE subcontract_estimate_id = $1', [estimateId]);
      await client.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId]);
      await client.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      await client.query('DELETE FROM public.subcontractor_master WHERE id = $1', [contractorId]);
      await client.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [workId]);
      await client.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [workOrderNo]);
      await client.query("SET session_replication_role = 'origin'");
      await client.end();
      await contender.end();
      await reopenContender.end();
    }
  });

  test('rejects actions after JE and ZO mappings are removed from an open session', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const actor = `91${suffix}01`;
    const zoActor = `91${suffix}02`;
    const workOrderNo = `WO-SUB-M6-MAP-${suffix}`;
    let estimateId;
    let workId;
    let contractorId;
    try {
      await client.query("INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active) VALUES ($1, $2, 'je', true), ($3, $4, 'zo', true)", [actor, `M6 JE ${suffix}`, zoActor, `M6 ZO ${suffix}`]);
      await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status, zo_user_id)
         VALUES ($1, $2, 'M6 mapping site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 100000, 'Running', $4)`,
        [workOrderNo, `EST-SUB-M6-MAP-${suffix}`, actor, zoActor]
      );
      await client.query('INSERT INTO public.je_zo_mappings (je_user_id, zo_user_id, assigned_by) VALUES ($1, $2, $2)', [actor, zoActor]);
      await client.query("INSERT INTO public.work_order_mappings (work_order_no, je_user_id, reason, assigned_by) VALUES ($1, $2, 'Assigned', $3)", [workOrderNo, actor, zoActor]);
      const { rows: works } = await client.query("INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by) VALUES ($1, $2, 'Mtr', $3) RETURNING id", [`M6 Map Head ${suffix}`, `M6 Map Work ${suffix}`, actor]);
      workId = works[0].id;
      const { rows: contractors } = await client.query("INSERT INTO public.subcontractor_master (subcontractor_name, created_by) VALUES ($1, $2) RETURNING id", [`M6 Map Contractor ${suffix}`, actor]);
      contractorId = contractors[0].id;
      const { rows: estimates } = await client.query("INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by) VALUES ($1, $2, $2) RETURNING subcontract_estimate_id", [workOrderNo, actor]);
      estimateId = estimates[0].subcontract_estimate_id;
      await client.query("INSERT INTO public.project_subcontract_estimate_lines (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by) VALUES ($1, $2, $3, 1, 100, 100, $4)", [estimateId, contractorId, workId, actor]);

      const timestamp = async () => (await client.query('SELECT updated_at::text AS updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId])).rows[0].updated_at;
      await client.query('UPDATE public.work_order_mappings SET is_active = false WHERE work_order_no = $1 AND je_user_id = $2', [workOrderNo, actor]);
      await expect(client.query('SELECT public.transition_subcontract_estimate_workflow($1, $2, \'SUBMIT\', NULL, $3, 24)', [estimateId, actor, await timestamp()])).rejects.toMatchObject({ code: 'P4B14' });
      let { rows } = await client.query('SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      expect(rows[0].estimate_status).toBe('Draft');

      await client.query('UPDATE public.work_order_mappings SET is_active = true WHERE work_order_no = $1 AND je_user_id = $2', [workOrderNo, actor]);
      await client.query('SELECT public.transition_subcontract_estimate_workflow($1, $2, \'SUBMIT\', NULL, $3, 24)', [estimateId, actor, await timestamp()]);
      await client.query('SELECT public.transition_subcontract_estimate_workflow($1, $2, \'OPEN_ZO_REVIEW\', NULL, $3, 24)', [estimateId, zoActor, await timestamp()]);
      await client.query('UPDATE public.je_zo_mappings SET is_active = false WHERE je_user_id = $1 AND zo_user_id = $2', [actor, zoActor]);
      await expect(client.query(
        "SELECT public.review_subcontract_estimate_rows($1, $2, 'ZO', $3::jsonb, $4)",
        [estimateId, zoActor, JSON.stringify([{ line_id: (await client.query('SELECT line_id FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId])).rows[0].line_id, approve_status: 'Approve' }]), await timestamp()]
      )).rejects.toMatchObject({ code: 'P4B25' });
      ({ rows } = await client.query('SELECT zo_office_approve FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId]));
      expect(rows[0].zo_office_approve).toBeNull();
    } finally {
      await client.query("SET session_replication_role = 'replica'");
      await client.query('DELETE FROM public.project_subcontract_estimate_workflow_log WHERE subcontract_estimate_id = $1', [estimateId]);
      await client.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [estimateId]);
      await client.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId]);
      await client.query('DELETE FROM public.work_order_mappings WHERE work_order_no = $1', [workOrderNo]);
      await client.query('DELETE FROM public.je_zo_mappings WHERE je_user_id = $1 OR zo_user_id = $1', [actor]);
      await client.query('DELETE FROM public.subcontractor_master WHERE id = $1', [contractorId]);
      await client.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [workId]);
      await client.query('DELETE FROM public.projects_master WHERE work_order_no = $1', [workOrderNo]);
      await client.query('DELETE FROM public.authorised_users WHERE mobile_number IN ($1, $2)', [actor, zoActor]);
      await client.query("SET session_replication_role = 'origin'");
      await client.end();
    }
  });
});
