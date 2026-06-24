const { z } = require('zod');

// UUID format verification
const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid UUID format.');

const createEstimateSchema = {
  body: z.object({
    work_order_no: z.string({
      required_error: 'work_order_no is required.'
    }).min(1, 'work_order_no is required.'),
    
    zonal_office_no: z.string().trim().min(1, 'zonal_office_no is required and cannot be blank.').optional(),
    je_remarks: z.string().optional()
  })
};

const saveDraftItemsSchema = {
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    items: z.array(
      z.object({
        item_id: z.string().regex(uuidRegex, 'Invalid UUID format.').optional(),
        material_main_head: z.string().min(1, 'Material heads, details, and unit are required.'),
        material_sub_head: z.string().min(1, 'Material heads, details, and unit are required.'),
        material_details: z.string().min(1, 'Material heads, details, and unit are required.'),
        unit: z.string().min(1, 'Material heads, details, and unit are required.'),
        qty: z.union([z.number(), z.string()])
          .transform((val) => Number(val))
          .refine((val) => !isNaN(val) && val >= 0, 'Quantity and rate must be non-negative numbers.'),
        rate: z.union([z.number(), z.string()])
          .transform((val) => Number(val))
          .refine((val) => !isNaN(val) && val >= 0, 'Quantity and rate must be non-negative numbers.'),
        rate_reference: z.string().optional().nullable(),
        source_of_purchase: z.string().regex(uuidRegex, 'Invalid UUID format.').optional().nullable()
      }),
      {
        required_error: 'items must be an array.',
        invalid_type_error: 'items must be an array.'
      }
    )
  })
};

const submitRowApprovalsSchema = {
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    approvals: z.array(
      z.object({
        item_id: z.string().regex(uuidRegex, 'Invalid item UUID.').transform(val => val.trim()),
        approve_status: z.enum(['Approve', 'Not Approve']),
        remarks: z.string().optional().nullable(),
        source_of_purchase: z.string().regex(uuidRegex, 'Invalid UUID format.').optional().nullable()
      }).superRefine((data, ctx) => {
        if (data.approve_status === 'Not Approve' && (!data.remarks || data.remarks.trim() === '')) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Remarks are required for rejected item: ${data.item_id}`,
            path: ['remarks']
          });
        }
      }),
      {
        required_error: 'approvals must be an array.',
        invalid_type_error: 'approvals must be an array.'
      }
    )
  })
};

module.exports = {
  createEstimateSchema,
  saveDraftItemsSchema,
  submitRowApprovalsSchema
};
