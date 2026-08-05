import { describe, it, expect } from 'vitest';
import { parseCurrencyString, formatIndianCurrency } from './currencyFormatter';

describe('currencyFormatter — parseCurrencyString', () => {
  it('should parse standard numeric string', () => {
    expect(parseCurrencyString('150000')).toBe('150000');
  });

  it('should parse numeric string with single decimal', () => {
    expect(parseCurrencyString('150000.5')).toBe('150000.5');
    expect(parseCurrencyString('150000.50')).toBe('150000.50');
  });

  it('should strip currency symbols and commas', () => {
    expect(parseCurrencyString('₹1,50,000')).toBe('150000');
    expect(parseCurrencyString('₹1,50,000.25')).toBe('150000.25');
  });

  it('should clean leading zeros correctly', () => {
    expect(parseCurrencyString('0001500')).toBe('1500');
    expect(parseCurrencyString('0001500.50')).toBe('1500.50');
    expect(parseCurrencyString('0.05')).toBe('0.05');
    expect(parseCurrencyString('00.05')).toBe('0.05');
  });

  it('should return empty string for single dot', () => {
    expect(parseCurrencyString('.')).toBe('');
  });

  it('should handle negative numbers correctly based on allowNegative option', () => {
    // allowNegative: false (default)
    expect(parseCurrencyString('-1500')).toBe('1500');
    expect(parseCurrencyString('-.5')).toBe('0.5');

    // allowNegative: true
    expect(parseCurrencyString('-1500', { allowNegative: true })).toBe('-1500');
    expect(parseCurrencyString('-.5', { allowNegative: true })).toBe('-0.5');
  });

  it('should strip scientific notation E character and not crash', () => {
    expect(parseCurrencyString('1e6')).toBe('16');
  });

  it('should handle multiple symbols and garbage text gracefully', () => {
    expect(parseCurrencyString('₹₹100')).toBe('100');
    expect(parseCurrencyString('1..2.3')).toBe('1.23');
  });

  it('should return empty string for empty inputs', () => {
    expect(parseCurrencyString('')).toBe('');
    expect(parseCurrencyString(null)).toBe('');
    expect(parseCurrencyString(undefined)).toBe('');
  });
});

describe('currencyFormatter — formatIndianCurrency', () => {
  it('should format standard integer correctly into en-IN locale', () => {
    expect(formatIndianCurrency('150000')).toBe('1,50,000');
    expect(formatIndianCurrency('1500')).toBe('1,500');
  });

  it('should preserve decimal suffix exactly as typed', () => {
    expect(formatIndianCurrency('150000.5')).toBe('1,50,000.5');
    expect(formatIndianCurrency('150000.50')).toBe('1,50,000.50');
  });

  it('should handle negative numbers formatting', () => {
    expect(formatIndianCurrency('-1500')).toBe('-1,500');
    expect(formatIndianCurrency('-0.5')).toBe('-0.5');
  });

  it('should return empty string for empty/invalid inputs', () => {
    expect(formatIndianCurrency('')).toBe('');
    expect(formatIndianCurrency(null)).toBe('');
    expect(formatIndianCurrency(undefined)).toBe('');
  });
});
