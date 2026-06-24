const { z } = require('zod');

// Mobile number regex format check (E.164)
const mobileRegex = /^\+?[1-9]\d{1,14}$/;

const requestOtpSchema = {
  body: z.object({
    mobileNumber: z.string({
      required_error: 'Mobile number is required.',
      invalid_type_error: 'Mobile number is required.'
    })
    .min(1, 'Mobile number is required.')
    .regex(mobileRegex, 'Invalid mobile number format. Must be in E.164 format (+[country][number]).')
  })
};

const linkTelegramSchema = {
  body: z.object({
    mobileNumber: z.string({
      required_error: 'Mobile number is required.',
      invalid_type_error: 'Mobile number is required.'
    }).min(1, 'Mobile number is required.'),
    chatId: z.union([z.string(), z.number()], {
      required_error: 'Chat ID is required.',
      invalid_type_error: 'Chat ID is required.'
    })
    .transform((val) => String(val).trim())
    .refine((val) => val.length > 0, 'Chat ID is required.')
    .refine((val) => /^-?\d+$/.test(val), 'Invalid Chat ID format. Please enter the number exactly as the bot sent it.')
  })
};

const verifyOtpSchema = {
  body: z.object({
    mobileNumber: z.string({
      required_error: 'Mobile number is required.',
      invalid_type_error: 'Mobile number is required.'
    }).min(1, 'Mobile number is required.'),
    otp: z.string({
      required_error: 'OTP is required.',
      invalid_type_error: 'OTP is required.'
    }).min(1, 'OTP is required.')
  })
};

module.exports = {
  requestOtpSchema,
  linkTelegramSchema,
  verifyOtpSchema
};
