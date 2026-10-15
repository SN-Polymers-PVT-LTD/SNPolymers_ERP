const { z } = require('zod');
const { categories } = require('../domain/hrEmployeeCategories');
const date = z.iso.date();
const reason = z.string().trim().min(1).max(2000);
const departments = z.enum(['Head Office', 'Projects', 'SNP Factory', 'Fabric Factory']);
const range = v => v.effective_to === null || v.effective_from <= v.effective_to;
const assignment = z.object({
  group_code: z.string().min(1).max(40), employee_category: z.enum(categories), department: departments,
  effective_from: date, effective_to: date.nullable(), employment_joined_on: date,
  employment_exited_on: date.nullable().optional()
}).strict().refine(range, 'Invalid effective date range.').refine(v => v.effective_from >= v.employment_joined_on &&
  (!v.employment_exited_on || (v.effective_to !== null && v.effective_to <= v.employment_exited_on)), 'Assignment must be within evidenced employment dates.');
const pay = z.object({ pay_structure_id: z.uuid(), effective_from: date, effective_to: date.nullable() }).strict().refine(range, 'Invalid effective date range.');
const historyBase = { employee_id: z.uuid(), evidence_reference: reason };
const pagination = z.object({ page: z.coerce.number().int().min(1).max(100000).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict();
module.exports = {
  listRuns: { query: pagination },
  preview: { params: z.object({ rowId: z.uuid() }).strict(), body: z.object({ expected_source_fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict() },
  history: { body: z.discriminatedUnion('kind', [
    z.object({ ...historyBase, kind: z.literal('ASSIGNMENT'), intervals: z.array(assignment).min(1).max(1000) }).strict(),
    z.object({ ...historyBase, kind: z.literal('PERMANENT_PAY'), intervals: z.array(pay).min(1).max(1000) }).strict()
  ]) },
  employeeHistory: { params: z.object({ employeeId: z.uuid() }).strict() },
  createRun: { body: z.object({ group_code: z.string().min(1).max(40), department: departments,
    period_from: date, period_to: date, cycle: z.enum(['Monthly', 'Fortnightly', 'Weekly', 'Custom'])
  }).strict().refine(v => v.period_from <= v.period_to, 'Invalid payroll period.') },
  detail: { params: z.object({ runId: z.uuid() }).strict(), query: pagination },
  addEmployee: { params: z.object({ runId: z.uuid() }).strict(), body: z.object({ assignment_id: z.uuid(), period_from: date, period_to: date }).strict().refine(v => v.period_from <= v.period_to, 'Invalid payroll period.') },
  reviseNote: { params: z.object({ rowId: z.uuid() }).strict(), body: z.object({ expected_version: z.number().int().positive(), note: z.string().trim().max(2000) }).strict() }
};
