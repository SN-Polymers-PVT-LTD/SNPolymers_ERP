// Suggestions for authoring only. Accounts confirms applicability and wage basis.
// Amounts remain decimal strings; existing revisions are never upgraded on read.
export const statutoryComponents = ['PACKAGE_BALANCE', 'DAILY_WAGE', 'OVERTIME', 'HOLIDAY_PREMIUM', 'ADJUSTMENTS'];
const unresolvedAdjustments = () => ({ SALARY_ARREARS: 'UNRESOLVED', BONUS: 'UNRESOLVED', REIMBURSEMENT: 'UNRESOLVED', RECOVERY: 'DEDUCTION_ONLY' });
export function newStatutoryConfiguration(scheme = 'EPF') {
  return {
    employee_rate: null, employer_rate: null,
    included_components: [], excluded_components: [...statutoryComponents],
    adjustment_basis: unresolvedAdjustments(),
    eligibility: scheme === 'PT' ? 'JURISDICTION_PROFILE' : scheme === 'ESI' ? 'ENROLLED_AND_WAGE_CEILING' : 'ENROLLED',
    calculation_method: scheme === 'PT' ? 'SLABS' : scheme === 'ESI' ? 'QUALIFYING_WAGE_PERCENTAGE' : 'CAPPED_WAGE_PERCENTAGE',
    eligibility_ceiling: null, wage_ceiling: null, contribution_minimum: null, contribution_cap: null,
    conditions: 'NONE', aggregation: 'CALENDAR_MONTH', effective_rule: 'MONTH_START',
    collection_timing: 'INCREMENTAL_MONTHLY', lop_wage_basis: 'PROPORTIONAL_COMPONENTS', arrears_period: 'CURRENT_RUN_MONTH',
    rounding: { method: scheme === 'ESI' ? 'UP' : 'HALF_UP', precision: 0, stage: 'MONTH' }
  };
}
const epfSource = 'https://www.pib.gov.in/PressReleasePage.aspx?PRID=2314111&lang=1&reg=3';
const esiSource = 'https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1574520&lang=2&reg=48';
export function statutoryPreset(scheme, date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || Number.isNaN(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date) return null;
  if (scheme === 'ESI' && date >= '2019-07-01') return {
    id: 'ESI-2019-07', title: 'ESI standard rates · from July 2019', source: esiSource,
    note: 'General ₹21,000 coverage threshold. Contribution-period continuation, disability coverage and employee-share exemptions need separate review; this monthly engine does not implement those exceptions.',
    values: { employee_rate: '0.75', employer_rate: '3.25', eligibility_ceiling: '21000', wage_ceiling: null, eligibility: 'ENROLLED_AND_WAGE_CEILING', calculation_method: 'QUALIFYING_WAGE_PERCENTAGE' },
    rounding: { method: 'UP', precision: 0, stage: 'MONTH' }
  };
  if (scheme !== 'EPF') return null;
  // No blanket preset for the temporary 2020 reduction or September 2026
  // transition: monthly rules cannot represent a mid-month statutory change.
  const historical = date >= '2014-09-01' && date < '2026-09-01' && !(date >= '2020-05-01' && date < '2020-08-01');
  if (!historical && date < '2026-10-01') return null;
  return {
    id: historical ? 'EPF-15000' : 'EPF-25000',
    title: historical ? 'EPF standard rates · ₹15,000 ceiling' : 'EPF standard rates · ₹25,000 ceiling',
    source: epfSource, reviewAfter: historical ? (date < '2020-05-01' ? '2020-04-30' : '2026-08-31') : null,
    note: 'Standard 12% rate; notified 10% establishments, higher-wage agreements and other exceptions require Accounts review. September 2026 needs separate transition review.',
    values: { employee_rate: '12', employer_rate: '12', wage_ceiling: historical ? '15000' : '25000', eligibility_ceiling: null, eligibility: 'ENROLLED', calculation_method: 'CAPPED_WAGE_PERCENTAGE' },
    rounding: { method: 'HALF_UP', precision: 0, stage: 'MONTH' }
  };
}
export function applyStatutoryPreset(data, preset) {
  return {
    ...data,
    configuration: { ...standardStatutorySettings(data).configuration, ...preset.values, rounding: { ...preset.rounding } },
  };
}
export function contributionBasis(included) {
  if (!included.length) return '';
  if (included.length === 1 && included[0] === 'PACKAGE_BALANCE') return 'GROSS_ONLY';
  if (included.length === 1 && included[0] === 'DAILY_WAGE') return 'DAILY_WAGE';
  return 'CUSTOM';
}
export function withContributionBasis(configuration, components) {
  return { ...configuration, included_components: components, excluded_components: statutoryComponents.filter(name => !components.includes(name)) };
}

// Confirmation metadata is server-owned, including when editing an older draft.
export function statutoryDraftInput(data) {
  const input = Object.fromEntries(Object.entries(data).filter(([key]) => !['verification_status','advisor_name','verification_reference','verified_on'].includes(key)));
  return { ...input, configuration: { ...input.configuration, excluded_components: input.configuration.excluded_components.filter(name => statutoryComponents.includes(name)), ...(input.configuration.adjustment_basis ? { adjustment_basis: { ...input.configuration.adjustment_basis, RECOVERY: 'DEDUCTION_ONLY' } } : {}) } };
}

// Explicit reset action only: opening/editing an existing rule never upgrades it.
export function standardStatutorySettings(data) {
  const defaults = newStatutoryConfiguration(data.scheme);
  const c = data.configuration;
  return { ...data, configuration: { ...c,
    eligibility: defaults.eligibility, calculation_method: defaults.calculation_method,
    conditions: defaults.conditions, rounding: { ...defaults.rounding },
    aggregation: defaults.aggregation, effective_rule: defaults.effective_rule,
    lop_wage_basis: defaults.lop_wage_basis, arrears_period: defaults.arrears_period,
    collection_timing: ['INCREMENTAL_MONTHLY', 'MONTH_CLOSE'].includes(c.collection_timing) ? c.collection_timing : defaults.collection_timing,
    wage_ceiling: data.scheme === 'EPF' ? c.wage_ceiling : null,
    eligibility_ceiling: data.scheme === 'ESI' ? c.eligibility_ceiling : null
  } };
}
