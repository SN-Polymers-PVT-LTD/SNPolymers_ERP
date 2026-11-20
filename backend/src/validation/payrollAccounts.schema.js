const {z}=require('zod');
const id=z.uuid(), version=z.number().int().positive();
const delivery={params:z.object({deliveryId:id}).strict()};
const sheet={params:z.object({sheetId:id}).strict()};
module.exports={
 cutover:{query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict()},
 convert:{body:z.object({rows:z.array(z.object({row_id:id,expected_version:version,expected_review_version:z.number().int().nonnegative(),source_fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}).strict()).min(1).max(50)}).strict()},
 sheet:{...sheet,query:z.object({page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(50).default(20)}).strict()},
 submit:{...sheet,body:z.object({}).strict()},
 payment:{...delivery,body:z.object({expected_version:version,bank:z.string().trim().min(1).max(200).nullable(),mode:z.enum(['Cheque','Bulk NEFT','RTGS','NEFT']).nullable(),beneficiary_id:id.nullable(),cheque_no:z.string().trim().max(100).nullable().optional(),cheque_date:z.iso.date().nullable().optional()}).strict()},
 action:{...delivery,body:z.object({expected_version:version,action:z.enum(['Approve','ReturnSalary','ReturnPayment','Hold']),reason:z.string().trim().min(1).max(2000).optional()}).strict().refine(b=>b.action==='Approve'||!!b.reason,{message:'Enter a reason for returning or holding a salary.'})},
 resubmit:{...delivery,body:z.object({expected_version:version}).strict()},
 confirm:{...delivery,body:z.object({paid_on:z.iso.date(),reference:z.string().trim().min(1).max(200)}).strict()}
};
