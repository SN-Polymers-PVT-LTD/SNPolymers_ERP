/**
 * Parses a raw currency input string into a clean numeric string.
 * Strips all non-numeric characters (except first decimal and optional leading minus).
 *
 * @param {string|number} val - Raw input value
 * @param {Object} options
 * @param {boolean} [options.allowNegative=false] - Whether to allow negative numbers
 * @returns {string} Clean numeric string (e.g. "150000.50", "0", or "")
 */
export function parseCurrencyString(val, options = {}) {
  if (val == null) return '';
  const allowNegative = options.allowNegative ?? false;

  let str = String(val).trim();

  // Strip spaces, commas, currency symbols, and scientific notation character 'e' (or 'E')
  str = str.replace(/[\s,₹]/g, '');

  // Strip scientific notation exponent prefix if present
  str = str.replace(/[eE]/g, '');

  // Handle negative sign
  let isNegative = false;
  if (allowNegative && str.startsWith('-')) {
    isNegative = true;
    str = str.slice(1);
  } else {
    str = str.replace(/-/g, '');
  }

  // Remove everything except digits and decimal point
  str = str.replace(/[^0-9.]/g, '');

  // Ensure only the first decimal point is kept
  const parts = str.split('.');
  if (parts.length > 2) {
    str = parts[0] + '.' + parts.slice(1).join('');
  }

  // Handle leading zeros (e.g. "0001500" -> "1500", "05" -> "5")
  // Keep single "0" if it's "0" or "0.something"
  if (str) {
    const dotIdx = str.indexOf('.');
    let intPart = dotIdx === -1 ? str : str.slice(0, dotIdx);
    const decPart = dotIdx === -1 ? '' : str.slice(dotIdx);

    if (intPart.length > 1 && /^0+/.test(intPart)) {
      intPart = intPart.replace(/^0+/, '');
      if (intPart === '') intPart = '0';
    }
    str = intPart + decPart;
  }

  // Edge case: if input was just "." or "-.", treat as empty
  if (str === '.') {
    return '';
  }

  if (str.startsWith('.')) {
    str = '0' + str;
  }

  if (!str) return '';

  return isNegative ? `-${str}` : str;
}

/**
 * Formats a clean numeric string into Indian numbering format (en-IN).
 * Preserves the exact decimals without forcing truncation or expansion.
 *
 * @param {string|number} val - Clean numeric string or number
 * @param {Object} options
 * @returns {string} Indian formatted currency string (e.g. "1,50,000.50" or "")
 */
export function formatIndianCurrency(val, _options = {}) {
  if (val === '' || val == null) return '';

  const str = String(val);
  const isNegative = str.startsWith('-');
  const cleanStr = isNegative ? str.slice(1) : str;

  const parts = cleanStr.split('.');
  const intPart = parts[0];
  const decPart = parts.length > 1 ? '.' + parts[1] : '';

  if (!intPart && !decPart) return '';

  // Format integer part using Indian locale rules
  const num = Number(intPart);
  if (isNaN(num)) return '';

  const formattedInt = num.toLocaleString('en-IN');

  return (isNegative ? '-' : '') + formattedInt + decPart;
}
