import { describe, it, expect } from 'vitest';
import { buildSheetCsv } from './acctSheetCsv';

const sheet = { sheet_number: '19082026-1' };

describe('buildSheetCsv — full plain-CSV dump of a sheet\'s line items', () => {
  it('includes the sheet number and a plain dd/mm/yyyy created date, not a timestamp', () => {
    const items = [
      {
        particulars: 'AMC Charges', account_sub_title_text: 'Maintenance',
        beneficiary_name: 'shreyan ghosh', beneficiary_ac_no: '11202030553033', beneficiary_ifsc: 'HDFC0000106',
        beneficiary_bank_name: 'HDFC Bank', debit_bank_ac_type: 'CANARA SNP CA',
        req_amount: 1000, payment_mode: 'NEFT', requisition_status: 'Approved',
        ho_pass_amount: 1000, ho_remarks: null,
        created_at: '2026-08-19T08:00:00Z', updated_at: '2026-08-19T09:00:00Z', ho_actioned_at: '2026-08-19T09:00:00Z'
      }
    ];

    const csv = buildSheetCsv(sheet, items);
    const [header, row] = csv.split('\r\n');

    expect(header).toContain('Sheet Number');
    expect(header).toContain('Created Date');
    expect(row).toContain('19082026-1');
    expect(row).toContain('AMC Charges');
    expect(row).toContain('19/08/2026');
    expect(row).not.toContain('2026-08-19T08:00:00Z');
  });

  it('drops Updated At and HO Actioned At entirely — not needed in the export', () => {
    const csv = buildSheetCsv(sheet, [{ particulars: 'x' }]);
    const header = csv.split('\r\n')[0];

    expect(header).not.toContain('Updated At');
    expect(header).not.toContain('HO Actioned At');
  });

  it('produces just the header row when there are no items', () => {
    const csv = buildSheetCsv(sheet, []);
    expect(csv.split('\r\n')).toHaveLength(1);
  });

  it('quotes and escapes fields containing commas, quotes, or newlines', () => {
    const items = [
      { particulars: 'Charge, with a comma', ho_remarks: 'Said "no" to this\nsecond line', requisition_status: 'Rejected' }
    ];
    const csv = buildSheetCsv(sheet, items);
    const row = csv.split('\r\n')[1];

    expect(row).toContain('"Charge, with a comma"');
    expect(row).toContain('"Said ""no"" to this\nsecond line"');
  });

  it('renders a missing/null field as an empty CSV cell, not "null" or "undefined"', () => {
    const items = [{ particulars: 'No beneficiary yet', requisition_status: null, created_at: null }];
    const csv = buildSheetCsv(sheet, items);
    const row = csv.split('\r\n')[1];

    expect(row).not.toContain('null');
    expect(row).not.toContain('undefined');
    // Status falls back to 'Draft' when requisition_status is null:
    expect(row).toContain('Draft');
  });
});
