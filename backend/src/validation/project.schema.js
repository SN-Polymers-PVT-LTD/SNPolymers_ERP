const { z } = require('zod');

const allowedStatuses = ['Running', 'Closed', 'Complete Under Maintenance'];

const createProjectSchema = {
  body: z.object({
    work_order_no: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),
    
    estimate_no: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),
    
    work_order_value: z.union([z.number(), z.string()], {
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    })
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val >= 0, 'work_order_value must be a valid non-negative number.'),

    site_details: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),

    state: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),

    district: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),

    zone: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),

    department: z.string({
      required_error: 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All fields including work_order_value are required (work_order_no, estimate_no, work_order_value, site_details, state, district, zone, department).'),

    status: z.enum(allowedStatuses, {
      errorMap: () => ({ message: `Invalid status. Allowed values are: ${allowedStatuses.join(', ')}` })
    }).optional()
  })
};

const updateProjectSchema = {
  body: z.object({
    estimate_no: z.string({
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'),
    
    work_order_value: z.union([z.number(), z.string()], {
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    })
    .transform((val) => Number(val))
    .refine((val) => !isNaN(val) && val >= 0, 'work_order_value must be a valid non-negative number.'),

    site_details: z.string({
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'),

    state: z.string({
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'),

    district: z.string({
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'),

    zone: z.string({
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'),

    department: z.string({
      required_error: 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).')
  })
};

const updateProjectStatusSchema = {
  body: z.object({
    status: z.string({
      required_error: 'Status is required.',
      invalid_type_error: 'Status is required.'
    })
    .min(1, 'Status is required.')
    .refine((val) => allowedStatuses.includes(val), {
      message: `Invalid status. Allowed values are: ${allowedStatuses.join(', ')}`
    })
  })
};

module.exports = {
  createProjectSchema,
  updateProjectSchema,
  updateProjectStatusSchema
};
