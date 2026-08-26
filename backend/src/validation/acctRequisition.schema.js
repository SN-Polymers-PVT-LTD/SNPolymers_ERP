const { z } = require('zod');
const { supabase } = require('../db/supabase');
// S6 FIX: App-layer reference list of Indian bank names, now DB-backed
// (indian_bank_master, 026_create_indian_bank_master.sql) instead of the
// static JSON it replaced. Kept as a plain in-memory Set (not a DB round
// trip per request) because validate.js only ever calls Zod's synchronous
// safeParse — going fully async here would mean touching every
// validateRequest call site in this codebase. INDIAN_BANKS_SET starts out
// seeded from the JSON file as a safe default in case the DB read below
// hasn't resolved yet (e.g. the very first requests after a cold start),
// then gets replaced by refreshIndianBanksCache() below, and kept current
// after that by upsertIndianBank (acctRequisition.controller.js) adding/
// updating entries in-place on every successful write. This is a per-process
// cache — a second server instance won't see a newly-added bank until its
// own next refresh/restart, an accepted tradeoff (see migration 026's notes).
const staticIndianBanksFallback = require('../constants/indianBanks.json');
let INDIAN_BANKS_SET = new Set(staticIndianBanksFallback.map(b => b.toUpperCase()));

async function refreshIndianBanksCache() {
  try {
    const { data, error } = await supabase
      .from('indian_bank_master')
      .select('bank_name')
      .eq('is_active', true);
    if (error) throw error;
    if (data && data.length > 0) {
      INDIAN_BANKS_SET = new Set(data.map(b => b.bank_name.toUpperCase()));
    }
  } catch (error) {
    console.error(`refreshIndianBanksCache failed, keeping previous bank list: ${error.message}`);
  }
}

// Fire-and-forget at module load — don't block server startup on this read.
refreshIndianBanksCache();

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid UUID.');
const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
// Indian bank account numbers commonly run 9-18 digits, numeric only.
const accountNumberRegex = /^\d{9,18}$/;

const accountsLineItemBody = z.object({
  account_sub_title_id:   uuidSchema.optional().nullable(),
  account_sub_title_text: z.string().trim().optional().nullable(),
  particulars:            z.string().trim().optional().nullable(),
  particulars_id:         uuidSchema.optional().nullable(),
  beneficiary_ac_no:      z.string().trim().optional().nullable()
                            // Not .regex() directly: see beneficiary_ifsc below — a
                            // partially-filled row autosaves '' until this field is
                            // complete, so empty string must pass through untouched.
                            .refine(val => !val || accountNumberRegex.test(val), {
                              message: 'beneficiary_ac_no must be 9-18 digits.'
                            }),
  beneficiary_name:       z.string().trim().optional().nullable(),
  // Not .regex() directly: that rejects '' outright, which a partially-filled
  // row sends on every autosave until the field is complete. Empty string is
  // treated the same as omitted/null; only a non-empty value has to match.
  beneficiary_ifsc:       z.string().trim().optional().nullable()
                            .refine(val => !val || ifscRegex.test(val), {
                              message: 'ifsc must be 11-char in format AAAA0XXXXXX.'
                            }),
  beneficiary_bank_name:  z.string().trim().optional().nullable()
                            .refine(val => !val || INDIAN_BANKS_SET.has(val.toUpperCase()), {
                              message: 'beneficiary_bank_name must be a recognized bank from the Indian Banks Master List.'
                            }),
  debit_bank_ac_type:     z.string().trim().optional().nullable(),
  req_amount:             z.coerce.number().positive().optional().nullable(),
  payment_mode:           z.enum(['Cheque', 'Bulk NEFT', 'RTGS', 'NEFT']).optional().nullable(),
  cheque_no:              z.string().trim().optional().nullable(),
  cheque_date:            z.string().trim().optional().nullable(),
});

const addLineItemSchema = {
  params: z.object({ sheetId: uuidSchema }),
  body: accountsLineItemBody
};

const updateLineItemSchema = {
  params: z.object({ sheetId: uuidSchema, itemId: uuidSchema }),
  body: accountsLineItemBody
};

// Shared by both the single-item and batch action endpoints — same rule
// either way: ho_pass_amount required for PartiallyApprove, ho_remarks
// required for Hold/Return/Reject.
const acctLineItemActionFields = {
  action:         z.enum(['Approve', 'PartiallyApprove', 'Hold', 'Return', 'Reject']),
  ho_pass_amount: z.coerce.number().positive().optional().nullable(),
  ho_remarks:     z.string().trim().optional().nullable(),
};
const acctLineItemActionRefine = (data, ctx) => {
  if (data.action === 'PartiallyApprove' && !data.ho_pass_amount) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ho_pass_amount is required for Partially Approve.', path: ['ho_pass_amount'] });
  }
  if (['Return', 'Hold', 'Reject'].includes(data.action) && !data.ho_remarks?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ho_remarks is required for this action.', path: ['ho_remarks'] });
  }
};

const actOnLineItemSchema = {
  params: z.object({ itemId: uuidSchema }),
  body: z.object(acctLineItemActionFields).superRefine(acctLineItemActionRefine)
};

// Batch counterpart of actOnLineItemSchema — one request carrying every HO
// decision for a review session (mirrors the cost-estimate HO review's
// submit_row_approvals), instead of one PATCH per line item per click.
const actOnLineItemsBatchSchema = {
  params: z.object({ sheetId: uuidSchema }),
  body: z.object({
    actions: z.array(
      z.object({ line_item_id: uuidSchema, ...acctLineItemActionFields }).superRefine(acctLineItemActionRefine)
    ).min(1, 'At least one action is required.')
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

// Mirrors upsertAccountSubTitleSchema exactly — same upsert-by-title convention.
const upsertParticularsSchema = {
  body: z.object({
    title:     z.string().trim().min(1, 'title is required.'),
    is_active: z.boolean().optional()
  })
};

const upsertBeneficiarySchema = {
  body: z.object({
    account_number:        z.string().trim()
                             .regex(accountNumberRegex, 'account_number must be 9-18 digits.'),
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

const upsertIndianBankSchema = {
  body: z.object({
    bank_name: z.string().trim().min(1, 'bank_name is required.'),
    is_active: z.boolean().optional()
  })
};

module.exports = {
  addLineItemSchema, updateLineItemSchema, actOnLineItemSchema, actOnLineItemsBatchSchema,
  resubmitLineItemSchema, reopenLineItemSchema,
  upsertBankBalanceSchema, upsertAccountSubTitleSchema, upsertBeneficiarySchema,
  upsertParticularsSchema,
  upsertIndianBankSchema,
  exportNeftSchema,
  refreshIndianBanksCache
};
