const { z } = require('zod');
// S6 FIX: App-layer reference list of Indian bank names sourced from List_of_Indian_Banks_Master_Unique.xlsx
const indianBanks = require('../constants/indianBanks.json');
const INDIAN_BANKS_SET = new Set(indianBanks.map(b => b.toUpperCase()));

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid UUID.');
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;

const accountsLineItemBody = z.object({
  account_sub_title_id:   uuidSchema.optional().nullable(),
  account_sub_title_text: z.string().trim().optional().nullable(),
  particulars:            z.string().trim().optional().nullable(),
  beneficiary_ac_no:      z.string().trim().optional().nullable(),
  beneficiary_name:       z.string().trim().optional().nullable(),
  beneficiary_ifsc:       z.string().trim()
                            .regex(ifscRegex, 'ifsc must be 11-char in format AAAA0XXXXXX.')
                            .optional().nullable(),
  beneficiary_bank_name:  z.string().trim().optional().nullable()
                            .refine(val => !val || INDIAN_BANKS_SET.has(val.toUpperCase()), {
                              message: 'beneficiary_bank_name must be a recognized bank from the Indian Banks Master List.'
                            }),
  debit_bank_ac_type:     z.string().trim().optional().nullable(),
  req_amount:             z.coerce.number().positive().optional().nullable(),
  payment_mode:           z.enum(['Cheque', 'Bulk NEFT', 'RTGS', 'NEFT']).optional().nullable(),
  cheque_no:              z.string().trim().optional().nullable(),
  cheque_date:            z.string().trim().optional().nullable(),
}).refine(
  data => data.payment_mode !== 'Cheque' || (data.cheque_no && data.cheque_date),
  { message: 'cheque_no and cheque_date are required when payment_mode is Cheque.', path: ['cheque_no'] }
);

const addLineItemSchema = {
  params: z.object({ sheetId: uuidSchema }),
  body: accountsLineItemBody
};

const updateLineItemSchema = {
  params: z.object({ sheetId: uuidSchema, itemId: uuidSchema }),
  body: accountsLineItemBody
};

const actOnLineItemSchema = {
  params: z.object({ itemId: uuidSchema }),
  body: z.object({
    action:         z.enum(['Approve', 'PartiallyApprove', 'Hold', 'Return', 'Reject']),
    ho_pass_amount: z.coerce.number().positive().optional().nullable(),
    ho_remarks:     z.string().trim().optional().nullable(),
  }).superRefine((data, ctx) => {
    if (data.action === 'PartiallyApprove' && !data.ho_pass_amount) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ho_pass_amount is required for Partially Approve.', path: ['ho_pass_amount'] });
    }
    if (['Return', 'Hold', 'Reject'].includes(data.action) && !data.ho_remarks?.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ho_remarks is required for this action.', path: ['ho_remarks'] });
    }
  })
};

const resubmitLineItemSchema = {
  params: z.object({ itemId: uuidSchema }),
  body: accountsLineItemBody
};

const reopenLineItemSchema = {
  params: z.object({ itemId: uuidSchema }),
  body: z.object({ reopen_remark: z.string().trim().min(1, 'reopen_remark is required.') })
};

const upsertBankBalanceSchema = {
  body: z.object({
    bank_name:         z.string().trim().min(1, 'bank_name is required.'),
    balance_date:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD required'),
    available_balance: z.coerce.number().nonnegative(),
    // Optional/nullable: predates this column (024_add_bank_account_number.sql), and
    // Bulk NEFT export enforces its own presence at export time rather than here, so
    // existing upsert calls that don't send it yet keep working.
    account_number:    z.string().trim().min(1).optional().nullable()
  })
};

// S4 & S6 FIX: Zod schemas for upsertAccountSubTitle and upsertBeneficiary.
// S6 FIX: beneficiary_bank_name is validated against the static Indian Banks Master dataset
// (seeded from List_of_Indian_Banks_Master_Unique.xlsx). This prevents syntactically valid
// but unrecognized/fictitious bank names from being stored and later exported into Bulk NEFT.
const upsertAccountSubTitleSchema = {
  body: z.object({
    title:     z.string().trim().min(1, 'title is required.'),
    is_active: z.boolean().optional()
  })
};

const upsertBeneficiarySchema = {
  body: z.object({
    account_number:        z.string().trim().min(1, 'account_number is required.'),
    ifsc:                  z.string().trim()
                             .regex(ifscRegex, 'ifsc must be 11-char in format AAAA0XXXXXX.'),
    beneficiary_name:      z.string().trim().min(1, 'beneficiary_name is required.'),
    beneficiary_bank_name: z.string().trim().min(1, 'beneficiary_bank_name is required.')
                             .refine(val => INDIAN_BANKS_SET.has(val.toUpperCase()), {
                               message: 'beneficiary_bank_name must be a recognized bank from the Indian Banks Master List.'
                             })
  })
};

const exportNeftSchema = {
  params: z.object({ sheetId: uuidSchema }),
  body: z.object({ item_ids: z.array(uuidSchema).min(1) })
};

module.exports = {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema,
  resubmitLineItemSchema, reopenLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  exportNeftSchema
};
