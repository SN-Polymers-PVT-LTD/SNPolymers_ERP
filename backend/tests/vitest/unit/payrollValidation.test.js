import { describe, test, expect } from 'vitest';
const crypto = require('crypto');
const schema = require('../../../src/validation/payroll.schema');
const mockRes = require('../../helpers/mockRes');
const { sendError } = require('../../../src/controllers/payroll.controller');
const uuid = crypto.randomUUID();
const draft = { group_code: 'HO_STAFF', department: 'Head Office', period_from: '2026-10-01', period_to: '2026-10-31', cycle: 'Monthly' };
describe('payroll foundation input contract', () => {
  test('validates real business dates, ordered ranges, bounded pagination and strict payloads', () => {
    expect(schema.createRun.body.safeParse(draft).success).toBe(true);
    for (const extra of [{ period_from: '2026-02-30' }, { period_to: '2026-09-30' }, { status: 'LOCKED' }, { created_by: uuid }, { net_salary: 1000 }, { epf_amount: 100 }, { esi_rate: 0.75 }]) {
      expect(schema.createRun.body.safeParse({ ...draft, ...extra }).success).toBe(false);
    }
    expect(schema.detail.query.safeParse({ page: 100001 }).success).toBe(false);
    expect(schema.detail.query.parse({})).toEqual({ page: 1, limit: 20 });
  });
  test('pay applicability requires explicit finite dates and rejects statutory/rate overrides', () => {
    const valid = { employee_id: uuid, kind: 'PERMANENT_PAY', evidence_reference: 'Approved source', intervals: [{ pay_structure_id: uuid, effective_from: '2026-10-01', effective_to: '2026-10-31' }] };
    expect(schema.history.body.safeParse(valid).success).toBe(true);
    for (const interval of [{ pay_structure_id: uuid }, { ...valid.intervals[0], effective_from: '2026-11-01' }, { ...valid.intervals[0], epf_amount: 100 }, { ...valid.intervals[0], guaranteed_monthly_gross: 99999 }]) {
      expect(schema.history.body.safeParse({ ...valid, intervals: [interval] }).success).toBe(false);
    }
    expect(schema.history.body.safeParse({ ...valid, actor_id: uuid }).success).toBe(false);
  });
  test('employment exit/join evidence bounds assignments and version inputs reject money', () => {
    const interval = { group_code: 'PROJECTS_JE', employee_category: 'Junior Engineer', department: 'Projects', effective_from: '2026-10-01', effective_to: '2026-10-31', employment_joined_on: '2026-01-01' };
    const body = { employee_id: uuid, kind: 'ASSIGNMENT', evidence_reference: 'Admin assignment evidence', intervals: [interval] };
    expect(schema.history.body.safeParse(body).success).toBe(true);
    for (const extra of [{ employment_joined_on: '2026-10-02' }, { employment_exited_on: '2026-10-15' }, { department: 'Unknown factory' }]) {
      expect(schema.history.body.safeParse({ ...body, intervals: [{ ...interval, ...extra }] }).success).toBe(false);
    }
    expect(schema.reviseNote.body.safeParse({ expected_version: 1, note: 'Source check' }).success).toBe(true);
    expect(schema.reviseNote.body.safeParse({ expected_version: 1, note: '', net_salary: 1 }).success).toBe(false);
    expect(schema.reviseNote.body.safeParse({ expected_version: 0, note: '' }).success).toBe(false);
  });
  test('expected database errors map to stable 4xx status codes', () => {
    for (const [code, status] of [['42501', 403], ['P0002', 404], ['23505', 409], ['23P01', 409], ['40001', 409], ['PY409', 409], ['23514', 400], ['23503', 400], ['23502', 400]]) {
      const res = mockRes(); sendError(res, { code, message: 'Expected failure' }); expect(res.statusCode).toBe(status);
    }
  });
});
