const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid fund request ID.');

const createFundRequestSchema = {
  body: z.object({
    zo_fr_no: z.string({
      required_error: 'zo_fr_no (Fund Request Number) is required.'
    })
    .trim()
    .min(1, 'zo_fr_no (Fund Request Number) is required.'),
    
    zo_fr_amount: z.union([z.number(), z.string()], {
      required_error: 'zo_fr_amount must be a positive number greater than zero.'
    })
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val > 0 && isFinite(val), 'zo_fr_amount must be a positive number greater than zero.'),
    
    zo_remarks: z.string().optional()
  })
};

const actOnFundRequestSchema = {
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    action: z.enum(['Approve', 'Hold'], {
      errorMap: () => ({ message: "action must be 'Approve' or 'Hold'." })
    }),
    approve_ho_amount: z.union([z.number(), z.string()]).optional().nullable()
      .transform((val) => val === undefined || val === null ? val : Number(val)),
    transfer_from_account: z.string().optional().nullable(),
    ho_remarks: z.string().optional().nullable()
  })
};

const cancelFundRequestSchema = {
  params: z.object({
    id: uuidSchema
  })
};

module.exports = {
  createFundRequestSchema,
  actOnFundRequestSchema,
  cancelFundRequestSchema
};
