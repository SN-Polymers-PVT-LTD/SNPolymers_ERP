const { z } = require('zod');

const errorResponseSchema = z.object({
  success: z.literal(false),
  message: z.string()
}).passthrough();

const healthResponseSchema = z.object({
  status: z.string(),
  database: z.string(),
  version: z.string(),
  git: z.string(),
  branch: z.string(),
  built: z.string().nullable(),
  timestamp: z.string()
});

const requestOtpSuccessSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  needsTelegramSetup: z.boolean().optional()
}).passthrough();

const verifyOtpSuccessSchema = z.object({
  success: z.literal(true),
  message: z.string().optional(),
  user: z.object({
    id: z.string().uuid(),
    mobile_number: z.string(),
    display_name: z.string(),
    role: z.string(),
    permissions: z.record(z.unknown()).optional()
  }).optional()
}).passthrough();

const authUserSchema = z.object({
  id: z.string().uuid(),
  mobile_number: z.string(),
  role: z.string(),
  display_name: z.string().optional(),
  displayName: z.string().optional(),
  permissions: z.record(z.unknown()).optional()
}).passthrough();

const authMeResponseSchema = z.object({
  success: z.literal(true),
  user: authUserSchema
});

const projectsHealthItemSchema = z.object({
  work_order_no: z.string()
}).passthrough();

const projectsHealthResponseSchema = z.object({
  success: z.literal(true),
  data: z.array(projectsHealthItemSchema)
});

const enrollOtpSuccessSchema = z.object({
  success: z.literal(true),
  message: z.string()
}).passthrough();

const enrollFaceSuccessSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  enrolled_at: z.string(),
  updated_at: z.string()
}).passthrough();

module.exports = {
  errorResponseSchema,
  healthResponseSchema,
  requestOtpSuccessSchema,
  verifyOtpSuccessSchema,
  authMeResponseSchema,
  projectsHealthResponseSchema,
  enrollOtpSuccessSchema,
  enrollFaceSuccessSchema
};
