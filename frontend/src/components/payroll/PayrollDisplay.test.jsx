import React from 'react';
import { test, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SalaryPreview from './SalaryPreview';
import PayrollPayslip from './PayrollPayslip';

const preview = (overrides = {}) => ({
  employee: { employee_name: 'Synthetic employee', employee_code: 'TEST' },
  status: 'BLOCKED_STATUTORY', period_from: '2026-10-01', period_to: '2026-10-31',
  gross_after_lop: '29000.00', final_net_salary: null,
  earnings_total: '30000.000000', deductions_total: '1000.000000',
  employer_contributions_total: '0.000000', financial_readiness: false,
  earnings: [{ code: 'BASE', amount: '30000.00', source_ids: [] }],
  deductions: [{ code: 'LOP', amount: '1000.00', source_ids: [] }],
  blockers: [{ code: 'EMPLOYEE_STATUTORY_PROFILE_REQUIRED' }],
  monthly_reconciliation: [], statutory: [], enrolment: [], ...overrides,
});

test('diagnostic payslip has a nonofficial title and no certification signoff', () => {
  render(<PayrollPayslip payslip={{ official: false, calculation: preview() }} />);
  expect(screen.getByText(/Diagnostic Salary Preview — Not an Official Payslip/)).toBeInTheDocument();
  expect(screen.queryByText(/Official Salary Disbursement Voucher/)).not.toBeInTheDocument();
  expect(screen.queryByText('Prepared & Certified By:')).not.toBeInTheDocument();
});

test('official locked payslip remains separate from a payment voucher', () => {
  render(<PayrollPayslip payslip={{ official: true, review_status: 'LOCKED', payment_status: 'NOT_RECORDED', calculation: preview() }} />);
  expect(screen.getByText(/Official Locked Salary Payslip/)).toBeInTheDocument();
  expect(screen.getByText(/Immutable Locked financial snapshot/)).toHaveTextContent('Payment: NOT_RECORDED');
  expect(screen.queryByText(/Disbursement Voucher/)).not.toBeInTheDocument();
  expect(screen.getByText('Prepared & Certified By:')).toBeInTheDocument();
});

test('official payslip does not show the saved calculation readiness as its review status', () => {
  render(<PayrollPayslip payslip={{ official: true, review_status: 'LOCKED', payment_status: 'PAID', calculation: preview({status:'READY_FOR_REVIEW'}) }} />);
  expect(screen.queryByText(/ready for review/i)).not.toBeInTheDocument();
  expect(screen.getByText('LOCKED')).toBeInTheDocument();
  expect(screen.getByText('PAID')).toBeInTheDocument();
});

test('unresolved deduction lines do not become a zero total', () => {
  render(<SalaryPreview preview={preview({ deductions: [{ code: 'LOP', amount: null, source_ids: [] }], deductions_total: '0.000000' })} />);
  const header = screen.getByRole('heading', { name: 'deductions' }).parentElement;
  expect(header).toHaveTextContent('Total: unavailable');
  expect(header).not.toHaveTextContent('₹0');
  expect(screen.getByText('Rounding unresolved')).toBeInTheDocument();
});

test('known LOP with unresolved statutory deductions is labelled a subtotal', () => {
  render(<SalaryPreview preview={preview()} />);
  expect(screen.getByRole('heading', { name: 'deductions' }).parentElement)
    .toHaveTextContent('Known deduction subtotal: ₹1,000.00');
  expect(screen.getByText('Employer Statutory Total').parentElement).toHaveTextContent('unavailable');
  expect(screen.getByText('Employer Statutory Total').parentElement).not.toHaveTextContent('₹0');
  expect(screen.getByText(/Employer contributions:/)).toHaveTextContent('unavailable');
});

test('a complete documented zero contribution can be displayed as zero', () => {
  render(<SalaryPreview preview={preview({ financial_readiness: true, blockers: [], status: 'READY_FOR_REVIEW', final_net_salary: '29000.00' })} />);
  expect(screen.getByText('Employer Statutory Total').parentElement).toHaveTextContent('₹0.00');
  expect(screen.getByRole('heading', { name: 'deductions' }).parentElement).toHaveTextContent('Total: ₹1,000.00');
});

test('totals use backend decimal strings without float conversion or summation', () => {
  const exact = '9007199254740993.01';
  render(<SalaryPreview preview={preview({ gross_after_lop: exact, earnings_total: exact })} />);
  expect(screen.getByRole('heading', { name: 'earnings' }).parentElement).toHaveTextContent('Total: ₹9,00,71,99,25,47,40,993.01');
  expect(screen.getByText(`Gross after LOP: ₹9,00,71,99,25,47,40,993.01 · Final net: unavailable`)).toBeInTheDocument();
});

test('sub-paise amounts are rounded for display without changing source data', () => {
  render(<SalaryPreview preview={preview({ gross_after_lop: '0.005000', earnings_total: '0.005000' })} />);
  expect(screen.getByRole('heading', { name: 'earnings' }).parentElement).toHaveTextContent('Total: ₹0.01');
});

test('legacy preview without a total does not calculate one from its lines', () => {
  render(<SalaryPreview preview={preview({ earnings_total: undefined, deductions_total: undefined })} />);
  expect(screen.getByRole('heading', { name: 'earnings' }).parentElement).toHaveTextContent('Total: unavailable');
  expect(screen.getByRole('heading', { name: 'deductions' }).parentElement).toHaveTextContent('Known deduction subtotal: unavailable');
});


test('overtime displays code and amount cleanly without inline formula clutter', () => {
  render(
    <SalaryPreview
      preview={preview({
        earnings: [
          {
            code: 'OVERTIME',
            date: '2026-10-02',
            amount: '96.16',
            source_ids: ['attendance', 'pay'],
            calculation: {
              monthly_gross: '10000.00',
              salary_days: '26.0000',
              standard_duty_hours: '8.0000',
              daily_rate: '384.62',
              hourly_rate: '48.08',
              hours: '2.0000',
              multiplier: '1.0000',
              rounding: 'Half up to two decimals at daily, hourly and amount stages'
            }
          }
        ]
      })}
    />
  );
  expect(screen.getByText(/Overtime/)).toBeInTheDocument();
  expect(screen.getByText('₹96.16')).toBeInTheDocument();
  expect(screen.queryByText(/duty hours/)).not.toBeInTheDocument();
  expect(screen.queryByText('Source References')).not.toBeInTheDocument();
});

test('official payslip shows the recorded Accounts recipient over missing employee setup',()=>{
 const calculation=preview({beneficiary:{status:'MISSING'},financial_readiness:true});
 render(<PayrollPayslip payslip={{official:true,review_status:'LOCKED',payment_status:'PAID',calculation,payment_recipient:{status:'RECORDED',beneficiary_name:'Recorded salary recipient',masked_account_number:'****1234',ifsc:'TEST0000001',bank_name:'Test bank'}}}/>);
 expect(screen.getByRole('heading',{name:'Payment recipient'})).toBeInTheDocument();
 expect(screen.getAllByText(/Recorded salary recipient/).length).toBeGreaterThan(0);
 expect(screen.queryByText(/Beneficiary details missing/)).not.toBeInTheDocument();
 expect(calculation.beneficiary.status).toBe('MISSING');
});
