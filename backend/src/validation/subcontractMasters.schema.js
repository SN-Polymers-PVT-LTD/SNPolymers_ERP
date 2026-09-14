const { z } = require('zod');

const uuid = z.string().uuid('Invalid UUID format.');
const nullableString = z.string().trim().optional().nullable();
const blankToUndefined = (value) => value === '' ? undefined : value;
const optionalEmail = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? null : value,
  z.string().trim().email().optional().nullable()
);

const listSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(1000).default(10),
    search: z.string().trim().optional().default(''),
    sub_head: z.string().trim().optional().default(''),
    unit: z.string().trim().optional().default(''),
    is_active: z.preprocess(blankToUndefined, z.enum(['true', 'false']).optional()),
    beneficiary_status: z.preprocess(blankToUndefined, z.enum(['linked', 'unlinked']).optional()),
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
    contact_person: nullableString,
    mobile: nullableString,
    email: optionalEmail,
    address: nullableString,
    pan_no: nullableString,
    gst_no: nullableString,
    primary_beneficiary_id: uuid.optional().nullable()
  })
};

const subcontractorUpdateSchema = {
  params: z.object({ id: uuid }),
  body: subcontractorCreateSchema.body.extend({ is_active: z.boolean().optional() })
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
  subcontractorStatusSchema: statusSchema
};
