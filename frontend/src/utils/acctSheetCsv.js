import { formatDateDDMMYYYY } from './dateUtils';

const escapeCsvField = (val) => {
  if (val == null) return '';
  const str = String(val);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};

const CSV_COLUMNS = [
  ['Sheet Number', (item, sheet) => sheet.sheet_number],
  ['Particulars', (item) => item.particulars],
  ['Account Sub-title', (item) => item.account_sub_title_text],
  ['Beneficiary Name', (item) => item.beneficiary_name],
  ['Beneficiary A/C No', (item) => item.beneficiary_ac_no],
  ['Beneficiary IFSC', (item) => item.beneficiary_ifsc],
  ['Beneficiary Bank', (item) => item.beneficiary_bank_name],
  ['Debit Bank', (item) => item.debit_bank_ac_type],
  ['Requested Amount', (item) => item.req_amount],
  ['Payment Mode', (item) => item.payment_mode],
  ['Cheque No', (item) => item.cheque_no],
  ['Cheque Date', (item) => item.cheque_date],
  ['WO. No.', (item) => item.work_order_no],
  ['Remarks', (item) => item.remarks],
  ['Status', (item) => item.requisition_status || 'Draft'],
  ['HO Pass Amount', (item) => item.ho_pass_amount],
  ['HO Remarks', (item) => item.ho_remarks],
  ['Created Date', (item) => formatDateDDMMYYYY(item.created_at)]
];

// Shared by the Accounts entry page and the HO review page — both offer the
// same "dump the whole sheet" export, just from different screens.
export const buildSheetCsv = (sheet, items) => {
  const headerRow = CSV_COLUMNS.map(([label]) => label);
  const dataRows = items.map((item) => CSV_COLUMNS.map(([, getValue]) => getValue(item, sheet)));
  return [headerRow, ...dataRows].map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
};
