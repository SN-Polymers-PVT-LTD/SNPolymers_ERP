'use strict';

const { z } = require('zod');

const uuidRegex = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const uuidSchema = z.string().regex(uuidRegex, 'Invalid report ID.');

const createProgressReportSchema = {
  body: z.object({
    work_order_no: z.string({ required_error: 'work_order_no is required.' })
      .trim().min(1, 'work_order_no is required.'),

    site_visit_date: z.string({ required_error: 'site_visit_date is required.' })
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'site_visit_date must be a valid date in YYYY-MM-DD format.')
      .refine(val => {
        const inputDate = new Date(val);
        const today = new Date();
        today.setHours(23, 59, 59, 999);
        return inputDate <= today;
      }, 'site_visit_date cannot be in the future.'),

    work_progress_details: z.string({ required_error: 'work_progress_details is required.' })
      .trim().min(1, 'work_progress_details is required.'),

    physical_work_progress: z.union([z.number(), z.string()], {
      required_error: 'physical_work_progress must be a number between 0 and 100.'
    })
      .transform(val => Number(val))
      .refine(val => !isNaN(val) && val >= 0 && val <= 100 && isFinite(val),
        'physical_work_progress must be a number between 0 and 100.')
      .transform(val => Math.round(val * 100) / 100),

    daily_site_photo_url: z.string({ required_error: 'daily_site_photo_url is required. Upload the photo first.' })
      .trim()
      .min(1, 'daily_site_photo_url is required. Upload the photo first.')
      .refine(val => !val.startsWith('http://') && !val.startsWith('https://') && !val.startsWith('blob:'), {
        message: 'daily_site_photo_url must be a relative storage path (e.g. uuid.jpg), not a full URL or blob.'
      }),

    original_photo_filename: z.string().optional().nullable(),
    remarks_after_site_visit: z.string().optional().nullable()
  })
};

const addRemarksSchema = {
  params: z.object({ id: uuidSchema }),
  body: z.object({
    remarks_approved_authority: z.string({ required_error: 'remarks_approved_authority is required.' })
      .trim().min(1, 'remarks_approved_authority cannot be blank.')
  })
};

const getReportByIdSchema = {
  params: z.object({ id: uuidSchema })
};

module.exports = {
  createProgressReportSchema,
  addRemarksSchema,
  getReportByIdSchema
};
