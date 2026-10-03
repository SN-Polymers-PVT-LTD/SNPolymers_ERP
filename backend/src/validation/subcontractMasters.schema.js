const { z } = require('zod');

const uuid = z.string().uuid('Invalid UUID format.');
const nullableString = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().optional().nullable()
);
const blankToUndefined = (value) => value === '' ? undefined : value;

const listSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(10),
    search: z.string().trim().optional().default(''),
    sub_head: z.string().trim().optional().default(''),
    unit: z.string().trim().optional().default(''),
    subcontractor_id: uuid.optional(),
    is_active: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
    sortBy: z.string().optional(),
    sortOrder: z.enum(['asc', 'desc']).optional().default('asc')
  })
};

const idSchema = { params: z.object({ id: uuid }) };

const workCreateSchema = {
  body: z.object({
    sub_head: z.string().trim().min(1),
    material_details: z.string().trim().min(1),
    unit: z.string().trim().min(1)
  })
};

const workUpdateSchema = {
  params: z.object({ id: uuid }),
  body: z.object({
    sub_head: z.string().trim().min(1),
    material_details: z.string().trim().min(1),
    unit: z.string().trim().min(1)
  })
};

const statusSchema = {
  params: z.object({ id: uuid }),
  body: z.object({ is_active: z.boolean() })
};

const subcontractorCreateSchema = {
  body: z.object({
    subcontractor_name: z.string().trim().min(1),
    work_ids: z.array(uuid).optional()
  })
};

const subcontractorUpdateSchema = {
  params: z.object({ id: uuid }),
  body: z.object({
    subcontractor_name: z.string().trim().min(1).optional(),
    is_active: z.boolean().optional(),
    work_ids: z.array(uuid).optional()
  })
};

const assignmentListSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(20),
    work_order_no: z.string().trim().optional().default(''),
    subcontractor_id: uuid.optional(),
    is_active: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional())
  })
};

const assignmentCreateSchema = {
  body: z.object({
    work_order_no: z.string().trim().min(1),
    subcontractor_id: uuid,
    subcontract_work_id: uuid,
    unit: z.string().trim().min(1),
    qty: z.coerce.number().positive(),
    rate: z.coerce.number().positive(),
    rate_reference: nullableString
  })
};

module.exports = {
  workListSchema: listSchema,
  workIdSchema: idSchema,
  workCreateSchema,
  workUpdateSchema,
  workStatusSchema: statusSchema,
  subcontractorListSchema: listSchema,
  subcontractorIdSchema: idSchema,
  subcontractorCreateSchema,
  subcontractorUpdateSchema,
  subcontractorStatusSchema: statusSchema,
  assignmentListSchema,
  assignmentCreateSchema
};
