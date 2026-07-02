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

    earnest_money_deposit: z.union([z.number(), z.string()])
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val >= 0, 'earnest_money_deposit must be a non-negative number.')
      .optional()
      .default(0),

    site_latitude: z.union([z.number(), z.string(), z.null()])
      .transform((val) => val === '' || val === null ? null : Number(val))
      .refine((val) => val === null || (!isNaN(val) && val >= -90 && val <= 90), 'site_latitude must be between -90 and 90.')
      .optional(),

    site_longitude: z.union([z.number(), z.string(), z.null()])
      .transform((val) => val === '' || val === null ? null : Number(val))
      .refine((val) => val === null || (!isNaN(val) && val >= -180 && val <= 180), 'site_longitude must be between -180 and 180.')
      .optional(),

    project_start_date: z.string().nullable().optional()
      .refine((val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'project_start_date must be in YYYY-MM-DD format.'),

    project_end_date: z.string().nullable().optional()
      .refine((val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'project_end_date must be in YYYY-MM-DD format.'),

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
    }).min(1, 'All standard fields including work_order_value are required (estimate_no, work_order_value, site_details, state, district, zone, department).'),

    earnest_money_deposit: z.union([z.number(), z.string()])
      .transform((val) => Number(val))
      .refine((val) => !isNaN(val) && val >= 0, 'earnest_money_deposit must be a non-negative number.')
      .optional(),

    site_latitude: z.union([z.number(), z.string(), z.null()])
      .transform((val) => val === '' || val === null ? null : Number(val))
      .refine((val) => val === null || (!isNaN(val) && val >= -90 && val <= 90), 'site_latitude must be between -90 and 90.')
      .optional(),

    site_longitude: z.union([z.number(), z.string(), z.null()])
      .transform((val) => val === '' || val === null ? null : Number(val))
      .refine((val) => val === null || (!isNaN(val) && val >= -180 && val <= 180), 'site_longitude must be between -180 and 180.')
      .optional(),

    project_start_date: z.string().nullable().optional()
      .refine((val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'project_start_date must be in YYYY-MM-DD format.'),

    project_end_date: z.string().nullable().optional()
      .refine((val) => !val || /^\d{4}-\d{2}-\d{2}$/.test(val), 'project_end_date must be in YYYY-MM-DD format.')
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
