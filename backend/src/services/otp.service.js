const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { supabase } = require('../db/supabase');

const SALT_ROUNDS = 10;
const OTP_EXPIRY_MINUTES = 5;

/**
 * Generate a 6-digit cryptographically secure random numeric OTP string.
 */
function generateOtp() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * Hash plain text OTP using bcrypt.
 */
async function hashOtp(otp) {
  return await bcrypt.hash(otp, SALT_ROUNDS);
}

/**
 * Store the hashed OTP request in the Supabase database.
 */
async function storeOtp(mobileNumber, otpHash) {
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000).toISOString();
  
  const { data, error } = await supabase
    .from('otp_requests')
    .insert([
      {
        mobile_number: mobileNumber,
        otp_hash: otpHash,
        expires_at: expiresAt,
        is_used: false,
        attempts: 0
      }
    ])
    .select();

  if (error) {
    throw new Error(`Failed to store OTP: ${error.message}`);
  }
  
  return data[0];
}

/**
 * Verifies a given OTP code against the database.
 * Rules:
 * - Must match the latest unused OTP request for that mobile number.
 * - Must not be expired.
 * - Must have attempts < 3.
 * - Must not be marked as already used.
 */
async function verifyOtp(mobileNumber, rawOtp) {
  // Development bypass
  if (process.env.NODE_ENV === 'development' && rawOtp === '123456') {
    return { success: true };
  }

  // Retrieve the latest unused OTP request for this mobile number
  const { data: requests, error } = await supabase
    .from('otp_requests')
    .select('*')
    .eq('mobile_number', mobileNumber)
    .eq('is_used', false)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error || !requests || requests.length === 0) {
    return { success: false, reason: 'No active OTP request found.' };
  }

  const otpRequest = requests[0];
  const currentTime = new Date();
  const expiresAt = new Date(otpRequest.expires_at);

  // Check if expired
  if (currentTime > expiresAt) {
    return { success: false, reason: 'OTP has expired.' };
  }

  // Check verification attempts
  if (otpRequest.attempts >= 3) {
    return { success: false, reason: 'Too many failed attempts. Please request a new OTP.' };
  }

  // Compare the OTP hash
  const isValid = await bcrypt.compare(rawOtp, otpRequest.otp_hash);

  if (!isValid) {
    // Atomic DB-level increment via RPC
    const { data: updatedAttempts, error: updateError } = await supabase
      .rpc('increment_otp_attempts', { p_id: otpRequest.id });

    if (updateError) {
      throw new Error(`Failed to increment OTP attempts: ${updateError.message}`);
    }

    return {
      success: false,
      reason: 'Invalid OTP code.',
      attemptsLeft: Math.max(0, 3 - updatedAttempts)
    };
  }

  // Mark OTP as used on success
  await supabase
    .from('otp_requests')
    .update({ is_used: true })
    .eq('id', otpRequest.id);

  return { success: true };
}

module.exports = {
  generateOtp,
  hashOtp,
  storeOtp,
  verifyOtp
};
