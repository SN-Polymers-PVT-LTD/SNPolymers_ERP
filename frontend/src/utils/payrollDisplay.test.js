import {test,expect} from 'vitest';
import {formatINR,payrollLineName} from './payrollDisplay';
test('money display uses two decimals without losing large-integer precision',()=>{
 expect(formatINR('9007199254740993.010000')).toBe('₹9,00,71,99,25,47,40,993.01');
 expect(formatINR('999.995')).toBe('₹1,000.00');
 expect(formatINR('0.005000')).toBe('₹0.01');
 expect(formatINR('-12.345')).toBe('-₹12.35');
 expect(formatINR(null)).toBeNull();
 expect(formatINR('0.000000')).toBe('₹0.00');
});
test('salary line codes have user-facing labels',()=>{
 expect(payrollLineName('CONTRACTUAL_BASE')).toBe('Monthly salary');
 expect(payrollLineName('HOLIDAY_PREMIUM')).toBe('Holiday duty pay');
 expect(payrollLineName('LOP')).toBe('Unpaid leave');
});
