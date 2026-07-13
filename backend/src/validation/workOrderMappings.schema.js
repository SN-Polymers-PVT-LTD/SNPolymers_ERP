const { z } = require('zod');

const createWorkOrderMappingSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim()
      .min(1, 'work_order_no is required.'),
    je_mobile_number: z.string({ required_error: 'je_mobile_number is required.' })
      .trim()
      .min(1, 'je_mobile_number is required.')
  })
};

const deactivateWorkOrderMappingSchema = {
  body: z.object({
    reason: z.enum(['Removed', 'Project Closed'], {
      errorMap: () => ({ message: "reason must be either 'Removed' or 'Project Closed'." })
    })
  })
};

module.exports = {
  createWorkOrderMappingSchema,
  deactivateWorkOrderMappingSchema
};
