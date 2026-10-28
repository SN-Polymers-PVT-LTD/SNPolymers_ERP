const {z}=require('zod');
const {statuses}=require('../domain/payroll/review');
const date=z.iso.date();
const filters={run_id:z.uuid().optional(),department:z.enum(['SNP Factory','Fabric Factory','Head Office','Projects']).optional(),group_code:z.string().trim().min(1).max(40).optional(),status:z.enum(statuses).optional(),from:date.optional(),to:date.optional(),search:z.string().trim().max(120).optional()};
const validPeriod=value=>!value.from||!value.to||value.from<=value.to;
module.exports={
 register:{query:z.object({...filters,page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict().refine(validPeriod,'Invalid reporting interval')},
 export:{query:z.object({...filters,format:z.enum(['xlsx','html']).default('xlsx'),report:z.enum(['register','departments']).default('register')}).strict().refine(validPeriod,'Invalid reporting interval')},
 payslip:{params:z.object({rowId:z.uuid()}).strict(),query:z.object({mode:z.enum(['diagnostic','official']).default('diagnostic')}).strict()}
};
