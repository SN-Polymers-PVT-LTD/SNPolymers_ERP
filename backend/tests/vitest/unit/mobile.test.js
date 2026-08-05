import { describe, test, expect } from 'vitest';
const {
  normalizeMobileNumber,
  mobileNumberVariants,
  toStoredMobileNumber
} = require('../../../src/utils/mobile');

describe('mobile number utilities', () => {
  describe('normalizeMobileNumber', () => {
    test('strips leading + and whitespace from E.164 input', () => {
      expect(normalizeMobileNumber('+918276071523')).toBe('918276071523');
      expect(normalizeMobileNumber('+91 8276071523')).toBe('918276071523');
    });

    test('leaves digits-only production format unchanged', () => {
      expect(normalizeMobileNumber('918276071523')).toBe('918276071523');
    });

    test('strips dashes and parentheses', () => {
      expect(normalizeMobileNumber('+91-82760-71523')).toBe('918276071523');
      expect(normalizeMobileNumber('(91) 8276071523')).toBe('918276071523');
    });

    test('returns empty string for nullish input', () => {
      expect(normalizeMobileNumber(null)).toBe('');
      expect(normalizeMobileNumber(undefined)).toBe('');
      expect(normalizeMobileNumber('')).toBe('');
    });
  });

  describe('mobileNumberVariants', () => {
    test('returns both canonical and +prefixed forms for lookups', () => {
      expect(mobileNumberVariants('+918276071523')).toEqual([
        '918276071523',
        '+918276071523'
      ]);
    });

    test('deduplicates when input is already canonical', () => {
      expect(mobileNumberVariants('918276071523')).toEqual([
        '918276071523',
        '+918276071523'
      ]);
    });

    test('returns empty array for blank input', () => {
      expect(mobileNumberVariants('')).toEqual([]);
      expect(mobileNumberVariants(null)).toEqual([]);
    });
  });

  describe('toStoredMobileNumber', () => {
    test('stores 10-digit local numbers as 91XXXXXXXXXX without +', () => {
      expect(toStoredMobileNumber('8276071523')).toBe('918276071523');
    });

    test('normalizes frontend E.164 payload to canonical storage', () => {
      expect(toStoredMobileNumber('+918276071523')).toBe('918276071523');
      expect(toStoredMobileNumber('918276071523')).toBe('918276071523');
    });

    test('handles leading zero local format', () => {
      expect(toStoredMobileNumber('08276071523')).toBe('918276071523');
    });
  });

  describe('frontend ↔ database contract', () => {
    const frontendLoginPayload = (tenDigits) => `+91${tenDigits}`;
    const productionDbRow = '918276071523';

    test('frontend +91 payload must resolve to the same user as digits-only DB row', () => {
      const sentByBrowser = frontendLoginPayload('8276071523');
      const lookupKeys = mobileNumberVariants(sentByBrowser);
      expect(lookupKeys).toContain(productionDbRow);
    });

    test('exact +91 DB row must still match frontend payload via variants', () => {
      const legacyDbRow = '+918276071523';
      const sentByBrowser = frontendLoginPayload('8276071523');
      const lookupKeys = mobileNumberVariants(sentByBrowser);
      expect(lookupKeys).toContain(legacyDbRow.replace(/^\+/, ''));
      expect(lookupKeys).toContain(legacyDbRow);
    });
  });
});
