import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { generateTokens } = require('../../../src/services/session.service');
const app = require('../../../src/app');

const prefix = '/api/v1/auth/hr/leaves';
let db, server, base, year;
const actors = {};
const tokens = {};
const employees = {};

const date = (month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

async function request(method, path, role = 'ho', body) {
  const response = await fetch(`${base}${prefix}${path}`, {
    method,
    headers: {
      ...(tokens[role] ? { Cookie: `accessToken=${tokens[role].accessToken}` } : {}),
      'Content-Type': 'application/json'
    },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

beforeAll(async () => {
  await requireLocalSupabase();
  db = new Client({ connectionString: process.env.SUPABASE_TEST_DB_URI });
  await db.connect();

  year = Number((await db.query(`
    SELECT y FROM generate_series(2200, 2400) y
    WHERE NOT EXISTS(SELECT 1 FROM hr_leave_requests WHERE extract(year FROM from_date) = y)
    ORDER BY y LIMIT 1
  `)).rows[0].y);

  // Create users for each role
  for (const role of ['admin', 'ho', 'factory_manager', 'je', 'zo', 'accounts', 'unlinked_user', 'factory_user']) {
    const u = (await db.query(
      'INSERT INTO authorised_users(mobile_number, role, display_name, is_active) VALUES($1, $2, $3, true) RETURNING *',
      [
        String(crypto.randomInt(7000000000, 9999999999)),
        role === 'unlinked_user' ? 'ho' : (role === 'factory_user' ? 'je' : role),
        `SelfService ${role}`
      ]
    )).rows[0];
    actors[role] = u.id;
    const session = (await db.query(
      'INSERT INTO sessions(user_id, is_active, jwt_jti) VALUES($1, true, $2) RETURNING id',
      [u.id, crypto.randomUUID()]
    )).rows[0];
    tokens[role] = generateTokens(u, session.id, crypto.randomUUID());
  }

  const prefixCode = crypto.randomInt(1000, 9999);

  // Create linked employees
  // 1. ho_user -> HO Staff (Active)
  employees.ho = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, erp_user_id, created_by, updated_by)
    VALUES('HO Staff User', $1, 'HO Staff', 'Head Office', 'Active', $2, $3, $4, $4)
    RETURNING id
  `, [`HO-1-${prefixCode}`, date(1, 1), actors.ho, actors.admin])).rows[0].id;

  // 2. je_user -> Junior Engineer (Active) - demonstrates eligibility by linked employee, not ERP role alone!
  employees.projects = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, erp_user_id, created_by, updated_by)
    VALUES('Projects JE User', $1, 'Junior Engineer', 'Projects', 'Active', $2, $3, $4, $4)
    RETURNING id
  `, [`PRJ-1-${prefixCode}`, date(1, 1), actors.je, actors.admin])).rows[0].id;

  // 3. accounts_user -> HO Staff (Active) - second HO user for self-only boundary tests
  employees.accounts = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, erp_user_id, created_by, updated_by)
    VALUES('Accounts User', $1, 'HO Staff', 'Head Office', 'Active', $2, $3, $4, $4)
    RETURNING id
  `, [`HO-2-${prefixCode}`, date(1, 1), actors.accounts, actors.admin])).rows[0].id;

  // 4. zo_user -> HO Staff (Inactive)
  employees.inactive = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, erp_user_id, created_by, updated_by)
    VALUES('Inactive HO User', $1, 'HO Staff', 'Head Office', 'Inactive', $2, $3, $4, $4)
    RETURNING id
  `, [`HO-3-${prefixCode}`, date(1, 1), actors.zo, actors.admin])).rows[0].id;

  // 5. factory_user (JE role) -> SNP Casual Factory Labour (Active) - factory employee cannot use self-service leave
  employees.factory = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, erp_user_id, created_by, updated_by)
    VALUES('Factory Worker User', $1, 'SNP Casual Factory Labour', 'SNP Factory', 'Active', $2, $3, $4, $4)
    RETURNING id
  `, [`FAC-1-${prefixCode}`, date(1, 1), actors.factory_user, actors.admin])).rows[0].id;

  // 6. factory_manager_user -> Fabric Factory Permanent Employees (Active) - FM is eligible for self-service leave
  employees.factory_manager = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, erp_user_id, created_by, updated_by)
    VALUES('Factory Manager User', $1, 'Fabric Factory Permanent Employees', 'Fabric Factory', 'Active', $2, $3, $4, $4)
    RETURNING id
  `, [`FM-1-${prefixCode}`, date(1, 1), actors.factory_manager, actors.admin])).rows[0].id;

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
  if (db) await db.end();
});

describe('Phase 7 HO / Projects Self-Service Leave Workflow', () => {
  test('eligibility determined strictly by linked employee category & active status, not ERP role alone', async () => {
    // 1. Unlinked user (even with HO role) is not eligible
    const r1 = await request('GET', '/context', 'unlinked_user');
    expect(r1.status).toBe(200);
    expect(r1.body.eligible).toBe(false);
    expect(r1.body.employee).toBeNull();

    // 2. Inactive linked employee is not eligible
    const r2 = await request('GET', '/context', 'zo');
    expect(r2.status).toBe(200);
    expect(r2.body.eligible).toBe(false);

    // 3. Factory employee linked to user (even with JE role) is not eligible
    const r3 = await request('GET', '/context', 'factory_user');
    expect(r3.status).toBe(200);
    expect(r3.body.eligible).toBe(false);
    expect(r3.body.employee.employee_category).toBe('SNP Casual Factory Labour');

    // 4. Linked HO Staff employee is eligible
    const r4 = await request('GET', '/context', 'ho');
    expect(r4.status).toBe(200);
    expect(r4.body.eligible).toBe(true);
    expect(r4.body.employee.employee_category).toBe('HO Staff');

    // 5. Linked Projects employee with JE role is eligible!
    const r5 = await request('GET', '/context', 'je');
    expect(r5.status).toBe(200);
    expect(r5.body.eligible).toBe(true);
    expect(r5.body.employee.employee_category).toBe('Junior Engineer');

    // 6. Linked Factory Manager with permanent factory category is eligible!
    const r6 = await request('GET', '/context', 'factory_manager');
    expect(r6.status).toBe(200);
    expect(r6.body.eligible).toBe(true);
    expect(r6.body.employee.employee_category).toBe('Fabric Factory Permanent Employees');
  });

  test('non-eligible accounts receive HTTP 403 on self-service endpoints', async () => {
    const unlinkedReq = await request('POST', '/self-service', 'unlinked_user', {
      from_date: date(2, 1),
      to_date: date(2, 2),
      leave_type: 'Other Leave',
      reason: 'Should be denied'
    });
    expect(unlinkedReq.status).toBe(403);
    expect(unlinkedReq.body.code).toBe('LEAVE_ACCESS_DENIED');

    const factoryReq = await request('POST', '/self-service', 'factory_user', {
      from_date: date(2, 1),
      to_date: date(2, 2),
      leave_type: 'Medical Leave',
      reason: 'Factory employee cannot use self-service'
    });
    expect(factoryReq.status).toBe(403);
    expect(factoryReq.body.code).toBe('LEAVE_ACCESS_DENIED');
  });

  test('create own Pending self-service leave with strict validation', async () => {
    // 1. Invalid date range (from > to)
    const invDate = await request('POST', '/self-service', 'ho', {
      from_date: date(3, 10),
      to_date: date(3, 5),
      leave_type: 'Medical Leave',
      reason: 'Invalid range'
    });
    expect(invDate.status).toBe(400);

    // 2. Missing reason
    const noReason = await request('POST', '/self-service', 'ho', {
      from_date: date(3, 1),
      to_date: date(3, 2),
      leave_type: 'Medical Leave',
      reason: ''
    });
    expect(noReason.status).toBe(400);

    // 3. Valid creation
    const res = await request('POST', '/self-service', 'ho', {
      from_date: date(3, 1),
      to_date: date(3, 3),
      leave_type: 'Medical Leave',
      reason: 'Viral fever rest'
    });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.leave.approval_status).toBe('Pending');
    expect(res.body.leave.pay_treatment).toBe('Pending');
    expect(res.body.leave.request_source).toBe('SELF_SERVICE');
    expect(res.body.leave.employee_id).toBe(employees.ho);
  });

  test('self-only access: users only see and edit their own requests', async () => {
    // ho user lists requests
    const hoList = await request('GET', '/my-requests', 'ho');
    expect(hoList.status).toBe(200);
    expect(hoList.body.requests.length).toBeGreaterThan(0);
    const leaveId = hoList.body.requests[0].id;

    // accounts user lists requests, should see empty
    const accList = await request('GET', '/my-requests', 'accounts');
    expect(accList.status).toBe(200);
    expect(accList.body.requests.find(r => r.id === leaveId)).toBeUndefined();

    // accounts user tries to edit ho user's request -> 403
    const editOther = await request('PUT', `/self-service/${leaveId}`, 'accounts', {
      from_date: date(3, 1),
      to_date: date(3, 4),
      leave_type: 'Medical Leave',
      reason: 'Hijack attempt'
    });
    expect(editOther.status).toBe(403);
    expect(editOther.body.code).toBe('LEAVE_ACCESS_DENIED');

    // ho user edits their own pending request -> 200
    const editOwn = await request('PUT', `/self-service/${leaveId}`, 'ho', {
      from_date: date(3, 1),
      to_date: date(3, 4),
      leave_type: 'Medical Leave',
      reason: 'Doctor advised extra day rest'
    });
    expect(editOwn.status).toBe(200);
    expect(editOwn.body.leave.to_date).toBe(date(3, 4));
    expect(editOwn.body.leave.reason).toBe('Doctor advised extra day rest');
  });

  test('overlapping leave rejection across Pending and Approved states', async () => {
    // Attempting to create an overlapping request with the existing March 1 - March 4 leave
    const overlap = await request('POST', '/self-service', 'ho', {
      from_date: date(3, 3),
      to_date: date(3, 6),
      leave_type: 'Other Leave',
      reason: 'Overlapping request'
    });
    expect(overlap.status).toBe(409);
    expect(overlap.body.code).toMatch(/LEAVE_RANGE_CONFLICT|LEAVE_CONFLICT/);
  });

  test('Factory Manager can create, view, and update their own self-service leave', async () => {
    // 1. FM creates pending self-service leave
    const createRes = await request('POST', '/self-service', 'factory_manager', {
      from_date: date(4, 10),
      to_date: date(4, 12),
      leave_type: 'Other Leave',
      reason: 'Personal urgent factory break'
    });
    expect(createRes.status).toBe(200);
    expect(createRes.body.leave.request_source).toBe('SELF_SERVICE');
    expect(createRes.body.leave.employee_category).toBe('Fabric Factory Permanent Employees');
    const fmLeaveId = createRes.body.leave.id;

    // 2. FM views their requests
    const listRes = await request('GET', '/my-requests', 'factory_manager');
    expect(listRes.status).toBe(200);
    expect(listRes.body.requests.some(r => r.id === fmLeaveId)).toBe(true);

    // 3. FM updates pending request
    const updateRes = await request('PUT', `/self-service/${fmLeaveId}`, 'factory_manager', {
      from_date: date(4, 10),
      to_date: date(4, 13),
      leave_type: 'Other Leave',
      reason: 'Extended break'
    });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.leave.to_date).toBe(date(4, 13));

    // 4. HO can review FM leave in queue
    const hoQueue = await request('GET', `/review-queue?employee_category=Fabric+Factory+Permanent+Employees`, 'ho');
    expect(hoQueue.status).toBe(200);
    expect(hoQueue.body.requests.some(r => r.id === fmLeaveId)).toBe(true);
  });

  test('HO/Admin review queue access and role restrictions', async () => {
    // JE role cannot view review queue
    const jeQueue = await request('GET', '/review-queue', 'je');
    expect(jeQueue.status).toBe(403);

    // FM role cannot view review queue
    const fmQueue = await request('GET', '/review-queue', 'factory_manager');
    expect(fmQueue.status).toBe(403);

    // HO can view queue
    const hoQueue = await request('GET', '/review-queue?status=Pending', 'ho');
    expect(hoQueue.status).toBe(200);
    expect(hoQueue.body.requests.length).toBeGreaterThan(0);
    expect(hoQueue.body.pagination).toBeDefined();

    // Admin can view queue
    const adminQueue = await request('GET', '/review-queue', 'admin');
    expect(adminQueue.status).toBe(200);
  });

  test('HO/Admin rejection requires remarks and forces Unpaid treatment', async () => {
    // Projects employee creates a leave for April
    const createRes = await request('POST', '/self-service', 'je', {
      from_date: date(4, 10),
      to_date: date(4, 12),
      leave_type: 'Other Leave',
      reason: 'Personal work'
    });
    expect(createRes.status).toBe(200);
    const leaveId = createRes.body.leave.id;

    // 1. Rejection without remarks -> 400
    const noRemarks = await request('POST', `/${leaveId}/decision`, 'admin', {
      decision: 'Rejected',
      pay_treatment: 'Unpaid',
      remarks: ''
    });
    expect(noRemarks.status).toBe(400);

    // 2. Rejection with Paid treatment -> 400
    const paidRejection = await request('POST', `/${leaveId}/decision`, 'admin', {
      decision: 'Rejected',
      pay_treatment: 'Paid',
      remarks: 'Cannot reject and pay'
    });
    expect(paidRejection.status).toBe(400);

    // 3. Valid rejection
    const validReject = await request('POST', `/${leaveId}/decision`, 'admin', {
      decision: 'Rejected',
      pay_treatment: 'Unpaid',
      remarks: 'Critical project milestone underway; please reschedule.'
    });
    expect(validReject.status).toBe(200);
    expect(validReject.body.leave.approval_status).toBe('Rejected');
    expect(validReject.body.leave.pay_treatment).toBe('Unpaid');
    expect(validReject.body.leave.decision_remarks).toBe('Critical project milestone underway; please reschedule.');
  });

  test('HO/Admin approval with explicit Paid or Unpaid pay treatment', async () => {
    // 1. Approval with Paid treatment
    const l1 = await request('POST', '/self-service', 'je', {
      from_date: date(5, 1),
      to_date: date(5, 2),
      leave_type: 'Other Leave',
      reason: 'Urgent family task'
    });
    expect(l1.status).toBe(200);

    const appPaid = await request('POST', `/${l1.body.leave.id}/decision`, 'ho', {
      decision: 'Approved',
      pay_treatment: 'Paid',
      remarks: 'Approved as paid leave'
    });
    expect(appPaid.status).toBe(200);
    expect(appPaid.body.leave.approval_status).toBe('Approved');
    expect(appPaid.body.leave.pay_treatment).toBe('Paid');

    // 2. Approval with Unpaid treatment
    const l2 = await request('POST', '/self-service', 'je', {
      from_date: date(5, 10),
      to_date: date(5, 11),
      leave_type: 'Other Leave',
      reason: 'Personal travel'
    });
    expect(l2.status).toBe(200);

    const appUnpaid = await request('POST', `/${l2.body.leave.id}/decision`, 'ho', {
      decision: 'Approved',
      pay_treatment: 'Unpaid',
      remarks: 'Approved as unpaid leave'
    });
    expect(appUnpaid.status).toBe(200);
    expect(appUnpaid.body.leave.approval_status).toBe('Approved');
    expect(appUnpaid.body.leave.pay_treatment).toBe('Unpaid');
  });

  test('decided leave is immutable for both employee edit and re-decision', async () => {
    const listRes = await request('GET', '/my-requests', 'je');
    const decided = listRes.body.requests.find(r => r.approval_status !== 'Pending');
    expect(decided).toBeDefined();

    // Employee cannot update decided leave -> 409
    const editRes = await request('PUT', `/self-service/${decided.id}`, 'je', {
      from_date: decided.from_date,
      to_date: decided.to_date,
      leave_type: 'Other Leave',
      reason: 'Trying to update after decision'
    });
    expect(editRes.status).toBe(409);
    expect(editRes.body.code).toBe('LEAVE_CONFLICT');

    // HO cannot re-decide decided leave -> 409
    const redecide = await request('POST', `/${decided.id}/decision`, 'ho', {
      decision: 'Approved',
      pay_treatment: 'Paid',
      remarks: 'Trying to re-approve'
    });
    expect(redecide.status).toBe(409);
    expect(redecide.body.code).toBe('LEAVE_CONFLICT');
  });

  test('boundary isolation: factory leave cannot be decided via self-service route', async () => {
    // Create a factory leave directly in db
    const facLeave = (await db.query(`
      INSERT INTO hr_leave_requests(employee_id, employee_category, request_source, from_date, to_date, leave_type, reason, pay_treatment, created_by, updated_by)
      VALUES($1, 'SNP Casual Factory Labour', 'FACTORY_MANAGER', $2, $2, 'Medical Leave', 'Factory worker leave', 'Pending', $3, $3)
      RETURNING id
    `, [employees.factory, date(6, 1), actors.factory_manager])).rows[0];

    const crossDecide = await request('POST', `/${facLeave.id}/decision`, 'ho', {
      decision: 'Approved',
      pay_treatment: 'Paid',
      remarks: 'Attempt cross decision'
    });
    expect(crossDecide.status).toBe(400);
    expect(crossDecide.body.code).toBe('INVALID_LEAVE');
  });
});

test('FM self-service leave survives attendance population, HO decision, correction and lock', async () => {
  const category = 'Fabric Factory Permanent Employees'; const day = date(5, 10);
  await db.query(`INSERT INTO hr_factory_pay_rule_revisions(employee_category,effective_from,standard_duty_hours,ot_enabled,ot_method,ot_rate,
    holiday_pay_enabled,holiday_multiplier,management_stoppage_treatment,created_by)
    VALUES($1,$2,8,true,'Fixed Hourly',50,true,1.5,'No deduction',$3)`, [category, date(5,1), actors.admin]);
  const leave = await request('POST', '/self-service', 'factory_manager', { from_date: day, to_date: day, leave_type: 'Other Leave', reason: 'Lifecycle test' });
  expect(leave.status).toBe(200);
  const sheet = (await db.query('SELECT * FROM populate_hr_attendance_sheet($1,$2,$3)', [day, category, actors.factory_manager])).rows[0];
  const rows = (await db.query('SELECT * FROM hr_attendance_rows WHERE sheet_id=$1', [sheet.id])).rows;
  const own = rows.find(r => r.employee_id === employees.factory_manager);
  expect(own.leave_request_id).toBe(leave.body.leave.id);
  expect(own.attendance_status).toBe('Unpaid Leave');
  const blank = rows.filter(r => !r.attendance_status);
  if (blank.length) await db.query('SELECT save_hr_attendance_rows($1,$2,$3)', [sheet.id, JSON.stringify(blank.map(r => ({ employee_id:r.employee_id,attendance_status:'Absent' }))), actors.factory_manager]);
  await db.query("SELECT transition_hr_attendance_sheet($1,'submit',null,$2)", [sheet.id,actors.factory_manager]);
  expect((await request('GET', '/review-queue','factory_manager')).status).toBe(403);
  expect((await request('POST', `/${leave.body.leave.id}/decision`, 'factory_manager', { decision:'Approved', pay_treatment:'Paid' })).status).toBe(403);
  await db.query("SELECT decide_hr_factory_sheet_leave($1,$2,'Approved','Paid',null,$3)", [sheet.id,leave.body.leave.id,actors.ho]);
  expect((await db.query('SELECT status FROM hr_attendance_sheets WHERE id=$1',[sheet.id])).rows[0].status).toBe('Returned for Correction');
  await db.query('SELECT save_hr_attendance_rows($1,$2,$3)', [sheet.id,JSON.stringify([{employee_id:employees.factory_manager,attendance_status:'Paid Leave',leave_request_id:leave.body.leave.id}]),actors.factory_manager]);
  await db.query("SELECT transition_hr_attendance_sheet($1,'submit',null,$2)", [sheet.id,actors.factory_manager]);
  await db.query("SELECT transition_hr_attendance_sheet($1,'review',null,$2)", [sheet.id,actors.ho]);
  expect((await db.query('SELECT status FROM hr_attendance_sheets WHERE id=$1',[sheet.id])).rows[0].status).toBe('Locked');
  const historyResponse = await fetch(`${base}/api/v1/auth/hr/attendance/sheets/${sheet.id}/history?limit=100`, {
    headers: { Cookie: `accessToken=${tokens.factory_manager.accessToken}` }
  });
  expect(historyResponse.status).toBe(200);
  const history = await historyResponse.json();
  expect(history.history.some(event => event.record_identifier === leave.body.leave.id && event.action === 'LEAVE_APPROVED')).toBe(true);

});
