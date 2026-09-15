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
  rate_reference: z.string().trim().max(200).nullable().optional(),
  remarks: z.string().trim().max(2000).nullable().optional(),
  entry_kind: z.any().optional(),
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
  }
};
