const { z } = require('zod');
const categories = ['Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour', 'SNP Casual Factory Labour', 'Local Daily-Wage Workers'];
const selection = z.object({ employee_category: z.enum(categories), date: z.iso.date() }).strict();
const params = z.object({ sheetId: z.uuid() }).strict();
const row = z.object({
  employee_id: z.uuid(), attendance_status: z.enum(['Present','Absent','Medical Leave','Paid Leave','Unpaid Leave','Compensatory Off','Management Issue']).nullable().optional(),
  entry_timestamp: z.iso.datetime({ offset: true }).nullable().optional(), exit_timestamp: z.iso.datetime({ offset: true }).nullable().optional(),
  duty_type: z.enum(['Single Duty','Double Duty']).nullable().optional(), holiday_pay_eligible: z.boolean().optional(),
  leave_request_id: z.uuid().nullable().optional(), remarks: z.string().trim().max(2000).nullable().optional()
}).strict();
module.exports = {
  selection: { query: selection }, populate: { body: selection }, detail: { params },
  save: { params, body: z.object({ rows: z.array(row).min(1).max(5000).refine(rows => new Set(rows.map(r => r.employee_id)).size === rows.length, 'Duplicate employee in batch.') }).strict() },
  submit: { params, body: z.object({}).strict() },
  leave: { params, body: z.object({ employee_id: z.uuid(), leave_id: z.uuid().nullable().default(null),
    from_date: z.iso.date(), to_date: z.iso.date(), leave_type: z.enum(['Medical Leave','Paid Leave','Unpaid Leave','Leave / Not Working']),
    reason: z.string().trim().min(1).max(2000), pay_treatment: z.enum(['Pending','Paid','Unpaid'])
  }).strict().refine(v => v.to_date >= v.from_date, 'To Date must be on or after From Date.') },
  history: { params, query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() }
};
