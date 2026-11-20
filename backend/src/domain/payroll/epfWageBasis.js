const D = require('./exact');
const { signed } = require('./adjustments');

const inputs = ['regular', 'excluded'];
const read = value => D.fraction(BigInt(value.numerator), BigInt(value.denominator));

function calculateEpfWageBasis({ source, month, prior, pay, paidBase, earnings }) {
  const candidates = (source.epf_wage_bases || []).filter(basis => basis.effective_from <= month);
  if (!candidates.length && !prior.some(entry => entry.epf_wage_inputs)) return null;

  if (prior.some(entry => !entry.epf_wage_inputs)) return { blocker: 'EPF_WAGE_BASIS_CHANGED_WITHIN_MONTH' };
  const basis = candidates.filter(item => item.pay_structure_id === pay?.id)
    .sort((left, right) => right.effective_from.localeCompare(left.effective_from))[0];
  if (basis?.pending_accounts_confirmation) return { blocker: 'EPF_WAGE_BASIS_CONFIRMATION_REQUIRED' };
  if (!basis) return { blocker: 'EPF_REGULAR_WAGES_REQUIRED' };
  if (earnings.some(line => line.amount === null ||
    (line.code !== 'CONTRACTUAL_BASE' && line.code !== 'OVERTIME' && signed(line.amount).n !== 0n))) {
    return { blocker: 'EPF_EXTRA_EARNINGS_CLASSIFICATION_REQUIRED' };
  }
  const gross = D.decimal(pay.guaranteed_monthly_gross);
  const regular = gross.n ? D.mul(D.decimal(basis.regular_wages), D.div(paidBase, gross)) : D.zero();
  const overtime = D.sum(earnings.filter(line => line.code === 'OVERTIME').map(line => signed(line.amount)));
  const excluded = D.add(D.sub(paidBase, regular), overtime);
  if (excluded.n < 0n || regular.n < 0n) return { blocker: 'NEGATIVE_STATUTORY_WAGE' };
  const amounts = { regular, excluded };
  const monthly = Object.fromEntries(inputs.map(key => [
    key, D.sum([amounts[key], ...prior.map(entry => read(entry.epf_wage_inputs[key]))]),
  ]));
  const half = D.div(D.add(monthly.regular, monthly.excluded), D.fraction(2n));
  const excess = D.sub(monthly.excluded, half);
  const addback = excess.n > 0n ? excess : D.zero();
  return {
    monthlyWage: D.add(monthly.regular, addback),
    inputs: Object.fromEntries(inputs.map(key => [key, D.reference(amounts[key])])),
    explanation: { regular: D.reference(monthly.regular), excluded: D.reference(monthly.excluded), addback: D.reference(addback) },
  };
}

module.exports = { calculateEpfWageBasis };
