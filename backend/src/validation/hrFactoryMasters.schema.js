const { z } = require('zod');
const categories = ['Fabric Factory Permanent Employees', 'SNP Permanent Factory Labour', 'SNP Casual Factory Labour', 'Local Daily-Wage Workers'];
const wageCategories = categories.slice(2);
const number = z.number().finite();
const money = number.min(0).max(9999999999.99).refine(v => Math.abs(v * 100 - Math.round(v * 100)) < 0.0001, 'Use at most two decimal places.');
const positive = number.positive().max(9999).refine(v => Math.abs(v * 10000 - Math.round(v * 10000)) < 0.0001, 'Use at most four decimal places.');
const policy = z.string().trim().min(1).max(500);
const rule = z.object({
  employee_category: z.enum(categories), effective_from: z.iso.date(),
  standard_duty_hours: positive, ot_enabled: z.boolean(),
  ot_method: z.enum(['Fixed Hourly', 'Salary-derived hourly', 'Derived from daily wage']),
  ot_rate: money.nullable(), ot_multiplier: positive.nullable(),
  holiday_pay_enabled: z.boolean(), holiday_multiplier: positive.nullable(),
  management_stoppage_treatment: policy,
  short_hours_treatment: policy.nullable(), comp_off_rule: policy.nullable(),
  double_duty_multiplier: positive.nullable()
}).strict().superRefine((v, ctx) => {
  const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (v.ot_method === 'Fixed Hourly' ? v.ot_rate === null || v.ot_multiplier !== null : v.ot_rate !== null || v.ot_multiplier === null) issue('ot_method', 'Supply only the rate or multiplier appropriate to the OT method.');
  if (v.holiday_pay_enabled ? v.holiday_multiplier === null : v.holiday_multiplier !== null) issue('holiday_multiplier', 'Holiday multiplier must match holiday pay configuration.');
  const local = v.employee_category === 'Local Daily-Wage Workers';
  if (local && v.holiday_pay_enabled) issue('holiday_pay_enabled', 'Holiday pay is not applicable to local workers.');
  if (local ? v.double_duty_multiplier === null : v.double_duty_multiplier !== null) issue('double_duty_multiplier', 'Double duty configuration applies only to local workers.');
  if (v.ot_method === 'Salary-derived hourly' && wageCategories.includes(v.employee_category)) issue('ot_method', 'Salary-derived OT requires a permanent category.');
  if (v.ot_method === 'Derived from daily wage' && !wageCategories.includes(v.employee_category)) issue('ot_method', 'Daily-wage-derived OT requires a daily-wage category.');
});
module.exports = {
  wageCreate: { body: z.object({ employee_category: z.enum(wageCategories), effective_from: z.iso.date(), daily_wage: money }).strict() },
  ruleCreate: { body: rule },
  list: { query: z.object({ employee_category: z.enum(categories).optional(), as_of: z.iso.date(), page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) }).strict() },
  effective: { query: z.object({ employee_category: z.enum(categories), date: z.iso.date() }).strict() }
};
