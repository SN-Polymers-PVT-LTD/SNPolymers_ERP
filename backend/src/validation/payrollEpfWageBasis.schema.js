const { z } = require('zod');
const params = z.object({ employeeId: z.uuid() }).strict();

module.exports = {
  get: { params },
  confirm: { params, body: z.object({ pay_structure_id: z.uuid(), effective_from: z.iso.date() }).strict() },
  save: { params, body: z.object({
    pay_structure_id: z.uuid(),
    effective_from: z.iso.date().refine(date => date >= '2025-12-01' && date.endsWith('-01'), 'Choose a month start from December 2025 onward.'),
    regular_wages: z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/, 'Enter an amount with up to two decimal places.'),
    reason: z.string().trim().min(1).max(2000),
    confirmed_allowances: z.literal(true),
  }).strict() },
};
