'use strict';

const { z } = require('zod');

const upsertEstimatedBillSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim()
      .min(1, 'work_order_no is required.'),
    estimated_bill_amount: z.number({ required_error: 'estimated_bill_amount is required.' })
      .positive('estimated_bill_amount must be greater than zero.'),
    estimated_payment_date: z.string({ required_error: 'estimated_payment_date is required.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'estimated_payment_date must be in YYYY-MM-DD format.'),
    surety_pct: z.number({ required_error: 'surety_pct is required.' })
      .int('surety_pct must be an integer.')
      .min(0, 'surety_pct must be between 0 and 100.')
      .max(100, 'surety_pct must be between 0 and 100.'),
    remarks: z.string().max(500, 'remarks cannot exceed 500 characters.').optional().nullable()
  })
};

const getEstimatedBillSchema = {
  params: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim()
      .min(1, 'work_order_no is required.')
  })
};

module.exports = {
  upsertEstimatedBillSchema,
  getEstimatedBillSchema
};
