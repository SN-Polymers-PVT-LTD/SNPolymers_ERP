import { describe, expect, test } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontract Estimate Phase 4B M4 reopen and signed delta lines', () => {
  test('reopens once, preserves history, supports addition/adjustment, and blocks invalid final scope', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().slice(0, 8);

    try {
      await client.query('BEGIN');
      const { rows: actors } = await client.query("SELECT mobile_number FROM public.authorised_users WHERE role = 'admin' AND is_active = true LIMIT 1");
      const actor = actors[0].mobile_number;
      const workOrderNo = `WO-SUB-M4-${suffix}`;
      await client.query(
        `INSERT INTO public.projects_master
          (work_order_no, estimate_no, site_details, state, district, zone, department,
           created_by, edited_by, work_order_value, status)
         VALUES ($1, $2, 'M4 test site', 'Test State', 'Test District', 'Test Zone',
                 'Test Department', $3, $3, 100000, 'Running')`,
        [workOrderNo, `EST-SUB-M4-${suffix}`, actor]
      );
      const { rows: works } = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`M4 Head ${suffix}`, `M4 Work ${suffix}`, actor]
      );
      const { rows: contractors } = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`M4 Contractor ${suffix}`, actor]
      );
      const { rows: otherContractors } = await client.query(
        `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
         VALUES ($1, $2) RETURNING id`,
        [`M4 Other Contractor ${suffix}`, actor]
      );
      const { rows: otherWorks } = await client.query(
        `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
         VALUES ($1, $2, 'Mtr', $3) RETURNING id`,
        [`M4 Other Head ${suffix}`, `M4 Other Work ${suffix}`, actor]
      );
      const { rows: estimates } = await client.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2) RETURNING subcontract_estimate_id`,
        [workOrderNo, actor]
      );
      const estimateId = estimates[0].subcontract_estimate_id;
      const { rows: baseRows } = await client.query(
        `INSERT INTO public.project_subcontract_estimate_lines
          (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by)
         VALUES ($1, $2, $3, 10, 100, 1000, $4) RETURNING line_id`,
        [estimateId, contractors[0].id, works[0].id, actor]
      );
      const baseLineId = baseRows[0].line_id;

      const transition = async (action, remarks = null) => client.query(
        `SELECT public.transition_subcontract_estimate_workflow(
           $1, $2, $3, $4,
           (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1), 24)`,
        [estimateId, actor, action, remarks]
      );
      const reopen = async (remarks = 'M4 reopen') => client.query(
        `SELECT public.reopen_subcontract_estimate(
           $1, $2, $3,
           (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1))`,
        [estimateId, actor, remarks]
      );
      const reconcile = async (lines) => client.query(
        `SELECT public.reconcile_subcontract_estimate_lines(
           $1, $2,
           (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1),
           $3::jsonb)`,
        [estimateId, actor, JSON.stringify(lines)]
      );
      const expectError = async (fn, code) => {
        await client.query('SAVEPOINT m4_error');
        try {
          await expect(fn()).rejects.toMatchObject({ code });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT m4_error');
          await client.query('RELEASE SAVEPOINT m4_error');
        }
      };

      // Revision zero is BASE-only at the RPC boundary; callers cannot opt
      // into signed delta kinds before the first Final Approval.
      await expectError(() => reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: 1, rate: 100, entry_kind: 'ADDITION' }]), 'P4B52');
      await expectError(() => reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: -1, rate: 100, entry_kind: 'ADJUSTMENT', adjusts_line_id: baseLineId }]), 'P4B52');

      await transition('SUBMIT');
      expect((await client.query('SELECT je_user_id FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId])).rows[0].je_user_id).toBeNull();
      await transition('OPEN_ZO_REVIEW');
      await client.query(`UPDATE public.project_subcontract_estimate_lines SET zo_office_approve = 'Approve' WHERE line_id = $1`, [baseLineId]);
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await client.query(`UPDATE public.project_subcontract_estimate_lines SET ho_office_approve = 'Approve' WHERE line_id = $1`, [baseLineId]);
      await transition('HO_APPROVE');

      const { rows: before } = await client.query(`SELECT estimate_revision, estimate_status, estimate_amount, last_approved_amount FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1`, [estimateId]);
      await reopen();
      const { rows: reopened } = await client.query(`SELECT estimate_revision, estimate_status, estimate_amount, last_approved_amount FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1`, [estimateId]);
      expect(reopened[0]).toMatchObject({ estimate_revision: before[0].estimate_revision + 1, estimate_status: 'Estimate Reopened', estimate_amount: before[0].estimate_amount, last_approved_amount: before[0].last_approved_amount });
      const { rows: reopenedMetadata } = await client.query(`SELECT zo_approved_by, zo_approval_date, ho_approved_by, ho_approval_date FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1`, [estimateId]);
      expect(reopenedMetadata[0]).toMatchObject({ zo_approved_by: null, zo_approval_date: null, ho_approved_by: null, ho_approval_date: null });

      // Rejecting a reopened revision rejects only that attempt. The prior
      // approved baseline remains in the same lineage and can be reopened.
      await client.query(`SELECT public.submit_reopened_subcontract_estimate($1, $2, (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1))`, [estimateId, actor]);
      await transition('OPEN_ZO_REVIEW');
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await transition('HO_REJECT', 'Reject this revision');
      expect((await client.query('SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId])).rows[0].estimate_status).toBe('Rejected by HO');
      await expectError(() => client.query(
        `INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by)
         VALUES ($1, $2, $2)`,
        [workOrderNo, actor]
      ), 'P4B58');
      await reopen('Reopen the rejected revision');
      expect((await client.query('SELECT estimate_revision, estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId])).rows[0]).toMatchObject({ estimate_revision: before[0].estimate_revision + 2, estimate_status: 'Estimate Reopened' });
      await expectError(() => reopen('second reopen'), 'P4B34');

      // Reopened estimates use the dedicated resubmission path; ordinary
      // Draft SUBMIT is invalid in Estimate Reopened.
      await expectError(() => transition('SUBMIT'), 'P4B15');

      await expectError(() => reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: 1, rate: 100, entry_kind: 'BASE' }]), 'P4B47');
      await expectError(() => reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: -1, rate: 100, entry_kind: 'ADJUSTMENT', adjusts_line_id: crypto.randomUUID() }]), 'P4B49');
      await expectError(() => reconcile([{ subcontractor_id: otherContractors[0].id, subcontract_work_id: works[0].id, qty: -1, rate: 100, entry_kind: 'ADJUSTMENT', adjusts_line_id: baseLineId }]), 'P4B49');
      await expectError(() => reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: otherWorks[0].id, qty: -1, rate: 100, entry_kind: 'ADJUSTMENT', adjusts_line_id: baseLineId }]), 'P4B49');

      await reconcile([
        { subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: 3, rate: 100, entry_kind: 'ADDITION' },
        { subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: -2, rate: 100, entry_kind: 'ADJUSTMENT', adjusts_line_id: baseLineId }
      ]);
      const { rows: deltaRows } = await client.query(`SELECT line_id, entry_kind, qty, amount, adjusts_line_id, final_approved_revision FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 ORDER BY created_at`, [estimateId]);
      expect(deltaRows).toHaveLength(3);
      expect(deltaRows.filter(row => row.final_approved_revision === null)).toHaveLength(2);
      expect(deltaRows.find(row => row.entry_kind === 'ADJUSTMENT')).toMatchObject({ qty: '-2.0000', amount: '-200.00', adjusts_line_id: baseLineId });

      const adjustmentId = deltaRows.find(row => row.entry_kind === 'ADJUSTMENT').line_id;
      await expectError(() => reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: -1, rate: 100, entry_kind: 'ADJUSTMENT', adjusts_line_id: adjustmentId }]), 'P4B49');

      // A zero effective quantity with nonzero money is not a valid weighted-
      // rate scope; only the exact (0 qty, 0 amount) cancellation is valid.
      await reconcile([{ subcontractor_id: contractors[0].id, subcontract_work_id: works[0].id, qty: -10, rate: 50, entry_kind: 'ADJUSTMENT', adjusts_line_id: baseLineId }]);
      await client.query(`SELECT public.submit_reopened_subcontract_estimate($1, $2, (SELECT updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1))`, [estimateId, actor]);
      await transition('OPEN_ZO_REVIEW');
      const { rows: currentLines } = await client.query(`SELECT line_id FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 AND final_approved_revision IS NULL`, [estimateId]);
      await client.query(`UPDATE public.project_subcontract_estimate_lines SET zo_office_approve = 'Approve' WHERE subcontract_estimate_id = $1 AND final_approved_revision IS NULL`, [estimateId]);
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await expectError(() => transition('HO_APPROVE'), 'P4B17');
      await client.query(`UPDATE public.project_subcontract_estimate_lines SET ho_office_approve = 'Approve' WHERE subcontract_estimate_id = $1 AND final_approved_revision IS NULL`, [estimateId]);
      await expectError(() => transition('HO_APPROVE'), 'P4B29');
      expect(currentLines.length).toBeGreaterThan(0);
      const { rows: afterFailure } = await client.query(`SELECT estimate_status FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1`, [estimateId]);
      expect(afterFailure[0].estimate_status).toBe('Under HO Review');
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
