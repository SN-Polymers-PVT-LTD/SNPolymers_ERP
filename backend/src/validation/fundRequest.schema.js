const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid fund request ID.');

const createFundRequestSchema = {
  body: z.object({
    zo_fr_no: z.string().trim().optional(),
    
    work_order_no: z.string({
      required_error: 'work_order_no is required.'
    })
    .trim()
    .min(1, 'work_order_no is required.'),

    zo_fr_amount: z.union([z.number(), z.string()]).optional()
      .transform((val) => val === undefined || val === null ? val : Number(val)),

    requested_amount: z.union([z.number(), z.string()]).optional()
      .transform((val) => val === undefined || val === null ? val : Number(val)),
    
    zo_remarks: z.string().optional(),
    remarks: z.string().optional()
  }).refine(data => data.zo_fr_amount !== undefined || data.requested_amount !== undefined, {
    message: 'Either zo_fr_amount or requested_amount must be provided.',
    path: ['zo_fr_amount']
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
    approved_amount: z.union([z.number(), z.string()]).optional().nullable()
      .transform((val) => val === undefined || val === null ? val : Number(val)),
    transfer_from_account: z.string().optional().nullable(),
    ho_remarks: z.string().optional().nullable(),
    remarks: z.string().optional().nullable()
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
