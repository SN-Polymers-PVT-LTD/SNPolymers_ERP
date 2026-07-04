'use strict';

const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid bill ID.');

// Matches "RA Bill N" (N = 1, 2, ...) or "Final Bill"
const paymentTypeRegex = /^(RA Bill [1-9][0-9]*|Final Bill)$/;

// Helper: optional non-negative number field (accepts number, string, null, undefined → coerces to number)
const optionalAmount = z.preprocess(
  (val) => (val === null || val === undefined || val === '' ? 0 : Number(val)),
  z.number({ invalid_type_error: 'Amount must be a valid number.' })
    .nonnegative('Amount must be zero or a positive number.')
    .finite('Amount must be a finite number.')
);

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

    gross_bill:              optionalAmount,
    security_deposit_amount: optionalAmount,
    agency_payment:          optionalAmount,
    special_security_amount: optionalAmount,
    other_retention:         optionalAmount,
    it_tds:                  optionalAmount,
    sgst:                    optionalAmount,
    cgst:                    optionalAmount,
    sd:                      optionalAmount,

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
