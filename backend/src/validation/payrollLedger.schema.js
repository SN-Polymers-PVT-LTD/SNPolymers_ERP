const {z}=require('zod');
const uuid=z.uuid(),text=z.string().trim().min(1).max(2000),date=z.iso.date();
const amount=z.string().regex(/^-?\d+(\.\d{1,2})?$/),positive=z.string().regex(/^\d+(\.\d{1,2})?$/).refine(v=>Number(v)>0);
const data=z.object({kind:z.enum(['BONUS','SALARY_ARREARS','ADVANCE']),amount,effective_date:date,target_row_id:uuid.nullable(),original_period_from:date.nullable(),original_period_to:date.nullable(),installment:positive.nullable(),recovery_start_month:date.nullable(),evidence_reference:text}).strict();
module.exports={
 employees:{query:z.object({search:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict()},
 cutoff:{params:z.object({runId:uuid}),body:z.object({expected_version:z.number().int().min(0),action:z.enum(['propose','approve']),cutoff_at:z.iso.datetime({offset:true}).nullable(),evidence_reference:text}).strict()},
 create:{params:z.object({employeeId:uuid}),body:data},
 list:{params:z.object({employeeId:uuid}),query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict()},
 action:{params:z.object({id:uuid}),body:z.object({expected_version:z.number().int().positive(),action:z.enum(['approve','reject','pause','resume','revise_plan']),reason:text,data:z.object({installment:positive,recovery_start_month:date}).strict().or(z.object({}).strict()).default({})}).strict()},
 calendar:{body:z.object({group_code:z.string().min(1).max(40),department:z.enum(['SNP Factory','Fabric Factory','Head Office','Projects']),evidence_reference:text,days:z.array(z.object({calendar_date:date,day_type:z.enum(['Scheduled Workday','Weekly Off','Paid Holiday','Unpaid Closure','Special Working Day']),compensation_treatment:z.enum(['PAID','UNPAID'])}).strict().refine(d=>(d.day_type!=='Paid Holiday'||d.compensation_treatment==='PAID')&&(d.day_type!=='Unpaid Closure'||d.compensation_treatment==='UNPAID'),'Calendar classification contradicts pay entitlement.')).min(1).max(732)}).strict()}
};
