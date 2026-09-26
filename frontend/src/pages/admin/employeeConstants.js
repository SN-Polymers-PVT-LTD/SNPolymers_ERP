export const CATEGORIES = [
  'HO Staff',
  'Fabric Factory Permanent Employees',
  'SNP Casual Factory Labour',
  'SNP Permanent Factory Labour',
  'Projects Department Employees',
  'Local Daily-Wage Workers'
];

export const PERMANENT_CATEGORIES = new Set([
  'HO Staff',
  'Fabric Factory Permanent Employees',
  'SNP Permanent Factory Labour',
  'Projects Department Employees'
]);

export const DEPARTMENTS = [
  'Head Office',
  'Fabric Factory',
  'SNP Factory',
  'Projects'
];

export const STATUS_OPTIONS = ['Active', 'Inactive', 'Exited'];

export const ERP_ROLES = [
  { value: 'admin', label: 'Admin' },
  { value: 'je', label: 'Junior Engineer (JE)' },
  { value: 'zo', label: 'Zonal Officer (ZO)' },
  { value: 'ho', label: 'Head Office (HO)' },
  { value: 'accounts', label: 'Accounts' }
];

export const PAY_BASES = ['Monthly salary', 'Special package'];
