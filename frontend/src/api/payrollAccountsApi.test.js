import { beforeEach, expect, test, vi } from 'vitest';
import authApi from './authApi';
import { getFullPayrollAccountsSheet } from './payrollAccountsApi';

vi.mock('./authApi', () => ({ default: { get: vi.fn() } }));

const payload = rows => ({ data: { payroll: { sheet: { id: 'sheet' }, rows, total: 51 } } });
const firstPage = Array.from({ length: 50 }, (_, index) => ({ id: String(index) }));

beforeEach(() => vi.resetAllMocks());

test('loads every payroll export page in sheet order', async () => {
  authApi.get.mockResolvedValueOnce(payload(firstPage)).mockResolvedValueOnce(payload([{ id: '50' }]));
  const result = await getFullPayrollAccountsSheet('sheet');
  expect(result.rows).toEqual([...firstPage, { id: '50' }]);
  expect(authApi.get.mock.calls).toEqual([
    ['/hr/payroll/accounts/sheets/sheet', { params: { page: 1, limit: 50 } }],
    ['/hr/payroll/accounts/sheets/sheet', { params: { page: 2, limit: 50 } }],
  ]);
});

test('rejects duplicate rows caused by changes between export pages', async () => {
  authApi.get.mockResolvedValueOnce(payload(firstPage)).mockResolvedValueOnce(payload([{ id: '49' }]));
  await expect(getFullPayrollAccountsSheet('sheet')).rejects.toThrow('Please retry');
});
