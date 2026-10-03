import { describe, expect, test } from 'vitest';
const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontract Estimate Phase 4B M2 workflow RPC', () => {
  test('transitions a Draft through ZO and HO to Final Approved atomically', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().slice(0, 8);

    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query("SELECT mobile_number FROM public.authorised_users WHERE role = 'admin' AND is_active = true LIMIT 1");
      expect(actors[0]?.mobile_number).toBeTruthy();
      const actor = actors[0].mobile_number;
      const workOrderNo = `WO-SUB-M2-${suffix}`;

      await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department, created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'M2 test site', 'Test State', 'Test District', 'Test Zone', 'Test Department', $3, $3, 100000, 'Running')`,
        [workOrderNo, `EST-SUB-M2-${suffix}`, actor]
      );
      const { rows: work } = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`M2 Head ${suffix}`, `M2 Work ${suffix}`, actor]
      );
      const { rows: subcontractor } = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`M2 Contractor ${suffix}`, actor]
      );
      const { rows: estimate } = await client.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id, updated_at`,
        [workOrderNo, actor]
      );
      await client.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 10, 100, 1000, $4)`,
        [estimate[0].subcontract_estimate_id, subcontractor[0].id, work[0].id, actor]
      );

      const call = async (action, remarks = null) => {
        await client.query(
          `SELECT public.transition_subcontract_estimate_workflow(
             $1, $2, $3, $4,
             (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1),
             24
           )`,
          [estimate[0].subcontract_estimate_id, actor, action, remarks]
        );
        const { rows } = await client.query(`SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1`, [estimate[0].subcontract_estimate_id]);
        return rows[0].estimate_status;
      };

      expect(await call('SUBMIT')).toBe('Submitted');
      expect(await call('OPEN_ZO_REVIEW')).toBe('Under ZO Review');
      await client.query(
        `UPDATE public.project_subcontract_estimate_lines SET zo_office_approve = 'Approve' WHERE subcontract_estimate_id = $1`,
        [estimate[0].subcontract_estimate_id]
      );
      expect(await call('ZO_APPROVE')).toBe('ZO Approved');
      expect(await call('OPEN_HO_REVIEW')).toBe('Under HO Review');
      await client.query(
        `UPDATE public.project_subcontract_estimate_lines SET ho_office_approve = 'Approve' WHERE subcontract_estimate_id = $1`,
        [estimate[0].subcontract_estimate_id]
      );
      expect(await call('HO_APPROVE')).toBe('Final Approved');

      const { rows: logs } = await client.query(
        `SELECT action, from_status, to_status FROM public.project_subcontract_estimate_workflow_log
         WHERE subcontract_estimate_id = $1 ORDER BY created_at, id`,
        [estimate[0].subcontract_estimate_id]
      );
      expect(logs).toHaveLength(5);
      expect(logs.map(log => log.action)).toEqual(expect.arrayContaining(['SUBMIT', 'OPEN_ZO_REVIEW', 'ZO_APPROVE', 'OPEN_HO_REVIEW', 'HO_APPROVE']));
      const { rows: approvedLines } = await client.query(
        `SELECT final_approved_revision FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1`,
        [estimate[0].subcontract_estimate_id]
      );
      expect(approvedLines[0].final_approved_revision).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });

  test('allows JE correction and resubmission after both ZO and HO revision requests', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().slice(0, 8);

    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query("SELECT mobile_number FROM public.authorised_users WHERE role = 'admin' AND is_active = true LIMIT 1");
      const actor = actors[0].mobile_number;
      const workOrderNo = `WO-SUB-REV-${suffix}`;
      await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'Revision test site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 100000, 'Running')`,
        [workOrderNo, `EST-SUB-REV-${suffix}`, actor]
      );
      const { rows: works } = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`Revision Head ${suffix}`, `Revision Work ${suffix}`, actor]
      );
      const { rows: contractors } = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`Revision Contractor ${suffix}`, actor]
      );
      const { rows: estimates } = await client.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id`,
        [workOrderNo, actor]
      );
      const estimateId = estimates[0].subcontract_estimate_id;
      const { rows: lines } = await client.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 10, 100, 1000, $4) RETURNING line_id`,
        [estimateId, contractors[0].id, works[0].id, actor]
      );
      const lineId = lines[0].line_id;
      const timestamp = async () => (await client.query(
        'SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1',
        [estimateId]
      )).rows[0].updated_at;
      const transition = async (action, remarks = null) => client.query(
        `SELECT public.transition_subcontract_estimate_workflow(
           $1, $2, $3, $4,
           (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1),
           24
         )`,
        [estimateId, actor, action, remarks]
      );
      const reconcile = async (qty) => client.query(
        `SELECT public.reconcile_subcontract_estimate_lines(
           $1, $2,
           (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1),
           $3::jsonb
         )`,
        [estimateId, actor, JSON.stringify([{
          line_id: lineId,
          subcontractor_id: contractors[0].id,
          subcontract_work_id: works[0].id,
          qty,
          rate: 100,
          entry_kind: 'BASE'
        }])]
      );
      const review = async (stage) => client.query(
        `SELECT public.review_subcontract_estimate_rows(
           $1, $2, $3, $4::jsonb,
           (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1)
         )`,
        [estimateId, actor, stage, JSON.stringify([{ line_id: lineId, approve_status: 'Approve' }])]
      );
      const status = async () => (await client.query(
        'SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1',
        [estimateId]
      )).rows[0].estimate_status;

      await transition('SUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await transition('ZO_REQUEST_REVISION', 'Correct quantity');
      expect(await status()).toBe('ZO Revision Requested');
      await reconcile(8);
      await transition('RESUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await review('ZO');
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await transition('HO_REQUEST_REVISION', 'Correct rate basis');
      expect(await status()).toBe('HO Revision Requested');
      await reconcile(6);
      await transition('RESUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await review('ZO');
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await review('HO');
      await transition('HO_APPROVE');
      expect(await status()).toBe('Final Approved');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
