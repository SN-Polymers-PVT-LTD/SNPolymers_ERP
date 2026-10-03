import { describe, expect, test, beforeEach, vi } from 'vitest';
import {
  expandCompletedFundReturn,
  fullLedgerRequisitionHeaders,
  buildFullLedgerRequisitionRow
} from './exportHelpers';

describe('expandCompletedFundReturn', () => {
  test('falls back to the single work order when breakdown is absent', () => {
    const rows = expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 1250 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ workOrder: 'WO-1', amount: 1250 });
  });

  test('expands and preserves a valid multi-work-order breakdown', () => {
    const rows = expandCompletedFundReturn({
      status: 'Completed', requested_amount: 300,
      breakdown: [{ work_order_no: 'WO-1', amount: 100 }, { work_order_no: 'WO-2', amount: 200 }]
    });
    expect(rows.map(row => row.amount)).toEqual([100, 200]);
  });

  test('does not hide a malformed non-empty breakdown behind the fallback', () => {
    expect(expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 300, breakdown: [{ work_order_no: 'WO-1', amount: 100 }] })).toEqual([]);
  });

  test('defaults paymentOffice to ZO Office when payment_destination is absent', () => {
    const rows = expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 500 });
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentOffice).toBe('ZO Office');
  });

  test('formats paymentOffice according to payment_destination when present', () => {
    const rows = expandCompletedFundReturn({ status: 'Completed', work_order_no: 'WO-1', requested_amount: 500, payment_destination: 'ACCOUNTS' });
    expect(rows).toHaveLength(1);
    expect(rows[0].paymentOffice).toBe('HO Office');
  });
});

describe('full subcontractor ledger requisition export contract', () => {
  test('keeps headers aligned with financial row values', () => {
    const row = buildFullLedgerRequisitionRow({
      requisition_no: 'REQ-001',
      work_order_no: 'WO-001',
      material_details: 'Vendor A',
      material_sub_head: 'Civil',
      requisition_status: 'Approved',
      payment_status: 'PARTIALLY_PAID',
      payment_destination: 'ACCOUNTS',
      requisition_amount: 50000,
      approved_amount: 45000,
      paid_amount: 30000,
      requester_name: 'JE'
    });

    expect(fullLedgerRequisitionHeaders.length).toBe(row.length);
    expect(row[fullLedgerRequisitionHeaders.indexOf('Payment Status')]).toBe('PARTIALLY_PAID');
    expect(row[fullLedgerRequisitionHeaders.indexOf('Payment Office')]).toBe('HO Office');
    expect(row[fullLedgerRequisitionHeaders.indexOf('Effective Liability (INR)')]).toBe(30000);
    expect(row[fullLedgerRequisitionHeaders.indexOf('Paid Amount (INR)')]).toBe(30000);
  });
});

const mockAppendSheet = vi.fn();
const mockWriteFile = vi.fn();
const mockJsonToSheet = vi.fn((json) => ({ json }));

vi.mock('xlsx', () => ({
  utils: {
    book_new: () => ({ SheetNames: [], Sheets: {} }),
    aoa_to_sheet: (aoa) => ({ aoa }),
    json_to_sheet: (json) => mockJsonToSheet(json),
    book_append_sheet: (...args) => mockAppendSheet(...args)
  },
  writeFile: (...args) => mockWriteFile(...args)
}));

describe('exportAllSubcontractorLedgersToExcel', () => {
  beforeEach(() => {
    mockAppendSheet.mockClear();
    mockWriteFile.mockClear();
    mockJsonToSheet.mockClear();
  });

  test('includes Requisitions sheet when requisitions array is non-empty', async () => {
    const { exportAllSubcontractorLedgersToExcel } = await import('./exportHelpers');

    await exportAllSubcontractorLedgersToExcel(
      [{ ledger_id: 1, work_order_no: 'WO-001', amount: -1000 }],
      [{ work_order_no: 'WO-001', approved_scope: 10000 }],
      [{
        requisition_no: 'REQ-001',
        work_order_no: 'WO-001',
        material_details: 'Vendor A',
        material_sub_head: 'Civil',
        requisition_status: 'Approved',
        payment_status: 'PAID',
        requisition_amount: 1000,
        approved_amount: 1000,
        paid_amount: 1000
      }]
    );

    const sheetNames = mockAppendSheet.mock.calls.map((call) => call[2]);
    expect(sheetNames).toContain('Ledger Transactions');
    expect(sheetNames).toContain('Balances Summary');
    expect(sheetNames).toContain('Requisitions');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });

  test('omits Requisitions sheet when requisitions array is empty', async () => {
    const { exportAllSubcontractorLedgersToExcel } = await import('./exportHelpers');

    await exportAllSubcontractorLedgersToExcel(
      [{ ledger_id: 1, work_order_no: 'WO-001', amount: -1000 }],
      [{ work_order_no: 'WO-001', approved_scope: 10000 }],
      []
    );

    const sheetNames = mockAppendSheet.mock.calls.map((call) => call[2]);
    expect(sheetNames).toContain('Ledger Transactions');
    expect(sheetNames).toContain('Balances Summary');
    expect(sheetNames).not.toContain('Requisitions');
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});

describe('employee and permanent pay structure export contracts', () => {
  beforeEach(() => {
    mockAppendSheet.mockClear();
    mockWriteFile.mockClear();
    mockJsonToSheet.mockClear();
  });

  test('exportEmployeesToExcel maps 9 approved columns to Employee Master sheet', async () => {
    const { exportEmployeesToExcel } = await import('./exportHelpers');
    await exportEmployeesToExcel([
      {
        employee_code: 'EMP-001',
        employee_name: 'John Doe',
        employee_category: 'HO Staff',
        department: 'Head Office',
        contact_number: '9876543210',
        erp_user: { role: 'admin', display_name: 'John Admin' },
        joining_date: '2026-01-01',
        active_status: 'Active'
      }
    ]);

    expect(mockJsonToSheet).toHaveBeenCalledWith([
      {
        "Sl. No.": 1,
        "Employee ID": 'EMP-001',
        "Employee Name": 'John Doe',
        "Employee Category": 'HO Staff',
        "Department / Function": 'Head Office',
        "Contact Number": '9876543210',
        "Existing ERP Role": 'admin',
        "Existing ERP Account": 'John Admin (admin)',
        "Joining Date": '2026-01-01',
        "Active Status": 'Active'
      }
    ]);
    expect(mockAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Employee & Worker Master');
    expect(mockWriteFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^Employee_Master_/));
  });

  test('exportPermanentPayStructuresToExcel maps 11 approved fields to Permanent Pay Structure sheet', async () => {
    const { exportPermanentPayStructuresToExcel } = await import('./exportHelpers');
    await exportPermanentPayStructuresToExcel([
      {
        employee_code: 'EMP-001',
        employee_name: 'John Doe',
        employee_category: 'HO Staff',
        active_structure: {
          pay_basis: 'Special package',
          guaranteed_monthly_gross: 50000,
          basic_salary: 45000,
          staff_welfare: 5000,
          other_fixed_components: 0,
          epf_enrolment: true,
          esi_enrolment: false,
          status: 'Active'
        }
      }
    ]);

    expect(mockJsonToSheet).toHaveBeenCalledWith([
      {
        "Sl. No.": 1,
        "Employee ID": 'EMP-001',
        "Employee Name": 'John Doe',
        "Permanent Employee Category": 'HO Staff',
        "Pay Basis": 'Special package',
        "Guaranteed Monthly Gross (₹)": 50000,
        "Basic Salary (₹/month)": 45000,
        "Staff Welfare (₹/month)": 5000,
        "Other Fixed Components (₹/month)": 0,
        "EPF Enrolment": 'Enrolled',
        "ESI Enrolment": 'Not enrolled',
        "Pay Structure Status": 'Active'
      }
    ]);
    expect(mockAppendSheet).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'Permanent Pay Structure');
    expect(mockWriteFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^Permanent_Pay_Structures_/));
  });

  test('exportAllEmployeeSheetsToExcel exports single workbook with both sheets', async () => {
    const { exportAllEmployeeSheetsToExcel } = await import('./exportHelpers');
    await exportAllEmployeeSheetsToExcel(
      [{ employee_code: 'EMP-001', employee_name: 'John Doe', employee_category: 'HO Staff', active_status: 'Active' }],
      [{ employee_code: 'EMP-001', employee_name: 'John Doe', employee_category: 'HO Staff', active_structure: { guaranteed_monthly_gross: 50000, status: 'Active' } }]
    );

    const sheetNames = mockAppendSheet.mock.calls.map(c => c[2]);
    expect(sheetNames).toContain('Employee & Worker Master');
    expect(sheetNames).toContain('Permanent Pay Structure');
    expect(mockWriteFile).toHaveBeenCalledWith(expect.anything(), expect.stringMatching(/^SN_Polymers_Employee_Master_and_Pay_/));
  });
});
