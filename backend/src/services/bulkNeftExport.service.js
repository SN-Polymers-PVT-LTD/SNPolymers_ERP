const ExcelJS = require('exceljs');
const { numberToIndianWords } = require('../utils/numberToIndianWords');

// Column widths, accounting number format, and static text below are copied
// verbatim from the 'Bulk Sheet 1' tab of accounts/BULK NEFT.xlsx — the real
// bank-authorization-letter template this function reproduces. Do not
// paraphrase any of the static strings; they are a bank-facing legal letter.
const COLUMN_WIDTHS = { A: 9.29, B: 27.29, C: 20.86, D: 25.0, E: 15.14, F: 14.86 };
const ACCOUNTING_FORMAT = '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)';
const TEXT_FORMAT = '@';
const CAMBRIA = 'Cambria';

const THIN = { style: 'thin' };
const MEDIUM = { style: 'medium' };

const TERMS_AND_CONDITIONS = [
  '1.   I/We agree that credit will be effected based solely on the beneficiary account number information provided by me/us and the beneficiary name particulars will not be used.',
  '2. I/We hereby authroised Canara bank to carry out the RTGS transactions as per the details  mentioned overleaf.',
  '3. I/We understand RTGS request is subject to the RBI regulations and guidelines governing the same.',
  '4. I/We authorise the Bank to debit my/our account for the charges plus charges taxes as applicable.',
  '5. I/We hereby aeree that aforesaid details including the IFSC code and beneficiary account are correct. I/We further acknowledge that Canara Bank accepts no liability for any consepuences arising out of erroneous details provide by me/us. '
];

/**
 * Derives the "our XXX A/c" wording fragment from the debited account's name
 * suffix. CANARA SNP CA / CANARA Esenco Fab CA end in "CA" (Current
 * Account); CANARA SNP CC ends in "CC" (Cash Credit) — these are the only
 * two account-type abbreviations this company's account names use, so the
 * suffix itself is an unambiguous signal, not a guess. Any future account
 * name that doesn't end in either token falls back to the blank template's
 * own default wording ("C A").
 */
function debitAccountWording(debitBankAcType) {
  const trimmed = (debitBankAcType || '').trim().toUpperCase();
  if (/\bCC$/.test(trimmed)) return 'CC';
  return 'C A';
}

function setCell(ws, addr, value, { bold = false, size = 11, align, valign, wrap, border } = {}) {
  const cell = ws.getCell(addr);
  cell.value = value;
  cell.font = { name: CAMBRIA, size, bold };
  if (align || valign || wrap !== undefined) {
    cell.alignment = { horizontal: align, vertical: valign, wrapText: wrap };
  }
  if (border) cell.border = border;
  return cell;
}

/**
 * Builds the single-sheet 'Bulk Sheet 1' workbook: static letterhead (rows
 * 12-22) → header row (24) → one data row per item (25..) → Total row with
 * =SUM() over the actual data range → static Terms & Conditions + signature
 * block. Row count is exactly items.length, not the blank template's
 * incidental 9 pre-formatted rows.
 *
 * @param {Array<{beneficiary_name, beneficiary_ac_no, beneficiary_bank_name, beneficiary_ifsc, amount}>} items
 * @param {string} debitBankAcType - e.g. 'CANARA SNP CA'
 * @param {string} debitAccountNumber - bank_balance_master.account_number for that account
 */
function buildBulkNeftWorkbook({ items, debitBankAcType, debitAccountNumber }) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('buildBulkNeftWorkbook requires at least one item.');
  }

  const workbook = new ExcelJS.Workbook();
  const ws = workbook.addWorksheet('Bulk Sheet 1');

  ws.columns = ['A', 'B', 'C', 'D', 'E', 'F'].map(key => ({ key, width: COLUMN_WIDTHS[key] }));

  // --- Letterhead / salutation (rows 12-22, fixed regardless of row count) ---
  setCell(ws, 'A12', 'TO', { bold: true, size: 10 });
  setCell(ws, 'A13', 'The Branch Manager,', { bold: true });
  setCell(ws, 'E13', 'Date :    ', { bold: true, align: 'center', valign: 'top' });
  ws.mergeCells('E13:F13');
  setCell(ws, 'A14', 'Canara Bank,', { bold: true });
  setCell(ws, 'A15', 'SME Branch,');
  setCell(ws, 'A16', 'Sevoke Road, Siliguri -1.');
  setCell(ws, 'C18', 'Sub: Multiple / NEFT/Transfer  Payment.', { bold: true });
  setCell(ws, 'A19', 'Dear Sir,', { align: 'left' });
  setCell(ws, 'B20', 'Please remit the following payments to the respective bank accounts as mentioned below.', { align: 'left' });
  const wording = debitAccountWording(debitBankAcType);
  setCell(ws, 'A21', ` Kindly remit the amount after debiting the said amount from our ${wording} A/c  `);
  setCell(ws, 'A22', `Vide Number ${debitAccountNumber} of S. N. Polymers Pvt. Ltd.`);

  // --- Data table header (row 24, fixed) ---
  const HEADER_ROW = 24;
  const headerBorder = (col) => ({
    top: MEDIUM,
    bottom: THIN,
    left: col === 'A' ? MEDIUM : THIN,
    right: col === 'F' ? MEDIUM : THIN
  });
  const headers = { A: 'Sl. No.', B: 'Beneficiary Name', C: 'Account  No.', D: 'Bank Name', E: 'IFSC Code', F: 'Amount' };
  Object.entries(headers).forEach(([col, text]) => {
    setCell(ws, `${col}${HEADER_ROW}`, text, {
      bold: true,
      size: col === 'A' ? 9 : 11,
      align: 'center',
      valign: 'center',
      wrap: col === 'A',
      border: headerBorder(col)
    });
  });

  // --- Data rows (exactly one per item) ---
  const FIRST_DATA_ROW = HEADER_ROW + 1;
  const lastDataRow = FIRST_DATA_ROW + items.length - 1;

  items.forEach((item, idx) => {
    const row = FIRST_DATA_ROW + idx;
    const dataBorder = (col) => ({
      top: THIN,
      bottom: THIN,
      left: col === 'A' ? MEDIUM : THIN,
      right: col === 'F' ? MEDIUM : THIN
    });

    setCell(ws, `A${row}`, idx + 1, { align: 'center', border: dataBorder('A') });
    setCell(ws, `B${row}`, item.beneficiary_name || '', { border: dataBorder('B') });

    // Account number & IFSC written as text (not numeric) so leading zeros in
    // real Indian bank account numbers survive — see service-level doc note.
    const acNoCell = setCell(ws, `C${row}`, String(item.beneficiary_ac_no ?? ''), { align: 'center', border: dataBorder('C') });
    acNoCell.numFmt = TEXT_FORMAT;

    setCell(ws, `D${row}`, item.beneficiary_bank_name || '', { align: 'center', border: dataBorder('D') });

    const ifscCell = setCell(ws, `E${row}`, String(item.beneficiary_ifsc ?? ''), { border: dataBorder('E') });
    ifscCell.numFmt = TEXT_FORMAT;

    const amountCell = setCell(ws, `F${row}`, Number(item.amount) || 0, { align: 'center', border: dataBorder('F') });
    amountCell.numFmt = ACCOUNTING_FORMAT;
  });

  // --- Total row ---
  const totalRow = lastDataRow + 1;
  const totalAmount = items.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const totalBorder = { top: MEDIUM, bottom: MEDIUM, left: MEDIUM, right: MEDIUM };

  ws.mergeCells(`A${totalRow}:E${totalRow}`);
  setCell(ws, `A${totalRow}`, `Total = (${numberToIndianWords(totalAmount)} Only )`, {
    bold: true, align: 'center', border: totalBorder
  });

  const sumCell = setCell(ws, `F${totalRow}`, { formula: `SUM(F${FIRST_DATA_ROW}:F${lastDataRow})` }, {
    bold: true, size: 10, align: 'right', border: totalBorder
  });
  sumCell.numFmt = ACCOUNTING_FORMAT;

  // --- Terms & Conditions + signature block ---
  const termsHeaderRow = totalRow + 1;
  ws.mergeCells(`A${termsHeaderRow}:F${termsHeaderRow}`);
  setCell(ws, `A${termsHeaderRow}`, 'TERMS & CONDITIONS', { bold: true, size: 7, align: 'center', valign: 'center' });

  TERMS_AND_CONDITIONS.forEach((text, idx) => {
    const row = termsHeaderRow + 1 + idx;
    ws.mergeCells(`A${row}:F${row}`);
    setCell(ws, `A${row}`, text, { size: 8, align: 'left', valign: 'top', wrap: true });
  });

  const signatureRow = termsHeaderRow + 1 + TERMS_AND_CONDITIONS.length;
  setCell(ws, `B${signatureRow}`, 'Thanking You', { size: 9 });
  ws.mergeCells(`E${signatureRow}:F${signatureRow}`);
  setCell(ws, `E${signatureRow}`, 'Yours faithfully', { size: 9, align: 'center' });

  return workbook;
}

module.exports = { buildBulkNeftWorkbook, debitAccountWording };
