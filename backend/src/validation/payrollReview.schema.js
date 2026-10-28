const {z}=require('zod');
const {statuses}=require('../domain/payroll/review');
const reason=z.string().trim().min(1).max(2000),fingerprint=z.string().regex(/^[a-f0-9]{64}$/);
const base={expected_version:z.number().int().positive(),expected_review_version:z.number().int().nonnegative()};
const action=z.discriminatedUnion('action',[
 z.object({...base,action:z.literal('calculate'),reason}).strict(),
 z.object({...base,action:z.literal('correct'),reason,note:z.string().trim().max(2000),assignment_id:z.uuid().optional()}).strict(),
 ...['submit','forward','approve_lock'].map(value=>z.object({...base,action:z.literal(value),source_fingerprint:fingerprint}).strict()),
 ...['return','cancel'].map(value=>z.object({...base,action:z.literal(value),reason}).strict())
]);
module.exports={
 autoRecalculate:{body:z.object({run_id:z.uuid(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(20).default(20)}).strict()},
 freshness:{query:z.object({run_id:z.uuid(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(20).default(20)}).strict()},
 queue:{query:z.object({run_id:z.uuid().optional(),status:z.enum(statuses).optional(),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict()},
 detail:{params:z.object({rowId:z.uuid()}).strict()},
 cancelRun:{params:z.object({runId:z.uuid()}).strict(),body:z.object({reason}).strict()},
 generate:{params:z.object({runId:z.uuid()}).strict(),body:z.object({}).strict()},
 action:{params:z.object({rowId:z.uuid()}).strict(),body:action},
 bulk:{body:z.object({actions:z.array(z.object({row_id:z.uuid(),request:action}).strict()).min(1).max(50)}).strict()}
};
