const { z } = require('zod');

// enrollFaceSchema — used on POST /enroll
// descriptor: must be exactly 128 finite numbers (mirrors chk_face_descriptor_128d DB constraint)
// otp: 6-digit string (matches otp.service.js generateOtp output)
// consented_at: ISO 8601 timestamp; defaults to server time in controller if omitted
const enrollFaceSchema = {
  body: z.object({
    descriptor: z
      .array(
        z.number({ message: 'Descriptor elements must be numbers.' }),
        { message: 'Descriptor must be an array of numbers.' }
      )
      .refine((arr) => arr.length === 128, {
        message: 'Descriptor must be an array of exactly 128 numbers.'
      })
      .refine((arr) => arr.every(Number.isFinite), {
        message: 'Descriptor must contain only finite numbers (no NaN or Infinity).'
      }),
    otp: z
      .string({ message: 'OTP is required.' })
      .min(1, 'OTP is required.'),
    consented_at: z.string().datetime().optional()
  })
};

module.exports = { enrollFaceSchema };
