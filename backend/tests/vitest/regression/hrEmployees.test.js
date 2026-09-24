import { describe, test, expect, beforeAll } from 'vitest';
const crypto = require('crypto');
const { supabase } = require('../../../src/db/supabase');
const { requireLocalSupabase } = require('../../helpers/requireLocalSupabase');
const mockRes = require('../../helpers/mockRes');
const requireRole = require('../../../src/middleware/requireRole');
const { requireCurrentAdmin } = require('../../../src/routes/hrEmployees.routes');
const controller = require('../../../src/controllers/hrEmployees.controller');
const { removeUser } = require('../../../src/controllers/admin.controller');

describe('HR employee master', () => {
  let admin;
  let account;
  const suffix = crypto.randomUUID().slice(0, 8);
  const base = {
    employee_category: 'SNP Permanent Factory Labour', department: 'SNP Factory',
    joining_date: '2026-01-01', active_status: 'Active'
  };

  beforeAll(async () => {
    await requireLocalSupabase();
    const { data, error } = await supabase.from('authorised_users').insert([
      { mobile_number: `8711${suffix}`, role: 'admin', display_name: 'HR test admin' },
      { mobile_number: `8712${suffix}`, role: 'je', display_name: 'HR test JE' }
    ]).select('id,role,mobile_number');
    if (error) throw error;
    admin = data.find(u => u.role === 'admin');
    account = data.find(u => u.role === 'je');
  });

  test('role gate rejects non-admin', () => {
    const res = mockRes();
    let passed = false;
    requireRole(['admin'])({ user: account }, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('live role check rejects a token with a stale Admin role', async () => {
    const res = mockRes();
    let passed = false;
    await requireCurrentAdmin({ user: { id: account.id, role: 'admin' } }, res, () => { passed = true; });
    expect(passed).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  test('creates independent and linked employees, enforces one link, searches and deactivates', async () => {
    const unlinked = mockRes();
    await controller.createEmployee({ user: admin, body: { ...base, employee_name: `Unlinked ${suffix}` } }, unlinked);
    expect(unlinked.statusCode).toBe(201);
    expect(unlinked.jsonData.employee.erp_user_id).toBeNull();

    const linked = mockRes();
    await controller.createEmployee({ user: admin, body: { ...base, employee_name: `Linked ${suffix}`, erp_user_id: account.id } }, linked);
    expect(linked.statusCode).toBe(201);
    expect(linked.jsonData.employee.employee_code).not.toBe(unlinked.jsonData.employee.employee_code);

    const duplicate = mockRes();
    await controller.createEmployee({ user: admin, body: { ...base, employee_name: `Duplicate ${suffix}`, erp_user_id: account.id } }, duplicate);
    expect(duplicate.statusCode).toBe(409);

    const list = mockRes();
    await controller.listEmployees({ query: { page: 1, limit: 20, search: `Linked ${suffix}` } }, list);
    expect(list.jsonData.employees.some(e => e.id === linked.jsonData.employee.id)).toBe(true);
    expect(Object.keys(list.jsonData.employees[0])).not.toContain('salary');
    expect(Object.keys(list.jsonData.employees[0])).not.toContain('epf_enrolment');

    const updated = mockRes();
    await controller.changeStatus({ user: admin, params: { id: linked.jsonData.employee.id }, body: { active_status: 'Inactive' } }, updated);
    expect(updated.jsonData.employee.active_status).toBe('Inactive');
    const viewed = mockRes();
    await controller.getEmployee({ params: { id: linked.jsonData.employee.id } }, viewed);
    expect(viewed.jsonData.employee.active_status).toBe('Inactive');
  });

  test('accepts every agreed category and rejects an unknown ERP account', async () => {
    const categories = [
      'HO Staff', 'Fabric Factory Permanent Employees', 'SNP Casual Factory Labour',
      'SNP Permanent Factory Labour', 'Projects Department Employees', 'Local Daily-Wage Workers'
    ];
    const responses = await Promise.all(categories.map(async (employee_category, index) => {
      const res = mockRes();
      await controller.createEmployee({ user: admin, body: {
        ...base, employee_category, employee_name: `Category ${suffix} ${index}`
      } }, res);
      return res;
    }));
    expect(responses.every(r => r.statusCode === 201)).toBe(true);
    expect(new Set(responses.map(r => r.jsonData.employee.employee_code)).size).toBe(6);

    const invalid = mockRes();
    await controller.createEmployee({ user: admin, body: {
      ...base, employee_name: `Invalid account ${suffix}`, erp_user_id: crypto.randomUUID()
    } }, invalid);
    expect(invalid.statusCode).toBe(400);
  });

  test('ERP user lookup paginates and filters by role', async () => {
    const first = mockRes();
    await controller.listErpUsers({ query: { role: 'admin', page: 1, limit: 1, search: '' } }, first);
    expect(first.statusCode).toBe(200);
    expect(first.jsonData.users).toHaveLength(1);
    expect(first.jsonData.users[0].role).toBe('admin');
    expect(first.jsonData.pagination.limit).toBe(1);
    expect(first.jsonData.pagination.totalItems).toBeGreaterThanOrEqual(1);

    const later = mockRes();
    await controller.listErpUsers({ query: { page: 2, limit: 1, search: '' } }, later);
    expect(later.statusCode).toBe(200);
    expect(later.jsonData.pagination.page).toBe(2);
    expect(later.jsonData.pagination.totalItems).toBeGreaterThanOrEqual(2);
    expect(later.jsonData.users).toHaveLength(1);
  });

  test('linked ERP user deletion is rejected before session invalidation', async () => {
    const mobile = `8713${suffix}`;
    const { data: linkedUser, error: userError } = await supabase.from('authorised_users')
      .insert({ mobile_number: mobile, role: 'je', display_name: `HR linked ${suffix}` })
      .select('id').single();
    if (userError) throw userError;
    const employee = mockRes();
    await controller.createEmployee({ user: admin, body: {
      ...base, employee_name: `Deletion guard ${suffix}`, erp_user_id: linkedUser.id
    } }, employee);
    expect(employee.statusCode).toBe(201);

    const { data: session, error: sessionError } = await supabase.from('sessions')
      .insert({ user_id: linkedUser.id, is_active: true }).select('id').single();
    if (sessionError) throw sessionError;

    const response = mockRes();
    await removeUser({ params: { id: linkedUser.id } }, response);
    expect(response.statusCode).toBe(409);
    expect(response.jsonData.message).toContain('linked to an employee');

    const { data: retainedSession, error: readError } = await supabase.from('sessions')
      .select('is_active').eq('id', session.id).single();
    if (readError) throw readError;
    expect(retainedSession.is_active).toBe(true);
  });
});
