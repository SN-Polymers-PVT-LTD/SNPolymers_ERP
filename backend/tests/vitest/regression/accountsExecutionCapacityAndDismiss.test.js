import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const crypto = require('crypto');
const { createPgClient } = require('../../../scripts/lib/pg-connect');
const { computeMainHeadCapacity } = require('../../../src/services/mainHeadCapacity.service');
const { dismissImportEligibleItem, restoreFundRequestImport } = require('../../../src/controllers/acctRequisition.controller');
const mockRes = require('../../helpers/mockRes');

const DB_URL = process.env.SUPABASE_TEST_DB_URI || 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('Payment Requisition & Accounts Execution Workflow', () => {
  let client;
  let suffix;
  let actor;
  let baseWorkOrder;
  let baseEstimateNo;
  let baseCeId;
  let seId;
  let contractorId;
  let workId;
  let sheetId;
  const createdWos = [];

  async function createProjectWithEstimate(wo, amount = 20000) {
    createdWos.push(wo);
    await client.query(
      `INSERT INTO public.projects_master (
         work_order_no, estimate_no, site_details, state, district, zone, department,
         created_by, edited_by, work_order_value, status
       ) VALUES ($1, $1, 'Site', 'State', 'District', 'Zone', 'Dept', $2, $2, 100000, 'Running')`,
      [wo, actor]
    );
    const { rows } = await client.query(
      `INSERT INTO public.project_cost_estimates (
         work_order_no, estimate_no, area_code, zonal_office_no, estimate_amount, estimate_status,
         created_by, last_modified_by
       ) VALUES ($1, $1, 'Zone', 'ZO', $2, 'Final Approved', $3, $3)
       RETURNING estimate_id`,
      [wo, amount, actor]
    );
    await client.query(`SELECT set_config('app.phase5_sync', 'on', false)`);
    await client.query(
      `INSERT INTO public.project_cost_estimate_items (
         estimate_id, material_main_head, material_sub_head, material_details, unit, qty, rate, amount,
         source_type
       ) VALUES ($1, 'Material', 'General', 'Item', 'nos', 1, $2, $2, 'MANUAL')`,
      [rows[0].estimate_id, amount]
    );
    return rows[0].estimate_id;
  }

  beforeAll(async () => {
    client = await createPgClient(DB_URL);
    await client.connect();

    suffix = crypto.randomUUID().slice(0, 8);
    actor = `9911${suffix}`;
    baseWorkOrder = `WO-EXEC-${suffix}`;
    baseEstimateNo = `EST-EXEC-${suffix}`;
    createdWos.push(baseWorkOrder);

    // Create user
    await client.query(
      `INSERT INTO public.authorised_users (mobile_number, display_name, role, is_active)
       VALUES ($1, $2, 'admin', true)`,
      [actor, `Admin ${suffix}`]
    );

    // Create accounts sheet for line items
    const { rows: sheetRows } = await client.query(
      `INSERT INTO public.acct_requisition_sheets (sheet_number, sheet_status, created_by)
       VALUES ($1, 'Open', $2)
       RETURNING id`,
      [`SH-${suffix}`, actor]
    );
    sheetId = sheetRows[0].id;

    // Create project
    await client.query(
      `INSERT INTO public.projects_master (
         work_order_no, estimate_no, site_details, state, district, zone, department,
         created_by, edited_by, work_order_value, status
       ) VALUES ($1, $2, 'Exec Site', 'State', 'District', 'Zone', 'Dept', $3, $3, 500000, 'Running')`,
      [baseWorkOrder, baseEstimateNo, actor]
    );

    // Subcontract master & work
    const { rows: workRows } = await client.query(
      `INSERT INTO public.subcontract_work_master (sub_head, material_details, unit, created_by)
       VALUES ('Civil', 'Work A', 'nos', $1) RETURNING id`,
      [actor]
    );
    workId = workRows[0].id;

    const { rows: contRows } = await client.query(
      `INSERT INTO public.subcontractor_master (subcontractor_name, created_by)
       VALUES ($1, $2) RETURNING id`,
      [`Contractor ${suffix}`, actor]
    );
    contractorId = contRows[0].id;

    // Create Cost Estimate (Material = 20,000, Sub Contractor = 10,000)
    const { rows: ceRows } = await client.query(
      `INSERT INTO public.project_cost_estimates (
         work_order_no, estimate_no, area_code, zonal_office_no, estimate_amount, estimate_status,
         created_by, last_modified_by
       ) VALUES ($1, $2, 'Zone', 'ZO', 30000, 'Final Approved', $3, $3)
       RETURNING estimate_id`,
      [baseWorkOrder, baseEstimateNo, actor]
    );
    baseCeId = ceRows[0].estimate_id;

    // Cost estimate items: set app.phase5_sync and valid source_type
    await client.query(`SELECT set_config('app.phase5_sync', 'on', false)`);
    await client.query(
      `INSERT INTO public.project_cost_estimate_items (
         estimate_id, material_main_head, material_sub_head, material_details, unit, qty, rate, amount,
         source_type, subcontract_work_id
       ) VALUES
       ($1, 'Material', 'General', 'Item A', 'nos', 20, 1000, 20000, 'MANUAL', NULL),
       ($1, 'Sub Contractor', 'Civil', 'Work A', 'nos', 10, 1000, 10000, 'SUBCONTRACT_ESTIMATE', $2)`,
      [baseCeId, workId]
    );

    // Subcontract estimate
    const { rows: seRows } = await client.query(
      `INSERT INTO public.project_subcontract_estimates (
         work_order_no, estimate_revision, estimate_amount, estimate_status, created_by, last_modified_by
       ) VALUES ($1, 0, 10000, 'Final Approved', $2, $2)
       RETURNING subcontract_estimate_id`,
      [baseWorkOrder, actor]
    );
    seId = seRows[0].subcontract_estimate_id;

    await client.query(
      `INSERT INTO public.project_subcontract_estimate_lines (
         subcontract_estimate_id, subcontractor_id, subcontract_work_id, qty, rate, amount,
         entry_kind, zo_office_approve, ho_office_approve, final_approved_revision, final_approved_at,
         final_approved_by, created_by
       ) VALUES ($1, $2, $3, 10, 1000, 10000, 'BASE', 'Approve', 'Approve', 0, now(), $4, $4)`,
      [seId, contractorId, workId, actor]
    );
  });

  afterAll(async () => {
    if (!client) return;
    await client.query("SET session_replication_role = 'replica'");
    await client.query('DELETE FROM public.subcontractor_ledger WHERE work_order_no = ANY($1)', [createdWos]);
    await client.query('DELETE FROM public.acct_requisition_line_items WHERE work_order_no = ANY($1)', [createdWos]);
    await client.query('DELETE FROM public.acct_requisition_sheets WHERE id = $1', [sheetId]);
    await client.query('DELETE FROM public.requisitions WHERE work_order_no = ANY($1)', [createdWos]);
    await client.query('DELETE FROM public.fund_requests WHERE work_order_no = ANY($1)', [createdWos]);
    await client.query('DELETE FROM public.project_cost_estimate_items WHERE estimate_id IN (SELECT estimate_id FROM public.project_cost_estimates WHERE work_order_no = ANY($1))', [createdWos]);
    await client.query('DELETE FROM public.project_cost_estimates WHERE work_order_no = ANY($1)', [createdWos]);
    await client.query('DELETE FROM public.project_subcontract_estimate_lines WHERE subcontract_estimate_id = $1', [seId]);
    await client.query('DELETE FROM public.project_subcontract_estimates WHERE subcontract_estimate_id = $1', [seId]);
    await client.query('DELETE FROM public.subcontractor_master WHERE id = $1', [contractorId]);
    await client.query('DELETE FROM public.subcontract_work_master WHERE id = $1', [workId]);
    await client.query('DELETE FROM public.projects_master WHERE work_order_no = ANY($1)', [createdWos]);
    await client.query('DELETE FROM public.authorised_users WHERE mobile_number = $1', [actor]);
    await client.query("SET session_replication_role = 'origin'");
    await client.end();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 1: Dismissing an unimported Payment Requisition
  // ──────────────────────────────────────────────────────────────────────────
  test('1. Dismissing an unimported Payment Requisition sets payment_status = REJECTED and retains ZO Approved', async () => {
    const reqNo = `REQ-DISM-${crypto.randomUUID().slice(0, 6)}`;
    const { rows } = await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, created_by
       ) VALUES (
         $1, $2, $3, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', $4, 'Material',
         'p.pdf', 5000, 5000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'PENDING_ACCOUNTS_IMPORT', $1
       ) RETURNING requisition_id`,
      [actor, baseWorkOrder, baseEstimateNo, reqNo]
    );
    const reqId = rows[0].requisition_id;

    // Verify it is in import queue
    const { rows: queueBefore } = await client.query(
      `SELECT * FROM public.get_accounts_import_queue(1, 20)`
    );
    const inQueueBefore = (queueBefore[0].get_accounts_import_queue?.items || []).some(i => i.id === reqId);
    expect(inQueueBefore).toBe(true);

    // Dismiss via controller
    const req = { params: { itemId: reqId }, query: { item_type: 'PAYMENT_REQUISITION' }, user: { mobile_number: actor, role: 'accounts' } };
    const res = mockRes();
    await dismissImportEligibleItem(req, res);
    expect(res.statusCode).toBe(200);

    // Verify in database
    const { rows: reqRows } = await client.query(
      `SELECT requisition_status, payment_status, accounts_import_dismissed, paid_amount, payment_date
       FROM public.requisitions WHERE requisition_id = $1`,
      [reqId]
    );
    expect(reqRows[0].requisition_status).toBe('Approved'); // historical ZO approval preserved
    expect(reqRows[0].payment_status).toBe('REJECTED');     // terminal accounts rejection
    expect(reqRows[0].accounts_import_dismissed).toBe(true);
    expect(Number(reqRows[0].paid_amount)).toBe(0);
    expect(reqRows[0].payment_date).toBeNull();

    // Verify removed from queue
    const { rows: queueAfter } = await client.query(
      `SELECT * FROM public.get_accounts_import_queue(1, 20)`
    );
    const inQueueAfter = (queueAfter[0].get_accounts_import_queue?.items || []).some(i => i.id === reqId);
    expect(inQueueAfter).toBe(false);

    // Verify audit log
    const { rows: auditRows } = await client.query(
      `SELECT * FROM public.audit_log WHERE record_identifier = $1 AND action = 'PAYMENT_REQUISITION_DISMISSED'`,
      [reqId]
    );
    expect(auditRows.length).toBeGreaterThan(0);
    expect(auditRows[0].user_id).toBe(actor);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 2: Dismissing a Fund Request & Deprecated Restore Endpoint
  // ──────────────────────────────────────────────────────────────────────────
  test('2. Dismissing a Fund Request sets request_status = Rejected, and restore endpoint returns 410', async () => {
    const frNo = `FR-${crypto.randomUUID().slice(0, 6)}`;
    const { rows } = await client.query(
      `INSERT INTO public.fund_requests (
         zo_user_id, zo_fr_no, zo_fr_amount, request_status, work_order_no, created_by
       ) VALUES ($1, $2, 3000, 'Pending', $3, $1)
       RETURNING fund_request_id`,
      [actor, frNo, baseWorkOrder]
    );
    const frId = rows[0].fund_request_id;

    // Dismiss via controller
    const req = { params: { itemId: frId }, query: { item_type: 'FUND_REQUEST' }, user: { mobile_number: actor, role: 'accounts' } };
    const res = mockRes();
    await dismissImportEligibleItem(req, res);
    expect(res.statusCode).toBe(200);

    const { rows: frRows } = await client.query(
      `SELECT request_status, accounts_import_dismissed FROM public.fund_requests WHERE fund_request_id = $1`,
      [frId]
    );
    expect(frRows[0].request_status).toBe('Rejected');
    expect(frRows[0].accounts_import_dismissed).toBe(true);

    // Deprecated restore returns 410 Gone
    const restoreReq = { params: { id: frId }, user: { mobile_number: actor, role: 'accounts' } };
    const restoreRes = mockRes();
    await restoreFundRequestImport(restoreReq, restoreRes);
    expect(restoreRes.statusCode).toBe(410);
    expect(restoreRes.jsonData.message).toContain('deprecated');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 3: Dismissing a source-derived On Hold line item propagates rejection
  // ──────────────────────────────────────────────────────────────────────────
  test('3. Dismissing a source-derived line item propagates REJECTED to Payment Requisition', async () => {
    const reqNo = `REQ-ROLL-${crypto.randomUUID().slice(0, 6)}`;
    const { rows: reqRows } = await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, created_by
       ) VALUES (
         $1, $2, $3, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', $4, 'Material',
         'p.pdf', 4000, 4000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'ON_HOLD', $1
       ) RETURNING requisition_id`,
      [actor, baseWorkOrder, baseEstimateNo, reqNo]
    );
    const sourceReqId = reqRows[0].requisition_id;

    // Create line item referencing sourceReqId with valid sheet_id
    const { rows: liRows } = await client.query(
      `INSERT INTO public.acct_requisition_line_items (
         sheet_id, req_amount, requisition_status, work_order_no, source_requisition_id,
         import_dismissed, created_by
       ) VALUES ($1, 4000, 'On Hold', $2, $3, false, $4)
       RETURNING id`,
      [sheetId, baseWorkOrder, sourceReqId, actor]
    );
    const lineItemId = liRows[0].id;

    // Link requisition to line item
    await client.query(
      `UPDATE public.requisitions SET accounts_line_item_id = $1 WHERE requisition_id = $2`,
      [lineItemId, sourceReqId]
    );

    // Dismiss line item
    const req = { params: { itemId: lineItemId }, query: { item_type: 'LINE_ITEM' }, user: { mobile_number: actor, role: 'accounts' } };
    const res = mockRes();
    await dismissImportEligibleItem(req, res);
    expect(res.statusCode).toBe(200);

    // Verify line item
    const { rows: updatedLi } = await client.query(
      `SELECT import_dismissed FROM public.acct_requisition_line_items WHERE id = $1`,
      [lineItemId]
    );
    expect(updatedLi[0].import_dismissed).toBe(true);

    // Verify source requisition received REJECTED
    const { rows: updatedReq } = await client.query(
      `SELECT payment_status FROM public.requisitions WHERE requisition_id = $1`,
      [sourceReqId]
    );
    expect(updatedReq[0].payment_status).toBe('REJECTED');
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 4: Subcontract Payment Requisition releases reserved capacity exactly once
  // ──────────────────────────────────────────────────────────────────────────
  test('4. Dismissing a subcontract Payment Requisition releases reserved capacity exactly once', async () => {
    // Check initial capacity
    const { rows: initCap } = await client.query(
      `SELECT * FROM public.get_subcontract_finance_capacity($1, $2, $3)`,
      [baseWorkOrder, contractorId, workId]
    );
    expect(Number(initCap[0].effective_available_capacity)).toBe(10000);

    // Create and approve a subcontract requisition for 4000
    const reqNo = `REQ-SC-${crypto.randomUUID().slice(0, 6)}`;
    const { rows: reqRows } = await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         material_sub_head, material_details, requisition_pdf_url, requisition_amount,
         approved_amount, approved_balance_amount, gst_bill, bank_details, requisition_status,
         subcontractor_id, subcontract_work_id, payment_destination, payment_status, created_by
       ) VALUES (
         $1, $2, $3, 10000, 'State', 'District', 'Zone', 'Dept', 'Site', $4, 'Sub Contractor',
         'Civil', 'Work A', 'p.pdf', 4000, 4000, 0, 'No', 'Bank', 'Pending', $5, $6,
         'ACCOUNTS', 'AWAITING_PAYMENT_ROUTE', $1
       ) RETURNING requisition_id`,
      [actor, baseWorkOrder, baseEstimateNo, reqNo, contractorId, workId]
    );
    const scReqId = reqRows[0].requisition_id;

    // Approve requisition
    await client.query(
      `SELECT public.approve_requisition_transact($1, 4000, $2, 'Approved')`,
      [scReqId, actor]
    );

    await client.query(
      `UPDATE public.requisitions SET payment_destination = 'ACCOUNTS', payment_status = 'PENDING_ACCOUNTS_IMPORT' WHERE requisition_id = $1`,
      [scReqId]
    );

    // Capacity is now consumed: 4000 reserved, 6000 available
    const { rows: resCap } = await client.query(
      `SELECT * FROM public.get_subcontract_finance_capacity($1, $2, $3)`,
      [baseWorkOrder, contractorId, workId]
    );
    expect(Number(resCap[0].reserved_amount)).toBe(4000);
    expect(Number(resCap[0].effective_available_capacity)).toBe(6000);

    // Dismiss from accounts
    const req = { params: { itemId: scReqId }, query: { item_type: 'PAYMENT_REQUISITION' }, user: { mobile_number: actor, role: 'accounts' } };
    const res = mockRes();
    await dismissImportEligibleItem(req, res);
    expect(res.statusCode).toBe(200);

    // Capacity restored to 10000!
    const { rows: freedCap } = await client.query(
      `SELECT * FROM public.get_subcontract_finance_capacity($1, $2, $3)`,
      [baseWorkOrder, contractorId, workId]
    );
    expect(Number(freedCap[0].reserved_amount)).toBe(0);
    expect(Number(freedCap[0].effective_available_capacity)).toBe(10000);

    // Verify exactly one REQUISITION_RELEASE ledger entry exists
    const { rows: ledgerRows } = await client.query(
      `SELECT * FROM public.subcontractor_ledger
       WHERE reference_id = $1 AND transaction_type = 'REQUISITION_RELEASE'`,
      [scReqId]
    );
    expect(ledgerRows.length).toBe(1);
    expect(Number(ledgerRows[0].amount)).toBe(4000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 5: Main Head capacity: Approved ₹10k → Accounts Reject → full ₹10k restored
  // ──────────────────────────────────────────────────────────────────────────
  test('5. Main Head capacity: Approved ₹10k -> Accounts Dismiss -> full ₹10k restored', async () => {
    const testWo = `WO-CAP5-${suffix}`;
    await createProjectWithEstimate(testWo, 20000);

    const reqNo = `REQ-CAP1-${crypto.randomUUID().slice(0, 6)}`;
    const { rows } = await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', $3, 'Material',
         'p.pdf', 10000, 10000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'PENDING_ACCOUNTS_IMPORT', $1
       ) RETURNING requisition_id`,
      [actor, testWo, reqNo]
    );
    const reqId = rows[0].requisition_id;

    // Check capacity before dismiss: 10,000 consumed
    const capBefore = await computeMainHeadCapacity(testWo, 'Material');
    expect(capBefore.mainHeadEstimate).toBe(20000);
    expect(capBefore.cumulativeApproved).toBe(10000);
    expect(capBefore.remainingCapacity).toBe(10000);

    // Dismiss (Accounts Reject)
    await client.query(`SELECT public.dismiss_accounts_import_item_transact($1, 'PAYMENT_REQUISITION', $2)`, [reqId, actor]);

    // Check capacity after dismiss: 10k is restored!
    const capAfter = await computeMainHeadCapacity(testWo, 'Material');
    expect(capAfter.cumulativeApproved).toBe(0);
    expect(capAfter.remainingCapacity).toBe(20000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 6: Main Head capacity: Approved ₹10k → Partial ₹6k → only ₹6k remains consumed
  // ──────────────────────────────────────────────────────────────────────────
  test('6. Main Head capacity: Approved ₹10k -> Partial ₹6k -> only ₹6k consumed', async () => {
    const testWo = `WO-CAP6-${suffix}`;
    await createProjectWithEstimate(testWo, 20000);

    const reqNo = `REQ-CAP2-${crypto.randomUUID().slice(0, 6)}`;
    await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, paid_amount, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', $3, 'Material',
         'p.pdf', 10000, 10000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'PARTIALLY_PAID', 6000, $1
       )`,
      [actor, testWo, reqNo]
    );

    const cap = await computeMainHeadCapacity(testWo, 'Material');
    expect(cap.cumulativeApproved).toBe(6000);
    expect(cap.remainingCapacity).toBe(14000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 7: Return for Correction preserves reservation until resubmitted
  // ──────────────────────────────────────────────────────────────────────────
  test('7. Return for Correction: keeps ₹10k reserved while editing; reduces to ₹7k after resubmit', async () => {
    const testWo = `WO-CAP7-${suffix}`;
    await createProjectWithEstimate(testWo, 20000);

    const reqNo = `REQ-CAP3-${crypto.randomUUID().slice(0, 6)}`;
    const { rows: reqRows } = await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', $3, 'Material',
         'p.pdf', 10000, 10000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'RETURNED_FOR_CORRECTION', $1
       ) RETURNING requisition_id`,
      [actor, testWo, reqNo]
    );
    const reqId = reqRows[0].requisition_id;

    // Line item with reduced amount 7000 in open sheet
    const { rows: liRows } = await client.query(
      `INSERT INTO public.acct_requisition_line_items (
         sheet_id, req_amount, requisition_status, work_order_no, source_requisition_id,
         import_dismissed, created_by
       ) VALUES ($1, 7000, 'Returned for Correction', $2, $3, false, $4)
       RETURNING id`,
      [sheetId, testWo, reqId, actor]
    );
    const lineItemId = liRows[0].id;

    await client.query(
      `UPDATE public.requisitions SET accounts_line_item_id = $1 WHERE requisition_id = $2`,
      [lineItemId, reqId]
    );

    // While still RETURNED_FOR_CORRECTION: capacity still reserves full ₹10,000!
    const capDuringEdit = await computeMainHeadCapacity(testWo, 'Material');
    expect(capDuringEdit.cumulativeApproved).toBe(10000);
    expect(capDuringEdit.remainingCapacity).toBe(10000);

    // Once Accounts resubmits to HO: status becomes PENDING_HO_REVIEW
    await client.query(
      `UPDATE public.requisitions SET payment_status = 'PENDING_HO_REVIEW' WHERE requisition_id = $1`,
      [reqId]
    );

    // Now capacity consumes LEAST(10000, 7000) = 7000, restoring 3000!
    const capAfterSubmit = await computeMainHeadCapacity(testWo, 'Material');
    expect(capAfterSubmit.cumulativeApproved).toBe(7000);
    expect(capAfterSubmit.remainingCapacity).toBe(13000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 8: Transactional BUD02 check uses the exact same calculation
  // ──────────────────────────────────────────────────────────────────────────
  test('8. Transactional BUD02 check uses revised capacity and enforces limits', async () => {
    const testWo = `WO-CAP8-${suffix}`;
    await createProjectWithEstimate(testWo, 20000);

    // Insert Req 1: Approved 15,000, but REJECTED -> consumes 0
    await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', 'REQ-BUD-REJ', 'Material',
         'p.pdf', 15000, 15000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'REJECTED', $1
       )`,
      [actor, testWo]
    );

    // Insert Req 2: Approved 10,000, PARTIALLY_PAID 6,000 -> consumes 6,000
    await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_destination, payment_status, paid_amount, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', 'REQ-BUD-PART', 'Material',
         'p.pdf', 10000, 10000, 0, 'No', 'Bank', 'Approved', 'ACCOUNTS', 'PARTIALLY_PAID', 6000, $1
       )`,
      [actor, testWo]
    );

    // Remaining capacity is 20000 - 6000 = 14000.
    // Create Req 3 Pending approval
    const { rows: r3 } = await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, gst_bill, bank_details,
         requisition_status, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', 'REQ-BUD-TEST', 'Material',
         'p.pdf', 15000, 'No', 'Bank', 'Pending', $1
       ) RETURNING requisition_id`,
      [actor, testWo]
    );
    const req3Id = r3[0].requisition_id;

    // Attempt to approve 15,000 -> exceeds remaining 14,000 -> MUST FAIL with BUD02
    await expect(
      client.query(`SELECT public.approve_requisition_transact($1, 15000, $2, 'Attempt 15k')`, [req3Id, actor])
    ).rejects.toThrow(/exceeds the remaining Main Head capacity/i);

    // Attempt to approve 14,000 -> fits remaining capacity -> MUST SUCCEED
    const { rows: appRows } = await client.query(
      `SELECT public.approve_requisition_transact($1, 14000, $2, 'Attempt 14k')`,
      [req3Id, actor]
    );
    expect(appRows.length).toBe(1);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 9: Historical Approved rows with NULL payment_status consume approved_amount
  // ──────────────────────────────────────────────────────────────────────────
  test('9. Historical Approved requisitions with null payment_status continue consuming approved_amount', async () => {
    const testWo = `WO-CAP9-${suffix}`;
    await createProjectWithEstimate(testWo, 20000);

    await client.query(
      `INSERT INTO public.requisitions (
         requester_user_id, work_order_no, estimate_no, estimate_amount, state, district,
         area_code, department, site_details, requisition_no, material_main_head,
         requisition_pdf_url, requisition_amount, approved_amount, approved_balance_amount,
         gst_bill, bank_details, requisition_status, payment_status, created_by
       ) VALUES (
         $1, $2, $2, 20000, 'State', 'District', 'Zone', 'Dept', 'Site', 'REQ-HIST-NULL', 'Material',
         'p.pdf', 5000, 5000, 0, 'No', 'Bank', 'Approved', NULL, $1
       )`,
      [actor, testWo]
    );

    const cap = await computeMainHeadCapacity(testWo, 'Material');
    expect(cap.cumulativeApproved).toBe(5000);
    expect(cap.remainingCapacity).toBe(15000);
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Test 10: Import queue pagination handles >100 rows across pages
  // ──────────────────────────────────────────────────────────────────────────
  test('10. Import queue with >100 rows can be navigated through multiple pages without losing records', async () => {
    // Seed 105 test fund requests
    const count = 105;
    const values = [];
    for (let i = 1; i <= count; i++) {
      values.push(`('${actor}', 'FR-PG-${suffix}-${i}', 100, 'Pending', '${baseWorkOrder}', '${actor}')`);
    }
    await client.query(
      `INSERT INTO public.fund_requests (zo_user_id, zo_fr_no, zo_fr_amount, request_status, work_order_no, created_by)
       VALUES ${values.join(', ')}`
    );

    // Page 1 with limit 20
    const { rows: p1 } = await client.query(
      `SELECT * FROM public.get_accounts_import_queue(1, 20, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
    );
    const p1Data = p1[0].get_accounts_import_queue;
    expect(p1Data.items.length).toBe(20);
    expect(Number(p1Data.total)).toBeGreaterThanOrEqual(105);

    // Page 2 with limit 20
    const { rows: p2 } = await client.query(
      `SELECT * FROM public.get_accounts_import_queue(2, 20, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`
    );
    const p2Data = p2[0].get_accounts_import_queue;
    expect(p2Data.items.length).toBe(20);

    // Page 1 and Page 2 items must be completely distinct
    const p1Ids = new Set(p1Data.items.map(i => i.id));
    const overlap = p2Data.items.filter(i => p1Ids.has(i.id));
    expect(overlap.length).toBe(0);

    // Clean up seeded test fund requests using replica session
    await client.query("SET session_replication_role = 'replica'");
    await client.query(`DELETE FROM public.fund_requests WHERE zo_fr_no LIKE $1`, [`FR-PG-${suffix}-%`]);
    await client.query("SET session_replication_role = 'origin'");
  });
});
