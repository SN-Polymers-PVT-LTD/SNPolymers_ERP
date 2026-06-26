const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid requisition ID.');

const createRequisitionSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' }).trim().min(1, 'work_order_no is required.'),
    requisition_no: z.string({ required_error: 'requisition_no (Requisition Number) is required.' })
      .trim()
      .min(1, 'requisition_no (Requisition Number) is required.')
      .regex(/^[A-Za-z0-9_\-.]+$/, 'requisition_no contains invalid characters. Only letters, digits, hyphens, underscores, and dots are allowed.'),
    material_main_head: z.string({ required_error: 'material_main_head is required.' }).trim().min(1, 'material_main_head is required.'),
    requisition_pdf_url: z.string({ required_error: 'requisition_pdf_url is required. Upload the PDF first.' }).trim().min(1, 'requisition_pdf_url is required. Upload the PDF first.'),
    original_filename: z.string().optional().nullable(),
    requisition_amount: z.coerce.number({
      required_error: 'requisition_amount must be a positive number greater than zero.',
      invalid_type_error: 'requisition_amount must be a positive number greater than zero.'
    }).positive('requisition_amount must be a positive number greater than zero.'),
    gst_bill: z.enum(['Yes', 'No'], {
      errorMap: () => ({ message: "gst_bill must be 'Yes' or 'No'." })
    }),
    gst_bill_pdf_url: z.string().optional().nullable(),
    bank_details: z.string({ required_error: 'bank_details is required.' }).trim().min(1, 'bank_details is required.'),
    expen_head_remarks: z.string().optional().nullable()
  }).refine(data => data.gst_bill !== 'Yes' || (data.gst_bill_pdf_url && data.gst_bill_pdf_url.trim() !== ''), {
    message: "gst_bill_pdf_url is required when GST Bill is 'Yes'.",
    path: ['gst_bill_pdf_url']
  })
};

const actOnRequisitionSchema = {
  params: z.object({
    id: uuidSchema
  }),
  body: z.object({
    action: z.enum(['Approve', 'Hold'], {
      errorMap: () => ({ message: "action must be 'Approve' or 'Hold'." })
    }),
    approved_amount: z.coerce.number().optional().nullable(),
    remarks_approved_authority: z.string({
      required_error: 'remarks_approved_authority is required.'
    }).trim().min(1, 'remarks_approved_authority is required.')
  }).superRefine((data, ctx) => {
    if (data.action === 'Approve') {
      if (data.approved_amount === undefined || data.approved_amount === null || isNaN(data.approved_amount) || data.approved_amount <= 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'approved_amount is required for approval and must be greater than zero.',
          path: ['approved_amount']
        });
      }
    }
    if (data.action === 'Hold') {
      if (data.approved_amount !== undefined && data.approved_amount !== null) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'approved_amount must not be supplied when action is Hold.',
          path: ['approved_amount']
        });
      }
    }
  })
};

const cancelRequisitionSchema = {
  params: z.object({
    id: uuidSchema
  })
};

module.exports = {
  createRequisitionSchema,
  actOnRequisitionSchema,
  cancelRequisitionSchema
};
