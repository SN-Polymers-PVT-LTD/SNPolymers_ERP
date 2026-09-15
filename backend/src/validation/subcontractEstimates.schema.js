const { z } = require('zod');

const uuid = z.string().uuid('Invalid UUID format.');
const numeric = z.union([z.number(), z.string()]).transform(Number).refine(Number.isFinite, 'Must be numeric.');

const lineSchema = z.object({
  line_id: uuid.optional(),
  subcontractor_id: uuid,
  subcontract_work_id: uuid,
  qty: numeric,
  rate: numeric,
  amount: z.any().optional(),
  entry_kind: z.enum(['BASE', 'ADDITION', 'ADJUSTMENT']).optional(),
  adjusts_line_id: uuid.nullable().optional(),
  rate_reference: z.string().trim().max(200).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  created_by: z.any().optional(),
  updated_by: z.any().optional(),
  zo_office_approve: z.any().optional(),
  ho_office_approve: z.any().optional()
});

module.exports = {
  idSchema: { params: z.object({ id: uuid }) },
  listSchema: { query: z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20), status: z.string().trim().optional() }) },
  createSchema: { body: z.object({ work_order_no: z.string().trim().min(1), remarks: z.string().trim().max(2000).nullable().optional() }) },
  saveLinesSchema: {
    params: z.object({ id: uuid }),
    body: z.object({
      expected_updated_at: z.string().datetime({ offset: true }),
      lines: z.array(lineSchema).max(1000)
    })
  },
  workflowSchema: {
    params: z.object({ id: uuid }),
    body: z.object({
      action: z.enum([
        'SUBMIT', 'RESUBMIT', 'OPEN_ZO_REVIEW', 'ZO_APPROVE',
        'ZO_REQUEST_REVISION', 'ZO_REJECT', 'OPEN_HO_REVIEW',
        'HO_APPROVE', 'HO_REQUEST_REVISION', 'HO_REJECT', 'REOPEN', 'SUBMIT_REOPENED'
      ]),
      remarks: z.string().trim().max(2000).nullable().optional(),
      expected_updated_at: z.string().datetime({ offset: true }),
      deadline_hours: z.coerce.number().int().min(1).max(168).optional()
    })
  },
  reconcileLinesSchema: {
    params: z.object({ id: uuid }),
    body: z.object({
      expected_updated_at: z.string().datetime({ offset: true }),
      lines: z.array(lineSchema).max(1000)
    })
  },
  rowReviewSchema: {
    params: z.object({ id: uuid }),
    body: z.object({
      stage: z.enum(['ZO', 'HO']),
      expected_updated_at: z.string().datetime({ offset: true }),
      approvals: z.array(z.object({
        line_id: uuid,
        approve_status: z.enum(['Approve', 'Not Approve']),
        remarks: z.string().trim().max(2000).nullable().optional()
      })).max(1000)
    })
  }
};
