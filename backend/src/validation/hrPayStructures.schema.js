const { z } = require('zod');

const uuid = z.string().uuid();
const payBases = ['Monthly salary', 'Special package'];

const money = z.coerce.number().min(0).max(99999999.99);

const salaryTerms = z.object({
  pay_basis: z.enum(payBases),
  guaranteed_monthly_gross: money,
  epf_enrolment: z.boolean().default(false),
  esi_enrolment: z.boolean().default(false)
}).strict();

module.exports = {
  employeeParam: { params: z.object({ employeeId: uuid }) },
  idParam: { params: z.object({ id: uuid }) },
  salaryTerms,
  payrollContext: { params: z.object({employeeId: uuid}) },
  payrollSalary: { body: z.object({employee_id:uuid,existing_id:uuid.nullable(),effective_from:z.iso.date(),expected_version:z.number().int().min(0),pay:salaryTerms.nullable(),reason:z.string().trim().min(1).max(2000)}).strict() },
  initialAssignment: { body: z.object({employee_id:uuid,effective_from:z.iso.date(),reason:z.string().trim().min(1).max(2000)}).strict() }
};
