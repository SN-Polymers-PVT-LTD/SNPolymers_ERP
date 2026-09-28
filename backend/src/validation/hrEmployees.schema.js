const { z } = require('zod');

const uuid = z.string().uuid();
const categories = [
  'HO Staff', 'Fabric Factory Permanent Employees', 'SNP Casual Factory Labour',
  'SNP Permanent Factory Labour', 'Projects Department Employees', 'Local Daily-Wage Workers'
];
const departments = ['Head Office', 'Fabric Factory', 'SNP Factory', 'Projects'];
const statuses = ['Active', 'Inactive', 'Exited'];
const roles = ['admin', 'je', 'zo', 'ho', 'accounts'];
const date = z.iso.date();

function isValidIndianMobile(val) {
  if (val === null || val === undefined || val === '') return true;
  if (typeof val !== 'string') return false;
  const trimmed = val.trim();
  if (!trimmed) return true;

  if (!/^\+?[\d\s-]+$/.test(trimmed)) return false;
  if ((trimmed.match(/\+/g) || []).length > 1) return false;
  if (trimmed.startsWith('+') && !trimmed.startsWith('+91')) return false;

  const digits = trimmed.replace(/\D/g, '');
  const core10 = (digits.startsWith('91') && digits.length === 12)
    ? digits.slice(2)
    : (digits.startsWith('0') && digits.length === 11)
      ? digits.slice(1)
      : digits;

  return core10.length === 10 && /^[6-9]\d{9}$/.test(core10);
}

const contact = z.union([
  z.string().trim().max(30).refine(isValidIndianMobile, {
    message: 'Contact number must be an optional 10-digit Indian mobile number with optional +91 or leading 0 prefix.'
  }).transform(v => (v === '' ? null : v)),
  z.null()
]).optional();
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
    limit: z.coerce.number().int().min(1).max(1000).default(20),
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
