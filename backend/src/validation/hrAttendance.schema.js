const { z } = require('zod');
const { factoryCategories: categories, departmentsFor } = require('../domain/hrEmployeeCategories');
const department = z.enum(['Fabric Factory', 'SNP Factory']);
const validDepartment = v => !v.department || departmentsFor(v.employee_category).includes(v.department);
const selection = z.object({ employee_category: z.enum(categories), department: department.optional(), date: z.iso.date() }).strict().refine(validDepartment, 'Department does not match employee category.');
const params = z.object({ sheetId: z.uuid() }).strict();
const row = z.object({
  employee_id: z.uuid(), attendance_status: z.enum(['Present','Absent','Medical Leave','Paid Leave','Unpaid Leave','Compensatory Off','Management Issue']).nullable().optional(),
  entry_timestamp: z.iso.datetime({ offset: true }).nullable().optional(), exit_timestamp: z.iso.datetime({ offset: true }).nullable().optional(),
  duty_type: z.enum(['Single Duty','Double Duty']).nullable().optional(), holiday_pay_eligible: z.boolean().optional(),
  leave_request_id: z.uuid().nullable().optional(), remarks: z.string().trim().max(2000).nullable().optional()
}).strict();
module.exports = {
  calendar: {
    query: z.object({
      employee_category: z.enum(categories),
      department: department.optional(),
      month: z.string().regex(/^\d{4}-(?:0[1-9]|1[0-2])$/, 'Month must be in YYYY-MM format.'),
      employee_id: z.string().uuid().optional()
    }).strict().refine(validDepartment, 'Department does not match employee category.')
  },
  fmSummary: {query:z.object({date:z.iso.date().optional()}).strict()},
  reviewQueue: {query:z.object({from_date:z.iso.date().optional(),to_date:z.iso.date().optional(),
    employee_category:z.enum(categories).optional(),department:department.optional(),status:z.enum(['Submitted','Returned for Correction','Locked']).optional(),
    page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)
  }).strict().refine(q=>!q.from_date||!q.to_date||q.from_date<=q.to_date,'Invalid date range.')},
  returnSheet: {params,body:z.object({remarks:z.string().trim().min(1).max(2000)}).strict()},
  reviewSheet: {params,body:z.object({remarks:z.string().trim().max(2000).optional()}).strict()},
  decideLeave: {params:z.object({sheetId:z.uuid(),leaveId:z.uuid()}).strict(),
    body:z.object({decision:z.enum(['Approved','Rejected']),pay_treatment:z.enum(['Paid','Unpaid']),
      remarks:z.string().trim().max(2000).optional()}).strict()
      .refine(b=>b.decision!=='Rejected'||Boolean(b.remarks),'Rejection remarks are required.')
      .refine(b=>b.decision!=='Rejected'||b.pay_treatment==='Unpaid','Rejected leave must have Unpaid treatment.')},
  selection: { query: selection }, populate: { body: selection }, detail: { params },
  save: { params, body: z.object({ rows: z.array(row).min(1).max(5000).refine(rows => new Set(rows.map(r => r.employee_id)).size === rows.length, 'Duplicate employee in batch.') }).strict() },
  submit: { params, body: z.object({}).strict() },
  leave: { params, body: z.object({ employee_id: z.uuid(), leave_id: z.uuid().nullable().default(null),
    from_date: z.iso.date(), to_date: z.iso.date(), leave_type: z.enum(['Medical Leave','Paid Leave','Unpaid Leave','Leave / Not Working']),
    reason: z.string().trim().min(1).max(2000), pay_treatment: z.enum(['Pending','Paid','Unpaid'])
  }).strict().refine(v => v.to_date >= v.from_date, 'To Date must be on or after From Date.') },
  history: { params, query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() }
};
