import { describe, test, expect, beforeAll, afterAll } from 'vitest';
const { Client } = require('pg');
const crypto = require('crypto');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const { generateTokens } = require('../../../src/services/session.service');
const app = require('../../../src/app');

const prefix = '/api/v1/auth/hr/attendance';
let db, server, base, year;
const actors = {};
const tokens = {};
const employees = {};
const extraEmployees = [];

const casual = 'SNP Casual Factory Labour';
const date = (month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
const stamp = (month, day, time) => `${date(month, day)}T${time}:00+05:30`;

async function request(method, path, role = 'factory_manager', body) {
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
    SELECT y FROM generate_series(2401, 2600) y
    WHERE NOT EXISTS(SELECT 1 FROM hr_attendance_sheets WHERE extract(year FROM attendance_date) = y)
      AND NOT EXISTS(SELECT 1 FROM hr_factory_pay_rule_revisions WHERE extract(year FROM effective_from) = y)
    ORDER BY y LIMIT 1
  `)).rows[0].y);

  for (const role of ['admin', 'factory_manager', 'ho', 'je', 'zo', 'accounts']) {
    const u = (await db.query(
      'INSERT INTO authorised_users(mobile_number, role, display_name, is_active) VALUES($1, $2, $3, true) RETURNING *',
      [String(crypto.randomInt(7000000000, 9999999999)), role, `Calendar ${role}`]
    )).rows[0];
    actors[role] = u.id;
    const session = (await db.query(
      'INSERT INTO sessions(user_id, is_active, jwt_jti) VALUES($1, true, $2) RETURNING id',
      [u.id, crypto.randomUUID()]
    )).rows[0];
    tokens[role] = generateTokens(u, session.id, crypto.randomUUID());
  }

  const prefixCode = crypto.randomInt(1000, 9999);
  // Create active employees
  employees.active1 = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, created_by, updated_by)
    VALUES('Active Worker One', $1, $2, 'SNP Factory', 'Active', $3, $4, $4)
    RETURNING id
  `, [`CAL-1-${prefixCode}`, casual, date(1, 1), actors.admin])).rows[0].id;

  employees.active2 = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, created_by, updated_by)
    VALUES('Active Worker Two', $1, $2, 'SNP Factory', 'Active', $3, $4, $4)
    RETURNING id
  `, [`CAL-2-${prefixCode}`, casual, date(1, 1), actors.admin])).rows[0].id;

  employees.historical = (await db.query(`
    INSERT INTO hr_employees(employee_name, employee_code, employee_category, department, active_status, joining_date, created_by, updated_by)
    VALUES('Historical Worker Resigned', $1, $2, 'SNP Factory', 'Active', $3, $4, $4)
    RETURNING id
  `, [`CAL-9-${prefixCode}`, casual, date(1, 1), actors.admin])).rows[0].id;

  // Add pay rule revision and wage revision
  await db.query(`
    INSERT INTO hr_factory_pay_rule_revisions(employee_category, effective_from, standard_duty_hours, ot_enabled, ot_method, ot_rate, ot_multiplier,
      holiday_pay_enabled, holiday_multiplier, management_stoppage_treatment, double_duty_multiplier, created_by)
    VALUES($1, $2, 8, true, 'Fixed Hourly', 50, NULL, true, 1.5, 'Recorded policy', NULL, $3)
  `, [casual, date(1, 1), actors.admin]);

  await db.query(`
    INSERT INTO hr_factory_wage_revisions(employee_category, effective_from, daily_wage, created_by)
    VALUES($1, $2, 400, $3)
  `, [casual, date(1, 1), actors.admin]);

  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;

  // Day 1: Create, fill, submit, review and lock
  const s1Res = await request('POST', '/sheets', 'factory_manager', { date: date(1, 1), employee_category: casual });
  expect(s1Res.status).toBe(200);
  const s1Id = s1Res.body.sheet.id;

  const d1 = await request('GET', `/sheets/${s1Id}`, 'factory_manager');
  const d1Rows = d1.body.rows.map(r => {
    if (r.employee_id === employees.active1) {
      return { employee_id: r.employee_id, attendance_status: 'Present', entry_timestamp: stamp(1, 1, '09:00'), exit_timestamp: stamp(1, 1, '17:30'), duty_type: null, remarks: 'Normal shift' };
    }
    if (r.employee_id === employees.active2) {
      return { employee_id: r.employee_id, attendance_status: 'Absent', remarks: 'Informed absence' };
    }
    if (r.employee_id === employees.historical) {
      return { employee_id: r.employee_id, attendance_status: 'Compensatory Off', remarks: 'Comp off approved' };
    }
    return { employee_id: r.employee_id, attendance_status: 'Present', entry_timestamp: stamp(1, 1, '09:00'), exit_timestamp: stamp(1, 1, '17:00'), duty_type: null };
  });
  const save1 = await request('PUT', `/sheets/${s1Id}/rows`, 'factory_manager', { rows: d1Rows });
  if (save1.status !== 200) console.error('SAVE1 ERROR:', JSON.stringify(save1.body)); expect(save1.status).toBe(200);
  const sub1 = await request('POST', `/sheets/${s1Id}/submit`, 'factory_manager', {});
  expect(sub1.status).toBe(200);
  const rev1 = await request('POST', `/sheets/${s1Id}/review`, 'ho', { remarks: 'Day 1 reviewed and locked' });
  expect(rev1.status).toBe(200);

  // Day 2: Create, record Medical Leave for active1, fill, submit, decide leave, review and lock
  const s2Res = await request('POST', '/sheets', 'factory_manager', { date: date(1, 2), employee_category: casual });
  expect(s2Res.status).toBe(200);
  const s2Id = s2Res.body.sheet.id;

  const leaveRes = await request('POST', `/sheets/${s2Id}/leave`, 'factory_manager', {
    employee_id: employees.active1,
    leave_id: null,
    from_date: date(1, 2),
    to_date: date(1, 2),
    leave_type: 'Medical Leave',
    reason: 'Medical recovery',
    pay_treatment: 'Pending'
  });
  expect(leaveRes.status).toBe(200);
  const leaveId = leaveRes.body.leave.id;

  const d2 = await request('GET', `/sheets/${s2Id}`, 'factory_manager');
  const d2Rows = d2.body.rows.map(r => {
    if (r.employee_id === employees.active1) {
      return { employee_id: r.employee_id, attendance_status: 'Medical Leave', leave_request_id: leaveId, remarks: 'Medical certificate submitted' };
    }
    if (r.employee_id === employees.active2) {
      return { employee_id: r.employee_id, attendance_status: 'Management Issue', remarks: 'Power plant outage' };
    }
    return { employee_id: r.employee_id, attendance_status: 'Present', entry_timestamp: stamp(1, 2, '09:00'), exit_timestamp: stamp(1, 2, '17:00'), duty_type: null };
  });
  const save2 = await request('PUT', `/sheets/${s2Id}/rows`, 'factory_manager', { rows: d2Rows });
  expect(save2.status).toBe(200);
  const sub2 = await request('POST', `/sheets/${s2Id}/submit`, 'factory_manager', {});
  expect(sub2.status).toBe(200);

  const decRes = await request('POST', `/sheets/${s2Id}/leaves/${leaveId}/decision`, 'ho', {
    decision: 'Approved',
    pay_treatment: 'Paid',
    remarks: 'Approved medical leave'
  });
  expect(decRes.status).toBe(200);

  const rev2 = await request('POST', `/sheets/${s2Id}/review`, 'ho', { remarks: 'Day 2 reviewed and locked' });
  expect(rev2.status).toBe(200);

  // Day 3: Draft sheet (remains Draft)
  const s3Res = await request('POST', '/sheets', 'factory_manager', { date: date(1, 3), employee_category: casual });
  expect(s3Res.status).toBe(200);

  // Day 4: Submitted sheet (remains Submitted)
  const s4Res = await request('POST', '/sheets', 'factory_manager', { date: date(1, 4), employee_category: casual });
  expect(s4Res.status).toBe(200);
  const s4Id = s4Res.body.sheet.id;
  const d4 = await request('GET', `/sheets/${s4Id}`, 'factory_manager');
  const d4Rows = d4.body.rows.map(r => ({
    employee_id: r.employee_id, attendance_status: 'Present', entry_timestamp: stamp(1, 4, '09:00'), exit_timestamp: stamp(1, 4, '17:00'), duty_type: null
  }));
  const save4 = await request('PUT', `/sheets/${s4Id}/rows`, 'factory_manager', { rows: d4Rows });
  expect(save4.status).toBe(200);
  const sub4 = await request('POST', `/sheets/${s4Id}/submit`, 'factory_manager', {});
  expect(sub4.status).toBe(200);

  const s5 = await request('POST','/sheets','factory_manager',{date:date(1,5),employee_category:casual});
  const d5 = await request('GET',`/sheets/${s5.body.sheet.id}`);
  expect((await request('PUT',`/sheets/${s5.body.sheet.id}/rows`,'factory_manager',{rows:d5.body.rows.map(r=>({employee_id:r.employee_id,attendance_status:'Absent'}))})).status).toBe(200);
  expect((await request('POST',`/sheets/${s5.body.sheet.id}/submit`,'factory_manager',{})).status).toBe(200);
  expect((await request('POST',`/sheets/${s5.body.sheet.id}/return`,'ho',{remarks:'Correct attendance facts'})).status).toBe(200);

  // Update historical employee to Inactive
  await db.query("UPDATE hr_employees SET active_status = 'Inactive' WHERE id = $1", [employees.historical]);
});

afterAll(async () => {
  if (server) await new Promise(r => server.close(r));
  if (db) {
    await db.query("UPDATE hr_employees SET active_status='Inactive',updated_by=$1 WHERE id=ANY($2::uuid[])",[actors.admin,[...Object.values(employees),...extraEmployees]]);
    await db.query('UPDATE authorised_users SET is_active=false WHERE id=ANY($1::uuid[])',[Object.values(actors)]);
    await db.end();
  }
});

describe('Phase 7 Monthly Attendance Calendar Read API', () => {
  test('role-based access: Admin, HO, and FM permitted; JE, ZO, Accounts denied', async () => {
    const month = `${year}-01`;
    const q = `?employee_category=${encodeURIComponent(casual)}&month=${month}`;

    const rFm = await request('GET', `/calendar${q}`, 'factory_manager');
    expect(rFm.status).toBe(200);

    const rHo = await request('GET', `/calendar${q}`, 'ho');
    expect(rHo.status).toBe(200);

    const rAdmin = await request('GET', `/calendar${q}`, 'admin');
    expect(rAdmin.status).toBe(200);

    const rJe = await request('GET', `/calendar${q}`, 'je');
    expect(rJe.status).toBe(403);

    const rZo = await request('GET', `/calendar${q}`, 'zo');
    expect(rZo.status).toBe(403);

    const rAcct = await request('GET', `/calendar${q}`, 'accounts');
    expect(rAcct.status).toBe(403);
  });

  test('strict query validation on category and month format', async () => {
    // 1. Invalid month format
    const r1 = await request('GET', `/calendar?employee_category=${encodeURIComponent(casual)}&month=2026/01`, 'ho');
    expect(r1.status).toBe(400);

    // 2. Non-factory category
    const r2 = await request('GET', `/calendar?employee_category=HO+Staff&month=${year}-01`, 'ho');
    expect(r2.status).toBe(400);
  });

  test('calendar includes editable, submitted, returned and finalized sheets with their stored states', async () => {
    const month = `${year}-01`;
    const q = `?employee_category=${encodeURIComponent(casual)}&month=${month}`;
    const res = await request('GET', `/calendar${q}`, 'factory_manager');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.month).toBe(month);
    expect(res.body.days_in_month).toBe(31);

    expect(res.body.sheets.map(s => [s.attendance_date, s.status])).toEqual([
      [date(1, 1), 'Locked'], [date(1, 2), 'Locked'], [date(1, 3), 'Draft'],
      [date(1, 4), 'Submitted'], [date(1, 5), 'Returned for Correction']
    ]);

    // Verify code mapping on finalized days
    // Day 1: active1 is Present -> code 'P'
    const rP = res.body.records.find(r => r.employee_id === employees.active1 && r.date === date(1, 1));
    expect(rP).toBeDefined();
    expect(rP.code).toBe('P');
    expect(rP.attendance_status).toBe('Present');
    expect(rP.actual_hours).toBe(8.5);
    expect(rP.ot_hours).toBe(0.5);
    expect(rP.remarks).toBe('Normal shift');

    // Day 1: active2 is Absent -> code 'A'
    const rA = res.body.records.find(r => r.employee_id === employees.active2 && r.date === date(1, 1));
    expect(rA).toBeDefined();
    expect(rA.code).toBe('A');
    expect(rA.attendance_status).toBe('Absent');

    // Day 1: historical is Compensatory Off -> code 'CO'
    const rCO = res.body.records.find(r => r.employee_id === employees.historical && r.date === date(1, 1));
    expect(rCO).toBeDefined();
    expect(rCO.code).toBe('CO');
    expect(rCO.attendance_status).toBe('Compensatory Off');

    // Day 2: active1 is Medical Leave -> code 'ML'
    const rML = res.body.records.find(r => r.employee_id === employees.active1 && r.date === date(1, 2));
    expect(rML).toBeDefined();
    expect(rML.code).toBe('ML');

    // Day 2: active2 is Management Issue -> code 'MI'
    const rMI = res.body.records.find(r => r.employee_id === employees.active2 && r.date === date(1, 2));
    expect(rMI).toBeDefined();
    expect(rMI.code).toBe('MI');

    const draft = res.body.records.find(r => r.employee_id === employees.active1 && r.date === date(1, 3));
    expect(draft.sheet_status).toBe('Draft');
    expect(draft.code).toBe('-');
    expect(draft.attendance_status).not.toBe('Present');
    expect(res.body.records.find(r => r.date === date(1, 4)).sheet_status).toBe('Submitted');
    expect(res.body.records.find(r => r.date === date(1, 5)).sheet_status).toBe('Returned for Correction');
  });

  test('historical employees with attendance facts in the month are preserved and resolved', async () => {
    const month = `${year}-01`;
    const q = `?employee_category=${encodeURIComponent(casual)}&month=${month}`;
    const res = await request('GET', `/calendar${q}`, 'ho');

    expect(res.status).toBe(200);
    const empHistorical = res.body.employees.find(e => e.id === employees.historical);
    expect(empHistorical).toBeDefined();
    expect(empHistorical.employee_name).toBe('Historical Worker Resigned');
    expect(empHistorical.active_status).toBe('Inactive');
  });

  test('optional employee_id query filters records specifically for single employee view', async () => {
    const month = `${year}-01`;
    const q = `?employee_category=${encodeURIComponent(casual)}&month=${month}&employee_id=${employees.active1}`;
    const res = await request('GET', `/calendar${q}`, 'factory_manager');

    expect(res.status).toBe(200);
    expect(res.body.records.length).toBe(5); // All stored sheet states
    for (const rec of res.body.records) {
      expect(rec.employee_id).toBe(employees.active1);
    }
  });

  test('future joiners excluded from past months while historical employees with attendance remain included', async () => {
    // 1. Insert an employee who joins on Feb 1
    const futureRes = await db.query(
      `INSERT INTO hr_employees (employee_name, employee_category, department, active_status, joining_date, created_by, updated_by)
       VALUES ('Future Joiner Feb', $1, 'SNP Factory', 'Active', $2, $3, $3) RETURNING id`,
      [casual, date(2, 1), actors.admin]
    );
    const futureId = futureRes.rows[0].id;
    extraEmployees.push(futureId);

    // 2. Query month 1 (January): future joiner should NOT appear
    const rMonth1 = await request('GET', `/calendar?employee_category=${encodeURIComponent(casual)}&month=${year}-01`, 'ho');
    expect(rMonth1.status).toBe(200);
    const inMonth1 = rMonth1.body.employees.find(e => e.id === futureId);
    expect(inMonth1).toBeUndefined();

    // Historical employee with attendance in month 1 IS included (even though Inactive)
    const histInMonth1 = rMonth1.body.employees.find(e => e.id === employees.historical);
    expect(histInMonth1).toBeDefined();
    expect(histInMonth1.active_status).toBe('Inactive');

    // 3. Query month 2 (February): future joiner IS included
    const rMonth2 = await request('GET', `/calendar?employee_category=${encodeURIComponent(casual)}&month=${year}-02`, 'ho');
    expect(rMonth2.status).toBe(200);
    const inMonth2 = rMonth2.body.employees.find(e => e.id === futureId);
    expect(inMonth2).toBeDefined();
    expect(inMonth2.employee_name).toBe('Future Joiner Feb');
  });
});

 test('calendar returns every row beyond the PostgREST 1000-row response cap', async () => {
   const inserted=await db.query(`INSERT INTO hr_employees(employee_name,employee_category,department,active_status,joining_date,created_by,updated_by)
     SELECT 'Calendar pagination worker '||n,$1,'SNP Factory','Active',$2,$3,$3 FROM generate_series(1,65) n RETURNING id`,[casual,date(1,1),actors.admin]);
   extraEmployees.push(...inserted.rows.map(e=>e.id));
   for(let day=1;day<=16;day++) expect((await request('POST','/sheets','factory_manager',{date:date(2,day),employee_category:casual})).status).toBe(200);

   // Mark all rows Absent so the sheets can be validly submitted and locked
   await db.query(
     `UPDATE hr_attendance_rows SET attendance_status = 'Absent', updated_by = $1
      WHERE sheet_id IN (SELECT id FROM hr_attendance_sheets WHERE employee_category = $2 AND attendance_date BETWEEN $3 AND $4)`,
     [actors.admin, casual, date(2, 1), date(2, 28)]
   );

   // Transition month 2 sheets to Locked so they appear in calendar
   const sRows = await db.query(
     `SELECT id FROM hr_attendance_sheets WHERE employee_category = $1 AND attendance_date BETWEEN $2 AND $3`,
     [casual, date(2, 1), date(2, 28)]
   );
   for (const s of sRows.rows) {
     await db.query(`SELECT transition_hr_attendance_sheet($1, 'submit', null, $2)`, [s.id, actors.factory_manager]);
     await db.query(`SELECT transition_hr_attendance_sheet($1, 'review', 'Lock for pagination test', $2)`, [s.id, actors.ho]);
   }

   const expected=Number((await db.query(`SELECT count(*) FROM hr_attendance_rows r JOIN hr_attendance_sheets s ON s.id=r.sheet_id
      WHERE s.employee_category=$1 AND s.attendance_date BETWEEN $2 AND $3 AND s.status='Locked'`,[casual,date(2,1),date(2,28)])).rows[0].count);
   expect(expected).toBeGreaterThan(1000);
   const res=await request('GET',`/calendar?employee_category=${encodeURIComponent(casual)}&month=${year}-02`);
   expect(res.status).toBe(200);expect(res.body.records).toHaveLength(expected);
   expect(new Set(res.body.records.map(r=>r.id)).size).toBe(expected);
 });
