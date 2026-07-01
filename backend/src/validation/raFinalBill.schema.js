'use strict';

const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid bill ID.');

// Matches "RA Bill N" (N = 1, 2, ...) or "Final Bill"
const paymentTypeRegex = /^(RA Bill [1-9][0-9]*|Final Bill)$/;

const createBillSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim().min(1, 'work_order_no is required.'),

    payment_type: z.string({ required_error: 'payment_type is required.' })
      .trim()
      .regex(paymentTypeRegex, "payment_type must be 'RA Bill N' (N ≥ 1) or 'Final Bill'."),

    bill_date: z.string({ required_error: 'bill_date is required.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'bill_date must be a valid date in YYYY-MM-DD format.'),

    bill_no: z.string({ required_error: 'bill_no is required.' })
      .trim().min(1, 'bill_no is required.'),

    bill_amount_with_gst: z.union([z.number(), z.string()], {
      required_error: 'bill_amount_with_gst must be a positive number.'
    })
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val > 0 && isFinite(val),
        'bill_amount_with_gst must be a positive number greater than zero.'),

    earnest_money_deposit: z.union([z.number(), z.string(), z.null()])
      .transform(val => val === null || val === '' ? 0 : Number(val))
      .refine(val => !isNaN(val) && val >= 0 && isFinite(val),
        'earnest_money_deposit must be zero or a positive number.')
      .optional()
      .default(0),

    security_deposit_amount: z.union([z.number(), z.string()])
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val >= 0 && isFinite(val),
        'security_deposit_amount must be zero or a positive number.')
      .optional()
      .default(0),

    bill_copy_url: z.string({ required_error: 'bill_copy_url is required. Upload the bill copy first.' })
      .trim().min(1, 'bill_copy_url is required. Upload the bill copy first.'),

    original_bill_filename: z.string().optional().nullable(),
    remarks: z.string().optional().nullable()
  })
};

const getBillByIdSchema = {
  params: z.object({ id: uuidSchema })
};

module.exports = {
  createBillSchema,
  getBillByIdSchema
};
