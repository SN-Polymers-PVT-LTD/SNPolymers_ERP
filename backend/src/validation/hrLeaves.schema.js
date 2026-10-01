const { z } = require('zod');

const leaveTypes = ['Medical Leave', 'Other Leave'];
const categories = ['HO Staff', 'Projects Department Employees'];

module.exports = {
  create: {
    body: z.object({
      from_date: z.iso.date(),
      to_date: z.iso.date(),
      leave_type: z.enum(leaveTypes),
      reason: z.string().trim().min(1, 'Reason is required.').max(2000)
    }).strict().refine(b => b.from_date <= b.to_date, 'From date must be on or before to date.')
  },
  update: {
    params: z.object({ id: z.uuid() }).strict(),
    body: z.object({
      from_date: z.iso.date(),
      to_date: z.iso.date(),
      leave_type: z.enum(leaveTypes),
      reason: z.string().trim().min(1, 'Reason is required.').max(2000)
    }).strict().refine(b => b.from_date <= b.to_date, 'From date must be on or before to date.')
  },
  queue: {
    query: z.object({
      status: z.enum(['Pending', 'Approved', 'Rejected']).optional(),
      employee_category: z.enum(categories).optional(),
      from_date: z.iso.date().optional(),
      to_date: z.iso.date().optional(),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20)
    }).strict().refine(q => !q.from_date || !q.to_date || q.from_date <= q.to_date, 'Invalid date range.')
  },
  decision: {
    params: z.object({ id: z.uuid() }).strict(),
    body: z.object({
      decision: z.enum(['Approved', 'Rejected']),
      pay_treatment: z.enum(['Paid', 'Unpaid']),
      remarks: z.string().trim().max(2000).optional().nullable()
    }).strict()
      .refine(b => b.decision !== 'Rejected' || Boolean(b.remarks), 'Rejection remarks are required.')
      .refine(b => b.decision !== 'Rejected' || b.pay_treatment === 'Unpaid', 'Rejected leave must have Unpaid treatment.')
  }
};
