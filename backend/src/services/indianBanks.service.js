'use strict';

const { supabase } = require('../db/supabase');

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
let cachedBanks = null;
let cacheExpiry = 0;

/**
 * Retrieve active Indian banks with in-memory caching.
 * Suitable for dropdown population.
 *
 * @returns {Promise<Array<{id: string, bank_name: string, is_active: boolean}>>}
 */
async function getActiveIndianBanks() {
  const now = Date.now();
  if (cachedBanks && now < cacheExpiry) {
    return cachedBanks;
  }

  const { data, error } = await supabase
    .from('indian_bank_master')
    .select('id, bank_name, is_active')
    .eq('is_active', true)
    .order('bank_name', { ascending: true });

  if (error) {
    console.error('getActiveIndianBanks DB error:', error.message);
    if (cachedBanks) return cachedBanks; // fallback to stale cache if available
    throw error;
  }

  cachedBanks = data || [];
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedBanks;
}

/**
 * Direct DB lookup for a single bank by ID.
 *
 * @param {string} id - Bank UUID
 * @returns {Promise<{id: string, bank_name: string, is_active: boolean}|null>}
 */
async function getIndianBankById(id) {
  if (!id) return null;

  const { data, error } = await supabase
    .from('indian_bank_master')
    .select('id, bank_name, is_active')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('getIndianBankById DB error:', error.message);
    throw error;
  }

  return data || null;
}

/**
 * Authoritative DB lookup to validate that a bank exists and is active.
 * Never relies on the in-memory cache.
 *
 * @param {string} id - Bank UUID
 * @returns {Promise<{valid: boolean, reason?: 'NOT_FOUND'|'INACTIVE', bank?: {id: string, bank_name: string}}>}
 */
async function validateActiveIndianBank(id) {
  if (!id) {
    return { valid: false, reason: 'NOT_FOUND' };
  }

  const { data: bank, error } = await supabase
    .from('indian_bank_master')
    .select('id, bank_name, is_active')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('validateActiveIndianBank DB error:', error.message);
    throw error;
  }

  if (!bank) {
    return { valid: false, reason: 'NOT_FOUND' };
  }

  if (!bank.is_active) {
    return {
      valid: false,
      reason: 'INACTIVE',
      bank: { id: bank.id, bank_name: bank.bank_name }
    };
  }

  return {
    valid: true,
    bank: { id: bank.id, bank_name: bank.bank_name }
  };
}

/**
 * Invalidate the active banks cache (e.g. after an admin updates bank master data).
 */
function invalidateBankCache() {
  cachedBanks = null;
  cacheExpiry = 0;
}

module.exports = {
  getActiveIndianBanks,
  getIndianBankById,
  validateActiveIndianBank,
  invalidateBankCache
};
