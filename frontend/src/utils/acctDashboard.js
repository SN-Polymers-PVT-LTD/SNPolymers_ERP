export const countSheetsByStatus = (sheets = [], status) =>
  sheets.filter(s => s.sheet_status === status).length;

export const sumBankBalances = (bankBalances = []) =>
  bankBalances.reduce((sum, b) => sum + Number(b.available_balance || 0), 0);
