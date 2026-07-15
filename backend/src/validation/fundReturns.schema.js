const { z } = require('zod');

const createReturnSchema = {
  body: z.object({
    zo_user_id: z.string({ required_error: 'zo_user_id is required.' })
      .trim()
      .min(1, 'zo_user_id is required.'),
    requested_amount: z.number({ required_error: 'requested_amount is required.' })
      .positive('requested_amount must be a positive number.'),
    remarks_ho: z.string().trim().optional()
  })
};

const acceptReturnSchema = {
  body: z.object({
    client_updated_at: z.string({ required_error: 'client_updated_at is required.' })
      .refine(val => !isNaN(Date.parse(val)), { message: 'client_updated_at must be a valid date.' }),
    breakdown: z.array(z.object({
      work_order_no: z.string().min(1, 'work_order_no in breakdown is required.'),
      amount: z.number().positive('amount in breakdown must be positive.')
    })).min(1, 'breakdown must contain at least one work order allocation.')
  })
};

const actionReturnSchema = {
  body: z.object({
    remarks_zo: z.string({ required_error: 'remarks_zo is required.' })
      .trim()
      .min(1, 'remarks_zo is required.')
  })
};

const hoActionReturnSchema = {
  body: z.object({
    status: z.enum(['Requested', 'Cancelled'], {
      errorMap: () => ({ message: "status must be either 'Requested' or 'Cancelled'." })
    }),
    requested_amount: z.number().positive().optional(),
    remarks_ho: z.string().trim().optional()
  })
};

module.exports = {
  createReturnSchema,
  acceptReturnSchema,
  actionReturnSchema,
  hoActionReturnSchema
};
