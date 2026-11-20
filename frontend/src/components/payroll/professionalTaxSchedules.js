export const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const rowsFor = (slabs, m) => slabs.filter(s => s.month === m).map(({ lower_bound, upper_bound, deduction_amount }) => ({ lower_bound, upper_bound, deduction_amount }));
export const amountKey = v => v === null ? null : String(v).replace(/^0+(?=\d)/, '').replace(/(\.\d*?[1-9])0+$|\.0+$/, '$1');
export const same = (a, b) => JSON.stringify(a.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, amountKey(v)])))) === JSON.stringify(b.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, amountKey(v)]))));

export function groupProfessionalTaxSchedules(slabs) {
  const groups = [];
  months.forEach((month, index) => {
    const rows = rowsFor(slabs, index + 1);
    const group = groups.find(item => same(item.rows, rows));
    if (group) group.months.push(month);
    else groups.push({ months: [month], rows });
  });
  return groups;
}

export function formatIndianCurrency(val) {
  if (val === null || val === undefined || val === '') return '';
  const str = String(val);
  const clean = str.replace(/,/g, '');
  if (!clean) return '';

  const hasTrailingDot = clean.endsWith('.');
  const [intPart, ...decParts] = clean.split('.');

  let formattedInt = intPart;
  if (intPart.length > 3) {
    const lastThree = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    formattedInt = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + lastThree;
  }

  if (decParts.length > 0) {
    return formattedInt + '.' + decParts.join('');
  }
  if (hasTrailingDot) {
    return formattedInt + '.';
  }
  return formattedInt;
}
