import definitions from '../../../../shared/hrEmployeeCategories.json';

export const LEGACY_PROJECT_CATEGORY = 'Projects Department Employees';
export const CATEGORIES = definitions.map(item => item.category);
export const FACTORY_CATEGORIES = definitions.filter(item => item.type !== 'office').map(item => item.category);
export const WAGE_CATEGORIES = definitions.filter(item => ['casual', 'local'].includes(item.type)).map(item => item.category);
export const OFFICE_CATEGORIES = [...definitions.filter(item => item.type === 'office').map(item => item.category), LEGACY_PROJECT_CATEGORY];
export const PERMANENT_CATEGORIES = new Set([...definitions.filter(item => ['office', 'permanent'].includes(item.type)).map(item => item.category), LEGACY_PROJECT_CATEGORY]);
export const getDepartmentsForCategory = category => definitions.find(item => item.category === category)?.departments || (category === LEGACY_PROJECT_CATEGORY ? ['Projects'] : []);
export const getFactoryDepartment = (category, department) => {
  const allowed = getDepartmentsForCategory(category);
  return allowed.includes(department) ? department : allowed[0];
};

export const CATEGORY_LABELS = {
  'HO Staff': 'HO Staff',
  'Fabric Factory Permanent Employees': 'Fabric Factory Permanent Employees',
  'SNP Casual Factory Labour': 'SNP Casual Factory Employees',
  'SNP Permanent Factory Labour': 'SNP Permanent Factory Employees',
  'Projects Department Employees': 'Projects Department Employees',
  'Local Daily-Wage Workers': 'Local Daily-Wage Workers'
};

export const getCategoryLabel = (category) => CATEGORY_LABELS[category] || category;

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
  { value: 'accounts', label: 'Accounts' },
  { value: 'factory_manager', label: 'Factory Manager' }
];

export const PAY_BASES = ['Monthly salary', 'Special package'];
