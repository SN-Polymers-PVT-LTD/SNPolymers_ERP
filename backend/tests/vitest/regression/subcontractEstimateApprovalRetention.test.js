import { describe, expect, test } from 'vitest';

const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');

describe('Subcontract Estimate Phase 1 approval retention', () => {
  test('does not expose renamed legacy workflow functions to ordinary API roles', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    try {
      const { rows } = await client.query(
        "SELECT " +
        "has_function_privilege('anon', " +
        "'public.reconcile_subcontract_estimate_lines_phase1_legacy(uuid, character varying, timestamp with time zone, jsonb)'::regprocedure, 'EXECUTE') AS anon_reconcile, " +
        "has_function_privilege('authenticated', " +
        "'public.transition_subcontract_estimate_workflow_phase1_legacy(uuid, character varying, character varying, text, timestamp with time zone, integer)'::regprocedure, 'EXECUTE') AS authenticated_transition, " +
        "has_function_privilege('authenticated', " +
        "'public.submit_reopened_subcontract_estimate_phase1_legacy(uuid, character varying, timestamp with time zone)'::regprocedure, 'EXECUTE') AS authenticated_reopened"
      );
      expect(rows[0]).toEqual({
        anon_reconcile: false,
        authenticated_transition: false,
        authenticated_reopened: false
      });
    } finally {
      await client.end();
    }
  });

  test('retains unchanged approvals and remarks while corrected rejected rows restart at ZO', async () => {
    await requireLocalSupabase();
    const client = await createPgClient('postgresql://postgres:postgres@127.0.0.1:54322/postgres');
    await client.connect();
    const suffix = crypto.randomUUID().slice(0, 8);

    try {
      await client.query('BEGIN');
      const actor = (await client.query("SELECT mobile_number FROM public.authorised_users WHERE role = 'admin' AND is_active = true LIMIT 1")).rows[0]?.mobile_number;
      expect(actor).toBeTruthy();
      const workOrder = 'WO-SUB-P1-' + suffix;
      await client.query("INSERT INTO public.projects_master (work_order_no, estimate_no, site_details, state, district, zone, department, created_by, edited_by, work_order_value, status) VALUES ($1, $2, 'P1 site', 'Test State', 'Test District', 'Test Zone', 'Test Department', $3, $3, 100000, 'Running')", [workOrder, 'EST-SUB-P1-' + suffix, actor]);
      const workId = (await client.query("INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by) VALUES ($1, $2, 'Mtr', $3) RETURNING id", ['P1 Head ' + suffix, 'P1 Work ' + suffix, actor])).rows[0].id;
      const contractorId = (await client.query('INSERT INTO public.subcontractor_master (subcontractor_name, created_by) VALUES ($1, $2) RETURNING id', ['P1 Contractor ' + suffix, actor])).rows[0].id;
      const estimateId = (await client.query('INSERT INTO public.project_subcontract_estimates (work_order_no, created_by, last_modified_by) VALUES ($1, $2, $2) RETURNING subcontract_estimate_id', [workOrder, actor])).rows[0].subcontract_estimate_id;
      const lineRows = (await client.query('INSERT INTO public.project_subcontract_estimate_lines (subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount, created_by) VALUES ($1, $2, $3, 10, 100, 1000, $4), ($1, $2, $3, 20, 100, 2000, $4) RETURNING line_id, qty', [estimateId, contractorId, workId, actor])).rows;
      const [a, b] = lineRows.sort((left, right) => Number(left.qty) - Number(right.qty));

      const timestamp = async () => (await client.query('SELECT updated_at::text AS updated_at FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [estimateId])).rows[0].updated_at;
      const transition = async (action, remarks = null) => client.query('SELECT public.transition_subcontract_estimate_workflow($1, $2, $3, $4, $5, 24)', [estimateId, actor, action, remarks, await timestamp()]);
      const review = async (stage, approvals) => client.query('SELECT public.review_subcontract_estimate_rows($1, $2, $3, $4::jsonb, $5)', [estimateId, actor, stage, JSON.stringify(approvals), await timestamp()]);
      const lines = qty => [
        { line_id: a.line_id, subcontractor_id: contractorId, subcontract_work_id: workId, qty: 10, rate: 100, entry_kind: 'BASE' },
        { line_id: b.line_id, subcontractor_id: contractorId, subcontract_work_id: workId, qty, rate: 100, entry_kind: 'BASE' }
      ];
      const reconcile = async (payload, expected = null) => client.query('SELECT public.reconcile_subcontract_estimate_lines($1, $2, $3, $4::jsonb)', [estimateId, actor, expected || await timestamp(), JSON.stringify(payload)]);
      const rows = async () => (await client.query('SELECT line_id, qty, zo_office_approve, zo_remarks, ho_office_approve, ho_remarks FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 ORDER BY qty', [estimateId])).rows;
      const expectCode = async (fn, code) => {
        await client.query('SAVEPOINT phase1_error');
        try {
          await expect(fn()).rejects.toMatchObject({ code });
        } finally {
          await client.query('ROLLBACK TO SAVEPOINT phase1_error');
          await client.query('RELEASE SAVEPOINT phase1_error');
        }
      };

      await transition('SUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await review('ZO', [
        { line_id: a.line_id, approve_status: 'Approve', remarks: 'A ZO approved' },
        { line_id: b.line_id, approve_status: 'Not Approve', remarks: 'Correct B quantity' }
      ]);
      await transition('ZO_REQUEST_REVISION', 'Correct B');

      // A no-change save retains approval/rejection decisions and remarks.
      await reconcile(lines(20));
      let current = await rows();
      expect(current[0]).toMatchObject({ zo_office_approve: 'Approve', zo_remarks: 'A ZO approved' });
      expect(current[1]).toMatchObject({ zo_office_approve: 'Not Approve', zo_remarks: 'Correct B quantity' });

      // Corrected B resets; unchanged A is not invalidated.
      await reconcile(lines(21));
      current = await rows();
      expect(current[0]).toMatchObject({ zo_office_approve: 'Approve', zo_remarks: 'A ZO approved', ho_office_approve: null });
      expect(current[1]).toMatchObject({ qty: '21.0000', zo_office_approve: null, zo_remarks: null, ho_office_approve: null, ho_remarks: null });

      await transition('RESUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await review('ZO', [{ line_id: b.line_id, approve_status: 'Approve', remarks: 'B ZO approved' }]);
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await review('HO', [
        { line_id: a.line_id, approve_status: 'Approve', remarks: 'A HO approved' },
        { line_id: b.line_id, approve_status: 'Not Approve', remarks: 'Correct B rate' }
      ]);
      await transition('HO_REQUEST_REVISION', 'Correct B rate');

      // A direct resubmit cannot turn B's retained HO rejection into an
      // approval. Its retained ZO approval can complete ZO, but Final
      // Approval remains blocked until B receives a fresh HO decision.
      await transition('RESUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await expectCode(() => transition('HO_APPROVE'), 'P4B17');
      await transition('HO_REQUEST_REVISION', 'B remains rejected until corrected');

      // A retains both decisions but is protected from edit and omission.
      await reconcile(lines(21));
      current = await rows();
      expect(current[0]).toMatchObject({ zo_office_approve: 'Approve', ho_office_approve: 'Approve', ho_remarks: 'A HO approved' });
      await expectCode(() => reconcile(lines(21).map(line => line.line_id === a.line_id ? { ...line, qty: 11 } : line)), 'P4B59');
      await expectCode(() => reconcile([lines(21)[1]]), 'P4B59');

      // Stale saves fail without partially clearing the retained decisions.
      await reconcile(lines(22));
      await expectCode(() => reconcile(lines(23), '2000-01-01T00:00:00.000Z'), 'P4B43');
      current = await rows();
      expect(current[0]).toMatchObject({ zo_office_approve: 'Approve', ho_office_approve: 'Approve' });
      expect(current[1]).toMatchObject({ qty: '22.0000', zo_office_approve: null, ho_office_approve: null });

      await transition('RESUBMIT');
      await transition('OPEN_ZO_REVIEW');
      await review('ZO', [{ line_id: b.line_id, approve_status: 'Approve', remarks: 'B corrected ZO' }]);
      await transition('ZO_APPROVE');
      await transition('OPEN_HO_REVIEW');
      await review('HO', [{ line_id: b.line_id, approve_status: 'Approve', remarks: 'B corrected HO' }]);
      await transition('HO_APPROVE');
      current = await rows();
      expect(current.every(row => row.zo_office_approve === 'Approve' && row.ho_office_approve === 'Approve')).toBe(true);
      expect((await client.query('SELECT count(*)::int AS count FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1 AND final_approved_revision IS NOT NULL', [estimateId])).rows[0].count).toBe(2);
    } finally {
      await client.query('ROLLBACK');
      await client.end();
    }
  });
});
