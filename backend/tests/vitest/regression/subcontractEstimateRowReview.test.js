import { describe, expect, test } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontract Estimate Phase 4B M3 row review RPC', () => {
  test('applies stage-specific decisions and rejects invalid review payloads', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().slice(0, 8);

    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query(
        "SELECT mobile_number FROM public.authorised_users WHERE role = 'admin' AND is_active = true LIMIT 1"
      );
      expect(actors[0]?.mobile_number).toBeTruthy();
      const actor = actors[0].mobile_number;
      const workOrderNo = `WO-SUB-M3-${suffix}`;

      await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'M3 test site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 100000, 'Running')`,
        [workOrderNo, `EST-SUB-M3-${suffix}`, actor]
      );
      const { rows: works } = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`M3 Head ${suffix}`, `M3 Work ${suffix}`, actor]
      );
      const { rows: contractors } = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`M3 Contractor ${suffix}`, actor]
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

      const transition = async (action, remarks = null) => {
        await client.query(
          `SELECT public.transition_subcontract_estimate_workflow(
             $1, $2, $3, $4,
             (SELECT updated_at FROM public.project_subcontract_estimates
              WHERE subcontract_estimate_id = $1), 24)`,
          [estimateId, actor, action, remarks]
        );
      };
      const review = async (stage, approvals) => {
        await client.query(
          `SELECT public.review_subcontract_estimate_rows(
             $1, $2, $3, $4::jsonb,
             (SELECT updated_at FROM public.project_subcontract_estimates
              WHERE subcontract_estimate_id = $1))`,
          [estimateId, actor, stage, JSON.stringify(approvals)]
        );
      };
      const expectReviewError = async (stage, approvals, code) => {
        await client.query('SAVEPOINT row_review_error');
        try {
          await expect(review(stage, approvals)).rejects.toMatchObject({ code });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT row_review_error');
          await client.query('RELEASE SAVEPOINT row_review_error');
        }
      };

      await transition('SUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await review('ZO', [{ line_id: lineId, approve_status: 'Approve' }]);

      let { rows: current } = await client.query(
        `SELECT zo_office_approve, ho_office_approve
         FROM public.project_subcontract_estimate_lines WHERE line_id = $1`,
        [lineId]
      );
      expect(current[0]).toMatchObject({ zo_office_approve: 'Approve', ho_office_approve: null });

      await expectReviewError('ZO', [{ line_id: lineId, approve_status: 'Not Approve' }], 'P4B20');

      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await review('HO', [{ line_id: lineId, approve_status: 'Approve' }]);

      ({ rows: current } = await client.query(
        `SELECT zo_office_approve, ho_office_approve
         FROM public.project_subcontract_estimate_lines WHERE line_id = $1`,
        [lineId]
      ));
      expect(current[0]).toMatchObject({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' });

      await transition('HO_APPROVE');
      const { rows: approved } = await client.query(
        `SELECT final_approved_revision FROM public.project_subcontract_estimate_lines WHERE line_id = $1`,
        [lineId]
      );
      expect(approved[0].final_approved_revision).toBe(0);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
