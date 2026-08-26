'use strict';

const { supabase } = require('../db/supabase');
const { logError } = require('../utils/logger');

/**
 * Upserts a 128-d face descriptor into public.face_descriptors.
 * Uses onConflict: 'user_id' so re-enrollment replaces the prior vector
 * and triggers updated_at update via trg_face_descriptor_updated_at.
 *
 * @param {string} userId - UUID of the authorized user
 * @param {number[]} descriptor - 128-element float array
 * @param {string} consentedAt - ISO 8601 timestamp string
 * @returns {Promise<Object>} Upserted face_descriptors record
 */
async function enrollDescriptor(userId, descriptor, consentedAt) {
  const { data, error } = await supabase
    .from('face_descriptors')
    .upsert(
      {
        user_id: userId,
        descriptor,
        consented_at: consentedAt
      },
      { onConflict: 'user_id' }
    )
    .select('id, user_id, descriptor, enrolled_at, updated_at, consented_at')
    .single();

  if (error) {
    throw new Error(`enrollDescriptor failed: ${error.message}`);
  }
  return data;
}

/**
 * Retrieves the enrolled face descriptor for a given user.
 *
 * @param {string} userId - UUID of the authorized user
 * @returns {Promise<number[]|null>} 128-element float array or null
 */
async function getDescriptor(userId) {
  const { data, error } = await supabase
    .from('face_descriptors')
    .select('descriptor')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    throw new Error(`getDescriptor failed: ${error.message}`);
  }

  return data ? data.descriptor : null;
}

/**
 * Computes Euclidean distance (L2 norm) between two 128-dimensional vectors.
 *
 * @param {number[]} a - 128-element numeric array
 * @param {number[]} b - 128-element numeric array
 * @returns {number} Euclidean distance
 */
function euclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 128 || b.length !== 128) {
    throw new Error('euclideanDistance: both inputs must be float arrays of length 128.');
  }

  let sum = 0;
  for (let i = 0; i < 128; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Verifies a submitted descriptor against the enrolled descriptor for a user.
 *
 * @param {string} userId - UUID of the authorized user
 * @param {number[]} submittedDescriptor - 128-element float array
 * @param {number} [threshold=0.6] - Distance threshold for match (default 0.6)
 * @returns {Promise<{ match: boolean, distance: number|null, reason?: string }>}
 */
async function verifyDescriptor(userId, submittedDescriptor, threshold = 0.6) {
  const enrolled = await getDescriptor(userId);
  if (!enrolled) {
    return { match: false, distance: null, reason: 'NOT_ENROLLED' };
  }

  const distance = euclideanDistance(enrolled, submittedDescriptor);
  return {
    match: distance <= threshold,
    distance
  };
}

module.exports = {
  enrollDescriptor,
  getDescriptor,
  euclideanDistance,
  verifyDescriptor
};
