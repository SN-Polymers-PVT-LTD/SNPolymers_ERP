const {z}=require('zod');
const text=z.string().trim().min(1).max(2000),date=z.iso.date();
const scheme=z.object({statutory_scope_id:z.uuid().nullable(),applicability:z.enum(['UNRESOLVED','APPLICABLE','NOT_APPLICABLE']),enrolled:z.boolean().nullable(),basis_reference:text}).strict();
const interval=z.object({effective_from:date,effective_to:date.nullable(),verification_status:z.enum(['UNVERIFIED','ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED']),advisor_name:z.string().trim().min(1).max(120).nullable(),verification_reference:text.nullable(),verified_on:date.nullable(),schemes:z.object({EPF:scheme,ESI:scheme,PT:scheme}).strict()}).strict().superRefine((v,ctx)=>{
 const issue=message=>ctx.addIssue({code:'custom',message});
 if(v.effective_to&&v.effective_to<v.effective_from)issue('Invalid effective interval.');
 if(v.schemes.PT.enrolled!==null)issue('PT must not inherit EPF/ESI enrolment.');
 for(const [key,s] of Object.entries(v.schemes)){
  if(s.applicability!=='UNRESOLVED'&&!s.statutory_scope_id)issue(`${key}: canonical scope required.`);
  if(['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(v.verification_status)&&(s.applicability==='UNRESOLVED'||!s.statutory_scope_id||(key!=='PT'&&s.enrolled===null)))issue(`${key}: verified applicability/enrolment evidence required.`);
 }
 if(v.verification_status==='UNVERIFIED'&&(v.advisor_name!==null||v.verification_reference!==null||v.verified_on!==null))issue('Unverified records cannot carry verification metadata.');
 if(['ADVISOR_VERIFIED','ACCOUNTS_CONFIRMED'].includes(v.verification_status)&&(!v.advisor_name||!v.verification_reference||!v.verified_on))issue('Advisor evidence required.');
});
const employee={params:z.object({employeeId:z.uuid()}).strict()};
const code=z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,79}$/);
module.exports={interval,
 history:employee,
 save:{...employee,body:z.object({expected_version:z.number().int().nonnegative(),intervals:z.array(interval).min(1).max(100),evidence_reference:text}).strict()},
 context:{query:z.object({search:z.string().trim().max(120).default(''),page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(20)}).strict()},
 scope:{body:z.object({jurisdiction_code:code,establishment_code:code,evidence_reference:text}).strict()},
 bind:{body:z.object({revision_id:z.uuid(),statutory_scope_id:z.uuid(),evidence_reference:text}).strict()}
};
