const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid fund request ID.');
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Indian bank account numbers commonly run 9-18 digits, numeric only.
const accountNumberRegex = /^\d{9,18}$/;

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
    
    zo_remarks: z.string({
      required_error: 'ZO remarks are required.'
    }).trim().min(1, 'ZO remarks are required.'),
    remarks: z.string().optional(),

    beneficiary_name: z.string().trim().optional().nullable(),
    beneficiary_ac_no: z.string().trim().optional().nullable()
      // Not .regex() directly: empty string must pass through untouched since
      // the beneficiary block is optional on the fund request form.
      .refine(val => !val || accountNumberRegex.test(val), {
        message: 'beneficiary_ac_no must be 9-18 digits.'
      }),
    beneficiary_ifsc: z.string().trim().optional().nullable()
      .refine(val => !val || ifscRegex.test(val), {
        message: 'beneficiary_ifsc must be 11-char in format AAAA0XXXXXX.'
      }),
    beneficiary_bank_name: z.string().trim().optional().nullable(),
    beneficiary_bank_id: z.string().regex(uuidRegex, 'Invalid bank ID.').optional().nullable()
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
