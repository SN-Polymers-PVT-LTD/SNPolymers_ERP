export const formatINR = (value) => {
  if (value === null || value === undefined || value === '') return null;
  // Format authoritative decimal strings without binary arithmetic or rounding.
  const match = String(value).match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return String(value);
  const [, sign, integer, fraction = ''] = match;
  // Display-only half-up rounding using integers; never change the source amount.
  let cents = BigInt(integer) * 100n + BigInt(fraction.padEnd(2, '0').slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= '5') cents += 1n;
  const whole = String(cents / 100n);
  const grouped = whole.length > 3
    ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${whole.slice(-3)}`
    : whole;
  return `${sign && cents !== 0n ? sign : ''}₹${grouped}.${String(cents % 100n).padStart(2, '0')}`;
};

export const payrollStatus=status=>({DRAFT:'Draft',CALCULATED:'Draft',IN_ACCOUNTS_SHEET:'With Accounts',PENDING_ACCOUNTS_REVIEW:'Pending migration to Accounts',PENDING_HO_APPROVAL:'With HO',RETURNED_TO_CREATOR:'Returned',CANCELLED_DRAFT:'Withdrawn',LOCKED:'Approved'}[status]||status);

export const sumCurrency=values=>{
 let cents=0n;
 for(const value of values){const match=String(value??'').match(/^(\d+)(?:\.(\d{1,2}))?$/);if(!match)return null;cents+=BigInt(match[1])*100n+BigInt((match[2]||'').padEnd(2,'0'));}
 return `${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
};

export const payrollGroupName=code=>({SNP_PERMANENT:'Permanent employees',FABRIC_PERMANENT:'Permanent employees',SNP_CASUAL:'Casual employees',FABRIC_CASUAL:'Casual employees',SNP_LOCAL:'Local daily-wage workers',FABRIC_LOCAL:'Local daily-wage workers',HO_STAFF:'Head Office staff',PROJECTS_ZO:'Zonal Office',PROJECTS_JE:'Junior Engineers',PROJECTS_SUPERVISOR:'Local project supervisors',PROJECTS_HEAD_OFFICE:'Head Office employees',LEGACY_PROJECTS:'Earlier Projects group'}[code]||String(code||'').replaceAll('_',' '));

export const payrollLineName=code=>({BASIC:'Basic salary',HRA:'House rent allowance',DA:'Dearness allowance',CONTRACTUAL_BASE:'Monthly salary',PACKAGE_BALANCE:'Salary balance',OVERTIME:'Overtime',HOLIDAY_PREMIUM:'Holiday duty pay',DAILY_WAGE:'Daily wages',LOP:'Unpaid leave',EPF:'EPF',ESI:'ESI',PT:'Professional tax',SHORT_HOURS:'Short working hours'}[code]||String(code||'').toLowerCase().replaceAll('_',' ').replace(/^./,c=>c.toUpperCase()));
export const calculationStatus=status=>({READY_FOR_REVIEW:'Ready for review',BLOCKED:'Needs attention',CALCULATED:'Calculated',LOCKED:'Approved'}[status]||payrollLineName(status));
