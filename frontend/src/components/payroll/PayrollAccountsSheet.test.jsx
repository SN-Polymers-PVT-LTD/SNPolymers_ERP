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
const row={id:'item',payroll_row_id:'payroll',delivery_id:'delivery',delivery_version:3,employee_name:'Test employee',employee_code:'EMP-TEST',active:true,disposition:'WITH_ACCOUNTS',salary,period_from:'2026-08-01',period_to:'2026-08-31',beneficiary_id:'beneficiary',beneficiary_name:'Test beneficiary',beneficiary_ac_no:'123456789012',beneficiary_ifsc:'TEST0001234',beneficiary_bank_name:'Recipient Bank',source_stale:false};
const payload={sheet:{id:'sheet',sheet_number:'AC-100',sheet_status:'Open'},run:{department:'Fabric Factory',period_from:'2026-08-01',period_to:'2026-08-31'},rows:[row]};
const mount=(ho=false)=>{const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});const view=render(<QueryClientProvider client={client}><MemoryRouter><PayrollAccountsSheet sheetId="sheet" ho={ho}/></MemoryRouter></QueryClientProvider>);return {...view,client};};
beforeEach(()=>{vi.resetAllMocks();user={id:'accounts',role:'accounts'};api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:payload}});accounts.getBankBalances.mockResolvedValue({data:{bankBalances:[{bank_name:'Test debit bank'}]}});accounts.getBeneficiaries.mockResolvedValue({data:{beneficiaries:[{id:'beneficiary',beneficiary_name:'Test beneficiary',account_number:'123456789012'}]}});for(const fn of ['saveSalaryPaymentDetails','submitPayrollAccountsSheet','actOnSalary','recordSalaryPayment','resubmitSalaryPayment'])api[fn].mockResolvedValue({data:{success:true}});});
test('Accounts sees exact salary and completes payment metadata without salary re-entry',async()=>{
 mount();expect(await screen.findByText('₹9,00,71,99,25,47,40,993.01')).toBeInTheDocument();expect(screen.getByRole('button',{name:'Send to HO'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Debit bank for Test employee'),{target:{value:'Test debit bank'}});
 fireEvent.change(screen.getByLabelText('Payment mode for Test employee'),{target:{value:'NEFT'}});
 fireEvent.click(screen.getByRole('button',{name:'Save payment details'}));
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

test('selecting a saved account fills all four beneficiary fields', async () => {
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[{...row,beneficiary_id:null,beneficiary_ac_no:null}]}}});
 accounts.searchBeneficiariesByAcNo.mockResolvedValue({data:{beneficiaries:[{
  id:'beneficiary',account_number:'123456789012',beneficiary_name:'Test beneficiary',ifsc:'TEST0001234',beneficiary_bank_name:'Recipient Bank',
 }]}});
 mount();
 const account=await screen.findByLabelText('Account number for Test employee');
 fireEvent.change(account,{target:{value:'123'}});
 fireEvent.click(await screen.findByRole('button',{name:/123456789012.*Test beneficiary/}));
 expect(account).toHaveValue('123456789012');
 expect(screen.getByLabelText('IFSC for Test employee')).toHaveValue('TEST0001234');
 expect(screen.getByLabelText('Beneficiary name for Test employee')).toHaveValue('Test beneficiary');
 expect(screen.getByLabelText('Beneficiary bank for Test employee')).toHaveDisplayValue('Recipient Bank');
});

test('paid salaries guide Accounts to the register rather than another HO review',async()=>{
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,sheet:{...payload.sheet,sheet_status:'Reviewed'},rows:[{...row,disposition:'APPROVED',payment:{paid_on:'2026-08-31',reference:'TEST'}}]}}});
 mount();expect(await screen.findByText(/Payments on this page are recorded/)).toBeInTheDocument();
 expect(screen.getByRole('link',{name:'Open Payroll Register'})).toHaveAttribute('href','/hr/payroll/register');
 expect(screen.queryByText(/Next: HO reviews/)).not.toBeInTheDocument();
});

test('shows payroll payment data in separate requisition-style columns', async () => {
 mount();
 for (const name of ['Employee','Beneficiary','Debit bank','Take-home pay','Payment mode','Remarks','Status','Actions']) {
  expect(await screen.findByRole('columnheader',{name})).toBeInTheDocument();
 }
 expect(screen.queryByRole('columnheader',{name:/WO\. no/i})).not.toBeInTheDocument();
 expect(screen.getByLabelText('IFSC for Test employee')).toHaveValue('TEST0001234');
 expect(screen.getByText(/Recipient Bank/)).toBeInTheDocument();
 expect(screen.getByLabelText('Account number for Test employee')).toHaveValue('123456789012');
 expect(screen.getByRole('button',{name:'Return salary'})).toHaveClass('text-red-600');
});

test('cheque details are edited in the row and must be saved before sending', async () => {
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[
  {...row,debit_bank_ac_type:'Test debit bank',payment_mode:'NEFT',payment_details_current:true},
 ]}}});
 mount();
 const send=await screen.findByRole('button',{name:'Send to HO'});
 expect(send).toBeEnabled();
 fireEvent.change(screen.getByLabelText('Payment mode for Test employee'),{target:{value:'Cheque'}});
 const save=screen.getByRole('button',{name:'Save payment details'});
 expect(send).toBeDisabled();
 expect(save).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Cheque number for Test employee'),{target:{value:'123456'}});
 fireEvent.change(screen.getByLabelText('Cheque date for Test employee'),{target:{value:'2026-08-31'}});
 fireEvent.click(save);
 await waitFor(()=>expect(api.saveSalaryPaymentDetails).toHaveBeenCalledWith('delivery',{
  expected_version:3,bank:'Test debit bank',mode:'Cheque',beneficiary_id:'beneficiary',
  cheque_no:'123456',cheque_date:'2026-08-31',
 }));
 expect(api.submitPayrollAccountsSheet).not.toHaveBeenCalled();
});

test('projects the whole sheet balance live and saves incomplete payment details as a draft', async () => {
 const draftRow={...row,salary:{...salary,final_net_salary:'57600.00'},beneficiary_id:null,beneficiary_name:null,beneficiary_ac_no:null};
 api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[draftRow],total:21,bank_commitments:{'Test debit bank':'1000.00'}}}});
 accounts.getBankBalances.mockResolvedValue({data:{bankBalances:[{bank_name:'Test debit bank',available_balance:'100000.00'}]}});
 mount();
 expect(await screen.findByText('₹99,000.00')).toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Debit bank for Test employee'),{target:{value:'Test debit bank'}});
 expect(screen.getByText('₹41,400.00')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Send to HO'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(api.saveSalaryPaymentDetails).toHaveBeenCalledWith('delivery',{
  expected_version:3,bank:'Test debit bank',mode:null,beneficiary_id:null,cheque_no:null,cheque_date:null,
 }));
 expect(api.submitPayrollAccountsSheet).not.toHaveBeenCalled();
});

test('shows the current balance as the projection on an unrouted single-page sheet and omits Credit', async () => {
 accounts.getBankBalances.mockResolvedValue({data:{bankBalances:[
  {bank_name:'Test debit bank',available_balance:'100000.00'},
  {bank_name:'Credit',available_balance:'0.00',is_virtual:true},
 ]}});
 mount();
 expect(await screen.findAllByText('₹1,00,000.00')).toHaveLength(2);
 expect(screen.queryByText('Credit',{exact:true})).not.toBeInTheDocument();
 expect(screen.queryByRole('option',{name:'Credit'})).not.toBeInTheDocument();
});

test('Bulk NEFT submits only unpaid approved payroll items', async () => {
  const approved = {...row, disposition:'APPROVED', payment_mode:'Bulk NEFT', debit_bank_ac_type:'Test debit bank'};
  api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,rows:[
    {...approved, id:'unpaid', payment:null},
    {...approved, id:'paid', delivery_id:'paid-delivery', employee_name:'Paid employee', payment:{paid_on:'2026-08-31',reference:'TEST'}}
  ]}}});
  accounts.exportBulkNeft.mockRejectedValue(new Error('Synthetic export response'));
  mount();
  fireEvent.click(await screen.findByRole('button',{name:'Export Bulk NEFT (1)'}));
  await waitFor(()=>expect(accounts.exportBulkNeft).toHaveBeenCalledWith('sheet',{item_ids:['unpaid']}));
});

test('exports the selected payroll CSV status across the whole sheet', async () => {
  const savedCreate = URL.createObjectURL;
  const savedRevoke = URL.revokeObjectURL;
  let downloaded;
  URL.createObjectURL = vi.fn(blob => { downloaded = blob; return 'blob:payroll-csv'; });
  URL.revokeObjectURL = vi.fn();
  const click = vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(() => {});
  try {
    api.getFullPayrollAccountsSheet.mockResolvedValue({...payload,rows:[
      row,
      {...row,id:'paid',employee_name:'Paid, Employee',beneficiary_ac_no:'001234',disposition:'APPROVED',payment:{paid_on:'2026-08-31',reference:'BANK-1'}}
    ]});
    mount();
    fireEvent.click(await screen.findByRole('button',{name:'Export to CSV'}));
    fireEvent.click(screen.getByRole('button',{name:'Paid'}));
    fireEvent.click(screen.getByRole('button',{name:'Export',exact:true}));
    await waitFor(()=>expect(click).toHaveBeenCalled());
    expect(click.mock.instances[0].download).toBe('AC-100-Paid.csv');
    const csv=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(reader.result);
      reader.onerror=reject;
      reader.readAsText(downloaded);
    });
    expect(csv).toContain('Employee Code,Employee Name,Period From,Period To');
    expect(csv).toContain('"Paid, Employee"');
    expect(csv).toContain('001234');
    expect(csv).toContain('9007199254740993.01');
    expect(csv).toContain('Paid,2026-08-31,BANK-1');
    expect(csv).not.toContain('Test employee');
    expect(csv).not.toContain('WO. No.');
  } finally {
    click.mockRestore();
    URL.createObjectURL=savedCreate;
    URL.revokeObjectURL=savedRevoke;
  }
});

test('Bulk NEFT includes eligible items from off-page payroll rows', async () => {
  api.getPayrollAccountsSheet.mockResolvedValue({data:{payroll:{...payload,total:2}}});
  api.getFullPayrollAccountsSheet.mockResolvedValue({...payload,total:2,rows:[
    row,
    {...row,id:'off-page',delivery_id:'off-page-delivery',disposition:'APPROVED',payment_mode:'Bulk NEFT',debit_bank_ac_type:'Test debit bank'}
  ]});
  accounts.exportBulkNeft.mockRejectedValue(new Error('Synthetic export response'));
  mount();
  fireEvent.click(await screen.findByRole('button',{name:'Export Bulk NEFT (1)'}));
  await waitFor(()=>expect(accounts.exportBulkNeft).toHaveBeenCalledWith('sheet',{item_ids:['off-page']}));
});
