const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../db/supabase');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_development_jwt_secret_key_minimum_256_bit';
const JWT_ACCESS_EXPIRY = process.env.JWT_ACCESS_EXPIRY || '15m';
const JWT_REFRESH_EXPIRY = process.env.JWT_REFRESH_EXPIRY || '7d';

/**
 * Generate Access and Refresh tokens.
 */
function generateTokens(user, sessionId, refreshJti) {
  const accessTokenPayload = {
    user_id: user.id,
    mobile_number: user.mobile_number,
    role: user.role || 'staff',
    permissions: user.permissions || {},
    session_id: sessionId
  };

  const accessToken = jwt.sign(accessTokenPayload, JWT_SECRET, {
    expiresIn: JWT_ACCESS_EXPIRY
  });

  const refreshTokenPayload = {
    user_id: user.id,
    session_id: sessionId
  };

  const refreshToken = jwt.sign(refreshTokenPayload, JWT_SECRET, {
    expiresIn: JWT_REFRESH_EXPIRY,
    jwtid: refreshJti
  });

  return { accessToken, refreshToken };
}

/**
 * Inserts a new session record into Supabase sessions table.
 */
async function createSession({ userId, jti, ipAddress, userAgent }) {
  const { data, error } = await supabase
    .from('sessions')
    .insert([
      {
        user_id: userId,
        jwt_jti: jti,
        ip_address: ipAddress || null,
        user_agent: userAgent || null,
        is_active: true,
        login_at: new Date().toISOString()
      }
    ])
    .select();

  if (error) {
    throw new Error(`Failed to create database session: ${error.message}`);
  }

  return data[0];
}

/**
 * Closes an active session in the database and computes duration.
 */
async function closeSession(sessionId) {
  const currentTime = new Date();

  // 1. Fetch current session to calculate duration
  const { data: sessions, error: fetchError } = await supabase
    .from('sessions')
    .select('*')
    .eq('id', sessionId)
    .limit(1);

  if (fetchError || !sessions || sessions.length === 0) {
    throw new Error('Session not found.');
  }

  const session = sessions[0];
  if (!session.is_active) {
    return session; // already closed
  }

  const loginTime = new Date(session.login_at);
  const durationSeconds = Math.max(0, Math.floor((currentTime - loginTime) / 1000));

  // 2. Update session record
  const { data: updatedSessions, error: updateError } = await supabase
    .from('sessions')
    .update({
      logout_at: currentTime.toISOString(),
      is_active: false,
      duration_seconds: durationSeconds
    })
    .eq('id', sessionId)
    .select();

  if (updateError) {
    throw new Error(`Failed to terminate session: ${updateError.message}`);
  }

  return updatedSessions[0];
}

/**
 * Helper: Formats seconds into HH:MM:SS format
 */
function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '00:00:00';
  const hrs = Math.floor(seconds / 3600).toString().padStart(2, '0');
  const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

module.exports = {
  generateTokens,
  createSession,
  closeSession,
  formatDuration
};
