/**
 * Canonical mobile format matches production authorised_users rows:
 * digits only, no leading '+' (e.g. 918276071523).
 *
 * Lookups must also accept the '+'-prefixed form because the frontend
 * and older admin inserts still send/store +91XXXXXXXXXX.
 */

function normalizeMobileNumber(value) {
  if (value == null) return '';
  return String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/[-()]/g, '')
    .replace(/^\+/, '');
}

/**
 * Both DB-compatible forms for a given input.
 * e.g. '+918276071523' → ['918276071523', '+918276071523']
 */
function mobileNumberVariants(value) {
  const normalized = normalizeMobileNumber(value);
  if (!normalized) return [];
  return [...new Set([normalized, `+${normalized}`])];
}

/**
 * Canonical storage form for new whitelist inserts.
 * 10-digit local numbers become 91XXXXXXXXXX (no leading +).
 */
function toStoredMobileNumber(value) {
  let clean = String(value || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[-()]/g, '');

  if (/^\d{10}$/.test(clean)) {
    clean = `91${clean}`;
  } else if (/^0\d{10}$/.test(clean)) {
    clean = `91${clean.substring(1)}`;
  } else if (clean.startsWith('+')) {
    clean = clean.slice(1);
  } else if (/^91\d{10}$/.test(clean)) {
    // already canonical
  }

  return clean;
}

module.exports = {
  normalizeMobileNumber,
  mobileNumberVariants,
  toStoredMobileNumber
};
