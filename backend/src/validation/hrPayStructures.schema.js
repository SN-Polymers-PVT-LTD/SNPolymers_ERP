const { z } = require('zod');

const uuid = z.string().uuid();
const payBases = ['Monthly salary', 'Special package'];
const statuses = ['Draft', 'Active', 'Superseded', 'Suspended'];

const money = z.coerce.number().min(0).max(99999999.99);
const optionalMoney = z.union([money, z.null()]).optional();

function validateReconciliation(data) {
  const basic = data.basic_salary ?? 0;
  const welfare = data.staff_welfare ?? 0;
  const other = data.other_fixed_components ?? 0;
  if (data.guaranteed_monthly_gross !== undefined) {
    return Number((basic + welfare + other).toFixed(2)) <= Number(data.guaranteed_monthly_gross.toFixed(2));
  }
  return true;
}

const createBody = z.object({
  employee_id: uuid,
  pay_basis: z.enum(payBases),
  guaranteed_monthly_gross: money,
  basic_salary: optionalMoney,
  staff_welfare: optionalMoney,
  other_fixed_components: optionalMoney,
  epf_enrolment: z.boolean().default(false),
  esi_enrolment: z.boolean().default(false),
  status: z.enum(['Draft', 'Active']).default('Active')
}).strict().refine(validateReconciliation, {
  message: 'Sum of fixed components (Basic + Staff Welfare + Other Fixed) cannot exceed Guaranteed Monthly Gross.',
  path: ['guaranteed_monthly_gross']
});

const updateBody = z.object({
  pay_basis: z.enum(payBases).optional(),
  guaranteed_monthly_gross: money.optional(),
  basic_salary: optionalMoney,
  staff_welfare: optionalMoney,
  other_fixed_components: optionalMoney,
  epf_enrolment: z.boolean().optional(),
  esi_enrolment: z.boolean().optional(),
  status: z.enum(['Draft', 'Active']).optional()
}).strict().refine(v => Object.keys(v).length > 0, {
  message: 'At least one field must be provided for update.'
}).refine(validateReconciliation, {
  message: 'Sum of fixed components (Basic + Staff Welfare + Other Fixed) cannot exceed Guaranteed Monthly Gross.',
  path: ['guaranteed_monthly_gross']
});

module.exports = {
  employeeParam: { params: z.object({ employeeId: uuid }) },
  idParam: { params: z.object({ id: uuid }) },
  create: { body: createBody },
  update: { params: z.object({ id: uuid }), body: updateBody }
};
