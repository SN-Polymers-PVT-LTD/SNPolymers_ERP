const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid activity break ID.');
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD.');

const createBreakRequestSchema = {
  body: z.object({
    work_order_no: z.string().trim().min(1),
    start_date: isoDateSchema,
    expected_end_date: isoDateSchema,
    je_remarks: z.string().trim().min(1, 'Reason is required')
  }).refine(
    (d) => d.expected_end_date >= d.start_date,
    { message: 'Expected end date must be on or after start date.', path: ['expected_end_date'] }
  )
};

const actOnBreakRequestSchema = {
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    action: z.enum(['Cancel', 'Accept', 'Reject', 'Approve', 'RequestReopen', 'ApproveReopen']),
    remarks: z.string().trim().optional()
  })
};

module.exports = {
  createBreakRequestSchema,
  actOnBreakRequestSchema
};
