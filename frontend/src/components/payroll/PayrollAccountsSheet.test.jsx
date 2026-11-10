import React from 'react';
import {beforeEach,test,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import PayrollAccountsSheet from './PayrollAccountsSheet';
import * as api from '../../api/payrollAccountsApi';
import * as accounts from '../../api/acctRequisitionsApi';
vi.mock('../../api/payrollAccountsApi');vi.mock('../../api/acctRequisitionsApi');
let user={id:'accounts',role:'accounts'};
vi.mock('../AuthContext',()=>({useAuth:()=>({user})}));
const salary={financial_readiness:true,final_net_salary:'9007199254740993.01',gross_after_lop:'9007199254740999.01',earnings:[],deductions:[],blockers:[],statutory:[],monthly_reconciliation:[],source_references:{},configuration_warnings:[]};
const row={id:'item',payroll_row_id:'payroll',delivery_id:'delivery',delivery_version:3,employee_name:'Test employee',employee_code:'EMP-TEST',active:true,disposition:'WITH_ACCOUNTS',salary,period_from:'2026-08-01',period_to:'2026-08-31',beneficiary_id:'beneficiary',beneficiary_name:'Test beneficiary',beneficiary_ac_no:'123456789012',source_stale:false};
const payload={sheet:{id:'sheet',sheet_number:'AC-100',sheet_status:'Open'},run:{department:'Fabric Factory',period_from:'2026-08-01',period_to:'2026-08-31'},rows:[row]};
const mount=(ho=false)=>{const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const view=render(<QueryClientProvider client={client}><MemoryRouter><PayrollAccountsSheet sheetId="sheet" ho={ho}/></MemoryRouter></QueryClientProvider>);return {...view,client};};
beforeEach(()=>{vi.resetAllMocks();user={id:'accounts',role:'accounts'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:payload}});accounts.getBankBalances.mockResolvedValue({data:{bankBalances:[{bank_name:'Test debit bank'}]}});accounts.getBeneficiaries.mockResolvedValue({data:{beneficiaries:[{id:'beneficiary',beneficiary_name:'Test beneficiary',account_number:'123456789012'}]}});for(const fn of ['saveSalaryPaymentDetails','submitPayrollAccountsSheet','actOnSalary','recordSalaryPayment','resubmitSalaryPayment'])api[fn].mockResolvedValue({data:{success:true}});});
test('Accounts sees exact salary and completes payment metadata without salary re-entry',async()=>{
 mount();expect(await screen.findByText('₹9,00,71,99,25,47,40,993.01')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Send to HO'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Payment details'}));await screen.findByLabelText('Employee beneficiary');fireEvent.change(screen.getByLabelText('Debit bank'),{target:{value:'Test debit bank'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(api.saveSalaryPaymentDetails).toHaveBeenCalledWith('delivery',{expected_version:3,bank:'Test debit bank',mode:'NEFT',beneficiary_id:'beneficiary',cheque_no:null,cheque_date:null}));
 expect(api.actOnSalary).not.toHaveBeenCalled();expect(screen.queryByLabelText('Salary amount')).not.toBeInTheDocument();
});
test('HO selects ready employees and approves exact server-backed salaries, without partial approval UI',async()=>{
 user={id:'ho',role:'ho'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,sheet:{...payload.sheet,sheet_status:'Submitted'},rows:[{...row,disposition:'WITH_HO'}]}}});mount(true);
 fireEvent.click(await screen.findByLabelText('Select Test employee'));fireEvent.click(screen.getByRole('button',{name:'Approve selected (1)'}));
 await waitFor(()=>expect(api.actOnSalary).toHaveBeenCalledWith('delivery',{expected_version:3,action:'Approve'}));expect(screen.queryByText('Partially Approve')).not.toBeInTheDocument();
});
test('HO return modal explains salary and payment destinations and requires a reason',async()=>{
 user={id:'ho',role:'ho'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,disposition:'WITH_HO'}]}}});mount(true);fireEvent.click(await screen.findByRole('button',{name:'Return or hold'}));expect(screen.getByRole('button',{name:'Save'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('What needs to happen?'),{target:{value:'ReturnPayment'}});fireEvent.change(screen.getByLabelText('Reason'),{target:{value:'Correct the bank account'}});fireEvent.click(screen.getByRole('button',{name:'Save'}));
 await waitFor(()=>expect(api.actOnSalary).toHaveBeenCalledWith('delivery',{expected_version:3,action:'ReturnPayment',reason:'Correct the bank account'}));
});
test('recording an actual payment is separate from HO approval',async()=>{
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,disposition:'APPROVED',payment:null}]}}});mount();fireEvent.click(await screen.findByRole('button',{name:'Record payment'}));fireEvent.change(screen.getByLabelText('Paid on'),{target:{value:'2026-08-31'}});fireEvent.change(screen.getByLabelText('Bank reference'),{target:{value:'BATCH-REF-1'}});fireEvent.click(screen.getByRole('button',{name:'Save payment'}));
 await waitFor(()=>expect(api.recordSalaryPayment).toHaveBeenCalledWith('delivery',{paid_on:'2026-08-31',reference:'BATCH-REF-1'}));expect(api.actOnSalary).not.toHaveBeenCalled();
});
test('stale salaries cannot be approved, and zero net does not demand payment',async()=>{
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,source_stale:true,disposition:'WITH_HO'}]}}});const view=mount(true);expect(await screen.findByLabelText('Select Test employee')).toBeDisabled();expect(screen.getByText('Needs update — salary inputs changed')).toBeInTheDocument();view.unmount();
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,salary:{...salary,final_net_salary:'0.00'},disposition:'APPROVED'}]}}});mount();expect(await screen.findByText('No payout required')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Record payment'})).not.toBeInTheDocument();
});
test('API errors remain visible with employee names and allow retry',async()=>{
 user={id:'ho',role:'ho'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,disposition:'WITH_HO'}]}}});api.actOnSalary.mockRejectedValue({response:{data:{message:'Insufficient bank balance'}}});mount(true);fireEvent.click(await screen.findByLabelText('Select Test employee'));fireEvent.click(screen.getByRole('button',{name:'Approve selected (1)'}));expect(await screen.findByText('Test employee: Insufficient bank balance')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Approve selected (1)'})).toBeEnabled();
});
test('own or previously verified salary needs an independent HO reviewer',async()=>{
 user={id:'ho',role:'ho'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,disposition:'WITH_HO',independent_reviewer:false}]}}});mount(true);expect(await screen.findByLabelText('Select Test employee')).toBeDisabled();expect(screen.getByText('Independent reviewer required')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Approve selected (0)'})).toBeDisabled();
});

test('a payment revision arriving after selection requires the reviewer to select it again',async()=>{
 user={id:'ho',role:'ho'};const record={...row,disposition:'WITH_HO'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[record]}}});const {client}=mount(true);fireEvent.click(await screen.findByLabelText('Select Test employee'));expect(screen.getByRole('button',{name:'Approve selected (1)'})).toBeEnabled();
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...record,delivery_version:4}]}}});await client.invalidateQueries({queryKey:['payroll-accounts-sheet']});await waitFor(()=>expect(screen.getByRole('button',{name:'Approve selected (0)'})).toBeDisabled());expect(screen.getByLabelText('Select Test employee')).not.toBeChecked();expect(api.actOnSalary).not.toHaveBeenCalled();
});
test('sheet defaults preserve an employee’s existing payment mode',async()=>{
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,payment_mode:'RTGS'}]}}});mount();fireEvent.click(await screen.findByRole('button',{name:'Payment defaults'}));fireEvent.change(screen.getByLabelText('Debit bank'),{target:{value:'Test debit bank'}});fireEvent.change(screen.getByLabelText('Payment mode'),{target:{value:'Bulk NEFT'}});fireEvent.click(screen.getByRole('button',{name:'Save defaults'}));await waitFor(()=>expect(api.saveSalaryPaymentDetails).toHaveBeenCalledWith('delivery',{expected_version:3,bank:'Test debit bank',mode:'RTGS',beneficiary_id:'beneficiary',cheque_no:null,cheque_date:null}));
});

test('server-paginated second-page salaries remain visible and actionable',async()=>{
 user={id:'ho',role:'ho'};
 api.getPayrollAccountsSheet.mockImplementation(async(_id,{page})=>({data:{payroll:{...payload,total:21,rows:[{...row,disposition:'WITH_HO',employee_name:page===2?'Second page employee':'First page employee',delivery_id:page===2?'delivery-21':'delivery-1'}]}}}));
 mount(true);await screen.findByText('First page employee');fireEvent.click(screen.getByRole('button',{name:'2',exact:true}));
 expect(await screen.findByText('Second page employee')).toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Select Second page employee'));fireEvent.click(screen.getByRole('button',{name:'Approve selected (1)'}));
 await waitFor(()=>expect(api.actOnSalary).toHaveBeenCalledWith('delivery-21',{expected_version:3,action:'Approve'}));
 expect(screen.queryByText('First page employee')).not.toBeInTheDocument();
});

test('new recipient search starts with employee name and offers an explicit broader search',async()=>{
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,beneficiary_id:null}]}}});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Payment details',exact:true}));
 expect(screen.getByLabelText('Find employee beneficiary')).toHaveValue('Test employee');
 expect(screen.getByLabelText('Employee beneficiary')).toHaveValue('');
 fireEvent.click(screen.getByRole('button',{name:'Show all saved beneficiaries'}));
 expect(screen.getByLabelText('Find employee beneficiary')).toHaveValue('');
});

test('paid salaries guide Accounts to the register rather than another HO review',async()=>{
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,sheet:{...payload.sheet,sheet_status:'Reviewed'},rows:[{...row,disposition:'APPROVED',payment:{paid_on:'2026-08-31',reference:'TEST'}}]}}});
 mount();expect(await screen.findByText(/Payments on this page are recorded/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Open Payroll Register'})).toHaveAttribute('href','/hr/payroll/register');
 expect(screen.queryByText(/Next: HO reviews/)).not.toBeInTheDocument();
});
