import { describe, test, expect } from 'vitest';
const { numberToIndianWords } = require('../../../src/utils/numberToIndianWords');

describe('numberToIndianWords', () => {
  test('zero', () => {
    expect(numberToIndianWords(0)).toBe('Zero');
  });

  test('small amount under a thousand', () => {
    expect(numberToIndianWords(100)).toBe('One Hundred');
  });

  test('plain thousands case (below the lakh boundary)', () => {
    expect(numberToIndianWords(45000)).toBe('Forty Five Thousand');
  });

  test('lakhs case (Indian grouping, not Western thousands)', () => {
    expect(numberToIndianWords(249980)).toBe('Two Lakh Forty Nine Thousand Nine Hundred Eighty');
  });

  test('lakh boundary value', () => {
    expect(numberToIndianWords(100000)).toBe('One Lakh');
  });

  test('crores case (Indian grouping past the lakh boundary)', () => {
    expect(numberToIndianWords(12345678)).toBe('One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight');
  });

  test('crore boundary value', () => {
    expect(numberToIndianWords(10000000)).toBe('One Crore');
  });

  test('appends paise wording when the amount has a non-zero decimal remainder', () => {
    expect(numberToIndianWords(1234.5)).toBe('One Thousand Two Hundred Thirty Four and Fifty Paise');
  });

  test('drops paise wording entirely for a whole-rupee amount', () => {
    expect(numberToIndianWords(1234.0)).toBe('One Thousand Two Hundred Thirty Four');
  });

  test('accepts a numeric string (as Postgres numeric columns arrive over the wire)', () => {
    expect(numberToIndianWords('50000.00')).toBe('Fifty Thousand');
  });
});
