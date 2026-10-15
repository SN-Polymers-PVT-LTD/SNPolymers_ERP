const { z } = require('zod');

const uuid = z.string().uuid();
const payBases = ['Monthly salary', 'Special package'];
const statuses = ['Draft', 'Active', 'Superseded', 'Suspended'];

const money = z.coerce.number().min(0).max(99999999.99);

const createBody = z.object({
  employee_id: uuid,
  pay_basis: z.enum(payBases),
  guaranteed_monthly_gross: money,
  epf_enrolment: z.boolean().default(false),
  esi_enrolment: z.boolean().default(false),
  status: z.literal('Active').default('Active')
}).strict();

module.exports = {
  employeeParam: { params: z.object({ employeeId: uuid }) },
  idParam: { params: z.object({ id: uuid }) },
  create: { body: createBody }
};
