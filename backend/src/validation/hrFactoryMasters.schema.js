const { z } = require('zod');
const { factoryCategories: categories, wageCategories, departmentsFor } = require('../domain/hrEmployeeCategories');
const number = z.number().finite();
const money = number.min(0).max(9999999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001, 'Use at most two decimal places.');
const positive = number.positive().max(9999).refine(v => Math.abs(v * 10000 - Math.round(v * 10000)) < 0.0001, 'Use at most four decimal places.');
const policy = z.string().trim().min(1).max(500);
const calculation = z.object({ salary_days: number.positive().max(366).nullable(), reason: policy }).strict();
const treatment = z.object({ holiday_salary_days: number.positive().max(366).nullable(), reason: policy }).strict();
const scopeFields = { department: z.enum(['SNP Factory','Fabric Factory']).optional(), setup_reason: policy.optional() };
function checkScope(v,ctx) {
  if(v.employee_category && v.department && !departmentsFor(v.employee_category).includes(v.department)) ctx.addIssue({code:'custom',path:['department'],message:'Choose the factory belonging to this worker type.'});
  if(v.employee_category==='Local Daily-Wage Workers' && !v.department) ctx.addIssue({code:'custom',path:['department'],message:'Select a factory for Local workers.'});
}
const withScope = schema => schema.superRefine(checkScope).transform(v=>({...v,...(v.department||!v.employee_category?{}:{department:departmentsFor(v.employee_category)[0]})}));
const rule = z.object({
  ...scopeFields,
  treatment: treatment.optional(),
  calculation: calculation.optional(),
  employee_category: z.enum(categories), effective_from: z.iso.date(),
  standard_duty_hours: positive, ot_enabled: z.boolean(),
  ot_method: z.enum(['Fixed Hourly', 'Salary-derived hourly', 'Derived from daily wage']),
  ot_rate: money.nullable(), ot_multiplier: positive.nullable(),
  holiday_pay_enabled: z.boolean(), holiday_multiplier: positive.nullable(),
  management_stoppage_treatment: policy,
  short_hours_treatment: policy.nullable(), comp_off_rule: policy.nullable(),
  double_duty_multiplier: positive.nullable()
}).strict().superRefine((v, ctx) => {
  checkScope(v,ctx);
  if(v.ot_enabled && v.ot_method!=='Fixed Hourly' && !v.calculation) ctx.addIssue({code:'custom',path:['calculation'],message:'Confirm the OT calculation settings.'});
  if(v.calculation && (v.ot_method==='Salary-derived hourly') !== (v.calculation.salary_days!==null)) ctx.addIssue({code:'custom',path:['calculation','salary_days'],message:'Salary days apply only to salary-derived OT.'});
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.ot_method === 'Fixed Hourly' ? v.ot_rate === null || v.ot_multiplier !== null : v.ot_rate !== null || v.ot_multiplier === null) issue('ot_method', 'Supply only the rate or multiplier appropriate to the OT method.');
  if (v.holiday_pay_enabled ? v.holiday_multiplier === null : v.holiday_multiplier !== null) issue('holiday_multiplier', 'Holiday multiplier must match holiday pay configuration.');
  const local = v.employee_category === 'Local Daily-Wage Workers';
  if (local && v.holiday_pay_enabled) issue('holiday_pay_enabled', 'Holiday pay is not applicable to local workers.');
  if (local && v.double_duty_multiplier === null) issue('double_duty_multiplier', 'Enter a double-duty multiplier for Local workers.');
  if (!local && v.double_duty_multiplier !== null) issue('double_duty_multiplier', 'Double duty configuration applies only to local workers.');
  if (v.ot_method === 'Salary-derived hourly' && wageCategories.includes(v.employee_category)) issue('ot_method', 'Salary-derived OT requires a permanent category.');
  if (v.ot_method === 'Derived from daily wage' && !wageCategories.includes(v.employee_category)) issue('ot_method', 'Daily-wage-derived OT requires a daily-wage category.');
});
module.exports = {
  setupComplete: { params: z.object({ id: z.uuid() }).strict(), body: z.object({ salary_days: number.positive().max(366).nullable(), holiday_salary_days: number.positive().max(366).nullable(), reason: policy }).strict() },
  treatmentComplete: { params: z.object({ id: z.uuid() }).strict(), body: treatment },
  calculationImpact: { params: z.object({ id: z.uuid() }).strict() },
  calculationComplete: { params: z.object({ id: z.uuid() }).strict(), body: calculation },
  wageCreate: { body: withScope(z.object({ ...scopeFields, employee_category: z.enum(wageCategories), effective_from: z.iso.date(), daily_wage: money }).strict()) },
  ruleCreate: { body: rule },
  list: { query: withScope(z.object({ department: scopeFields.department, employee_category: z.enum(categories).optional(), as_of: z.iso.date(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict()) },
  effective: { query: withScope(z.object({ department: scopeFields.department, employee_category: z.enum(categories), date: z.iso.date() }).strict()) }
};
