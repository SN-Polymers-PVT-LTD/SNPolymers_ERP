const { z } = require('zod');

const uuid = z.string().uuid();
const categories = [
  'HO Staff', 'Fabric Factory Permanent Employees', 'SNP Casual Factory Labour',
  'SNP Permanent Factory Labour', 'Projects Department Employees', 'Local Daily-Wage Workers'
];
const departments = ['Head Office', 'Accounts', 'Fabric Factory', 'Manufacturing Factory', 'Projects'];
const statuses = ['Active', 'Inactive', 'Exited'];
const roles = ['admin', 'je', 'zo', 'ho', 'accounts'];
const date = z.iso.date();
const contact = z.union([z.string().trim().min(1).max(30), z.null()]).optional();
const link = z.union([uuid, z.null()]).optional();

const fields = {
  employee_name: z.string().trim().min(1).max(150),
  employee_category: z.enum(categories),
  department: z.enum(departments),
  contact_number: contact,
  erp_user_id: link,
  joining_date: date,
  active_status: z.enum(statuses)
};

module.exports = {
  list: { query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().max(100).optional().default(''),
    employee_category: z.enum(categories).optional(),
    active_status: z.enum(statuses).optional()
  }) },
  id: { params: z.object({ id: uuid }) },
  users: { query: z.object({
    role: z.enum(roles).optional(),
    search: z.string().trim().max(100).optional().default(''),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20)
  }) },
  create: { body: z.object({ ...fields, active_status: fields.active_status.optional() }).strict() },
  update: { params: z.object({ id: uuid }), body: z.object(fields).partial().strict().refine(v => Object.keys(v).length > 0) },
  status: { params: z.object({ id: uuid }), body: z.object({ active_status: z.enum(statuses) }).strict() }
};
