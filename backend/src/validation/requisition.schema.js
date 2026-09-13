const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid requisition ID.');
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Indian bank account numbers commonly run 9-18 digits, numeric only.
const accountNumberRegex = /^\d{9,18}$/;

const createRequisitionSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' }).trim().min(1, 'work_order_no is required.'),
    requisition_no: z.string({ required_error: 'requisition_no (Requisition Number) is required.' })
      .trim()
      .min(1, 'requisition_no (Requisition Number) is required.')
      .regex(/^[A-Za-z0-9_\-.]+$/, 'requisition_no contains invalid characters. Only letters, digits, hyphens, underscores, and dots are allowed.'),
    material_main_head: z.string({ required_error: 'material_main_head is required.' }).trim().min(1, 'material_main_head is required.'),
    material_sub_head: z.string().trim().optional().nullable(),
    material_details: z.string().trim().optional().nullable(),
    requisition_pdf_attachment_id: z.string({ required_error: 'requisition_pdf_attachment_id is required. Upload the PDF first.' })
      .regex(uuidRegex, 'Invalid requisition PDF attachment ID. Upload the PDF first.'),
    // Now the only human-readable filename source once storage paths are UUID-based
    // (exportHelpers.js falls back to parsing the storage path otherwise).
    original_filename: z.string({ required_error: 'original_filename is required.' }).trim().min(1, 'original_filename is required.'),
    requisition_amount: z.coerce.number({
      required_error: 'requisition_amount must be a positive number greater than zero.',
      invalid_type_error: 'requisition_amount must be a positive number greater than zero.'
    }).positive('requisition_amount must be a positive number greater than zero.'),
    gst_bill: z.enum(['Yes', 'No'], {
      errorMap: () => ({ message: "gst_bill must be 'Yes' or 'No'." })
    }),
    gst_bill_pdf_attachment_id: z.string().regex(uuidRegex, 'Invalid GST bill attachment ID.').optional().nullable(),
    bank_details: z.string().trim().optional().nullable(),
    beneficiary_id: z.string().regex(uuidRegex, 'Invalid beneficiary ID.').optional().nullable(),
    beneficiary_name: z.string({ required_error: 'Beneficiary name is required.' })
      .trim().min(1, 'Beneficiary name is required.'),
    beneficiary_ac_no: z.string({ required_error: 'Beneficiary account number is required.' })
      .trim().regex(accountNumberRegex, 'beneficiary_ac_no must be 9-18 digits.'),
    beneficiary_ifsc: z.string({ required_error: 'Beneficiary IFSC is required.' })
      .trim().toUpperCase().regex(ifscRegex, 'beneficiary_ifsc must be 11-char in format AAAA0XXXXXX.'),
    beneficiary_bank_name: z.string().trim().optional().nullable(),
    beneficiary_bank_id: z.string({ required_error: 'Beneficiary bank is required.' })
      .regex(uuidRegex, 'Invalid bank ID.'),
    expen_head_remarks: z.string().optional().nullable()
  }).refine(data => data.gst_bill !== 'Yes' || (data.gst_bill_pdf_attachment_id && data.gst_bill_pdf_attachment_id.trim() !== ''), {
    message: "gst_bill_pdf_attachment_id is required when GST Bill is 'Yes'.",
    path: ['gst_bill_pdf_attachment_id']
  }).refine(data => data.material_main_head?.trim() !== 'Sub Contractor' || (data.material_sub_head?.trim() && data.material_details?.trim()), {
    message: 'material_sub_head and material_details are required when material_main_head is Sub Contractor.',
    path: ['material_sub_head']
  })
};

const upsertProjectsBeneficiarySchema = {
  body: z.object({
    beneficiary_ac_no: z.string().trim().min(1, 'beneficiary_ac_no is required.')
      .regex(accountNumberRegex, 'beneficiary_ac_no must be 9-18 digits.'),
    beneficiary_ifsc: z.string().trim()
      .regex(ifscRegex, 'beneficiary_ifsc must be 11-char in format AAAA0XXXXXX.'),
    beneficiary_name: z.string().trim().min(1, 'beneficiary_name is required.'),
    beneficiary_bank_id: z.string().regex(uuidRegex, 'Invalid bank ID.').optional().nullable(),
    beneficiary_bank_name: z.string().trim().optional().nullable()
  })
};

const upsertIndianBankSchema = {
  body: z.object({
    bank_name: z.string().trim().min(1, 'bank_name is required.'),
    is_active: z.boolean().optional()
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

const payFromZoBalanceSchema = {
  params: z.object({
    id: uuidSchema
  })
};

const sendToAccountsSchema = {
  params: z.object({
    id: uuidSchema
  })
};

const adjustSubcontractorBalanceSchema = {
  body: z.object({
    adjustment_id: z.string().regex(uuidRegex, 'Invalid UUID format for adjustment_id.').optional(),
    work_order_no: z.string({ required_error: 'work_order_no is required.' }).trim().min(1, 'work_order_no is required.'),
    material_sub_head: z.string({ required_error: 'material_sub_head is required.' }).trim().min(1, 'material_sub_head is required.'),
    material_details: z.string({ required_error: 'material_details is required.' }).trim().min(1, 'material_details is required.'),
    adjustment_amount: z.coerce.number({
      required_error: 'adjustment_amount is required.',
      invalid_type_error: 'adjustment_amount must be a valid number.'
    }).refine(val => val !== 0, 'adjustment_amount cannot be zero.'),
    remarks: z.string({ required_error: 'remarks are required.' }).trim().min(5, 'remarks must be at least 5 characters explaining the adjustment.')
  })
};

module.exports = {
  createRequisitionSchema,
  actOnRequisitionSchema,
  cancelRequisitionSchema,
  adjustSubcontractorBalanceSchema,
  payFromZoBalanceSchema,
  sendToAccountsSchema,
  upsertProjectsBeneficiarySchema,
  upsertIndianBankSchema
};
