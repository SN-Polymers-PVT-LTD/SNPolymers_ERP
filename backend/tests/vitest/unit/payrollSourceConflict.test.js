import {afterEach,test,expect,vi} from 'vitest';
const {supabase}=require('../../../src/db/supabase');
const mockRes=require('../../helpers/mockRes');
const busy={code:'PY409',message:'Payroll source is being finalized or changed; retry the transaction'};
const user={id:'11111111-1111-4111-8111-111111111111',role:'je',mobile_number:'9876543210'};
function builder(result){
 const b={then:(resolve,reject)=>Promise.resolve(result).then(resolve,reject)};
 for(const method of ['select','insert','update','upsert','eq','order','single','maybeSingle'])b[method]=()=>b;
 return b;
}
afterEach(()=>vi.restoreAllMocks());
test.each([
 ['attendance save','hrAttendance','save',{params:{sheetId:user.id},body:{rows:[]}}],
 ['factory wage source','hrFactoryMasters','createWage',{body:{}}],
 ['permanent salary source','hrPayStructures','savePayrollSalary',{body:{employee_id:user.id,existing_id:null,effective_from:'2025-01-01',expected_version:0,pay:{pay_basis:'Monthly salary',guaranteed_monthly_gross:30000,epf_enrolment:false,esi_enrolment:false},reason:'Confirmed salary'}}],
 ['employee source','hrEmployees','updateEmployee',{params:{id:user.id},body:{employee_name:'Employee'}}],
 ['self-service leave','hrLeaves','create',{body:{from_date:'2091-10-01',to_date:'2091-10-01',leave_type:'Medical Leave',reason:'Evidence'}}],
 ['Accounts bank source','acctRequisition','upsertIndianBank',{body:{bank_name:'State Bank of India',is_active:true}}],
 ['Projects bank source','requisitions','upsertIndianBank',{body:{bank_name:'State Bank of India',is_active:true}}]
])('%s conflicts are retryable HTTP 409, not server errors',async(_,module,method,request)=>{
 vi.spyOn(supabase,'rpc').mockResolvedValue({data:null,error:busy});
 vi.spyOn(supabase,'from').mockImplementation(table=>builder(['hrLeaves','hrPayStructures'].includes(module)&&table==='hr_employees'
  ?{data:{id:user.id,employee_category:'HO Staff',active_status:'Active'},error:null}
  :{data:null,error:busy}));
 const res=mockRes();await require(`../../../src/controllers/${module}.controller`)[method]({user,...request},res);
 expect(res.statusCode).toBe(409);expect(res.jsonData).toMatchObject({success:false,code:'PAYROLL_SOURCE_BUSY',message:busy.message});
});
