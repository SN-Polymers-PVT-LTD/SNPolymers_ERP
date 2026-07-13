const { z } = require('zod');

const createReturnSchema = {
  body: z.object({
    requested_amount: z.number({ required_error: 'requested_amount is required.' })
      .positive('requested_amount must be a positive number.'),
    remarks: z.string().trim().optional()
  })
};

const actionReturnSchema = {
  body: z.object({
    status: z.enum(['Approved', 'Rejected'], {
      errorMap: () => ({ message: "status must be either 'Approved' or 'Rejected'." })
    }),
    remarks: z.string().trim().optional()
  })
};

module.exports = {
  createReturnSchema,
  actionReturnSchema
};
