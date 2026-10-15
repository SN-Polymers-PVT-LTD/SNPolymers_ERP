import React from 'react';
import {beforeEach,test,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import PayrollSheetTable from './PayrollSheetTable';
import * as review from '../../api/payrollReviewApi';
import * as reports from '../../api/payrollReportsApi';
vi.mock('../../api/payrollReviewApi');vi.mock('../../api/payrollReportsApi');
const run={id:'run',created_by:'fm',department:'SNP Factory',group_code:'SNP_CASUAL',period_from:'2091-10-01',period_to:'2091-10-31'};
const row={id:'row',employee_name:'Synthetic payroll employee',employee_code:'TEST',period_from:run.period_from,period_to:run.period_to,status:'CALCULATED',current_version:1,revision:1,source_fingerprint:'a'.repeat(64),gross_after_lop:'9007199254740993.01',net_salary:null,epf:null,esi:null,pt:null,blockers:[{code:'STATUTORY_PROFILE_REQUIRED'}]};
const actionRow={id:'row',status:'CALCULATED',current_version:1,review_version:2,review_revision:1,source_fingerprint:row.source_fingerprint,available_actions:['calculate','submit']};
const open=props=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><PayrollSheetTable run={run} user={{id:'fm',role:'factory_manager'}} onUpdated={vi.fn()} {...props}/></QueryClientProvider>);
beforeEach(()=>{
 vi.resetAllMocks();reports.getSalaryRegister.mockResolvedValue({data:{register:{rows:[row],total:1}}});
 review.getPayrollReviewQueue.mockResolvedValue({data:{queue:{rows:[actionRow],total:1}}});
 review.actOnPayrollEmployees.mockResolvedValue({data:{results:[{row_id:'row',success:true,status:200}]}});
 review.refreshPayrollRun.mockResolvedValue({data:{generation:{added:0,retained:1,results:[],issues:[],source_checks:[]}}});
});
test('shows exact authoritative amounts and blockers and opens employee details',async()=>{
 const onReviewRow=vi.fn();open({onReviewRow});await screen.findByText('Synthetic payroll employee');
 expect(screen.getByText(row.gross_after_lop)).toBeInTheDocument();expect(screen.getByText('Unavailable / Unavailable / Unavailable')).toBeInTheDocument();
 expect(screen.getByText('STATUTORY_PROFILE_REQUIRED')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'View payroll details'}));expect(onReviewRow).toHaveBeenCalledWith('row');
 expect(reports.getSalaryRegister).toHaveBeenCalledWith({run_id:'run',page:1,limit:20});
});
test('submits selected rows explicitly with versions and fingerprint, without client amounts',async()=>{
 open();fireEvent.click(await screen.findByLabelText('Select payroll Synthetic payroll employee'));
 fireEvent.click(screen.getByRole('button',{name:'Submit selected employees'}));
 await waitFor(()=>expect(review.actOnPayrollEmployees).toHaveBeenCalledWith([{row_id:'row',request:{action:'submit',expected_version:1,expected_review_version:2,source_fingerprint:row.source_fingerprint}}]));
 expect(await screen.findByText('row: Applied')).toBeInTheDocument();
});
test('recalculation requires a reason and sends an explicit calculate action',async()=>{
 open();fireEvent.click(await screen.findByLabelText('Select payroll Synthetic payroll employee'));
 const recalculate=screen.getByRole('button',{name:'Recalculate selected employees'});expect(recalculate).toBeDisabled();
 fireEvent.change(screen.getByLabelText('Recalculation reason'),{target:{value:'Corrected locked attendance'}});fireEvent.click(recalculate);
 await waitFor(()=>expect(review.actOnPayrollEmployees).toHaveBeenCalledWith([{row_id:'row',request:{action:'calculate',expected_version:1,expected_review_version:2,reason:'Corrected locked attendance'}}]));
});
test('refresh flags changed sources without automatically recalculating saved salary',async()=>{
 review.refreshPayrollRun.mockResolvedValue({data:{generation:{added:0,retained:1,results:[],issues:[],source_checks:[{row_id:'row',status:'CHANGED'}]}}});
 open();await screen.findByText('Synthetic payroll employee');fireEvent.click(screen.getByRole('button',{name:'Refresh eligible employees'}));
 expect(await screen.findByText('CHANGED')).toBeInTheDocument();fireEvent.click(screen.getByLabelText('Select payroll Synthetic payroll employee'));
 expect(screen.getByRole('button',{name:'Submit selected employees'})).toBeDisabled();expect(review.actOnPayrollEmployees).not.toHaveBeenCalled();expect(screen.getByText(row.gross_after_lop)).toBeInTheDocument();
});
test('mismatched report and review revisions cannot authorize another salary revision',async()=>{
 review.getPayrollReviewQueue.mockResolvedValue({data:{queue:{rows:[{...actionRow,review_revision:2,source_fingerprint:'b'.repeat(64)}],total:1}}});
 open();expect(await screen.findByLabelText('Select payroll Synthetic payroll employee')).toBeDisabled();expect(screen.getByRole('button',{name:'Submit selected employees'})).toBeDisabled();
});
test('shows population issues and calculation failures alongside successful rows',async()=>{
 open({run:{...run,generation:{added:1,retained:0,issues:[{employee_id:'missing',employee_name:'Missing source employee',code:'ASSIGNMENT_HISTORY_REQUIRED',message:'Record history'}],results:[{row_id:'row',success:true},{row_id:'failed',success:false,code:'PAYROLL_CALCULATION_FAILED',message:'Retry'}]}}});
 await screen.findByText('Synthetic payroll employee');expect(screen.getByText(/Missing source employee/)).toBeInTheDocument();expect(screen.getByLabelText('Initial calculation failures')).toHaveTextContent('failed');
});

test('another factory manager can view the sheet but cannot populate, recalculate or submit it',async()=>{
 open({user:{id:'other-fm',role:'factory_manager'}});await screen.findByText('Synthetic payroll employee');
 expect(screen.queryByRole('button',{name:'Refresh eligible employees'})).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Submit selected employees'})).not.toBeInTheDocument();
 expect(screen.getByLabelText('Select all actionable payroll rows on this page')).toBeDisabled();
 expect(screen.getByLabelText('Select payroll Synthetic payroll employee')).toBeDisabled();
});

test('deleting a draft sheet requires confirmation and reason, then returns to the parent list',async()=>{
 const onDeleted=vi.fn();review.deletePayrollRun.mockResolvedValue({data:{success:true,result:{cancelled_rows:1}}});open({onDeleted});
 fireEvent.click(await screen.findByRole('button',{name:'Delete draft sheet'}));expect(screen.getByRole('dialog',{name:'Delete draft payroll sheet'})).toBeInTheDocument();
 const confirm=screen.getByRole('button',{name:'Confirm delete sheet'});expect(confirm).toBeDisabled();expect(review.deletePayrollRun).not.toHaveBeenCalled();
 fireEvent.change(screen.getByLabelText('Sheet deletion reason'),{target:{value:'Duplicate draft payroll'}});fireEvent.click(confirm);
 await waitFor(()=>expect(review.deletePayrollRun).toHaveBeenCalledWith('run','Duplicate draft payroll'));await waitFor(()=>expect(onDeleted).toHaveBeenCalledOnce());
 expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
test('failed deletion keeps the sheet and confirmation visible with the database conflict',async()=>{
 review.deletePayrollRun.mockRejectedValue({response:{data:{message:'Cannot delete a submitted payroll sheet'}}});const onDeleted=vi.fn();open({onDeleted});
 fireEvent.click(await screen.findByRole('button',{name:'Delete draft sheet'}));fireEvent.change(screen.getByLabelText('Sheet deletion reason'),{target:{value:'Cleanup'}});fireEvent.click(screen.getByRole('button',{name:'Confirm delete sheet'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Cannot delete a submitted payroll sheet');expect(onDeleted).not.toHaveBeenCalled();expect(screen.getByRole('dialog')).toBeInTheDocument();
});
test('non-owner has no delete control; submitted progress disables deletion',async()=>{
 const first=open({user:{id:'other',role:'factory_manager'}});await screen.findByText('Synthetic payroll employee');expect(screen.queryByRole('button',{name:'Delete draft sheet'})).not.toBeInTheDocument();first.unmount();
 open({run:{...run,progress:{accounts:1,ho:0,locked:0}}});expect(await screen.findByRole('button',{name:'Delete draft sheet'})).toBeDisabled();
});
test('keeping a sheet closes confirmation without a deletion request',async()=>{
 open();fireEvent.click(await screen.findByRole('button',{name:'Delete draft sheet'}));fireEvent.click(screen.getByRole('button',{name:'Keep sheet'}));expect(screen.queryByRole('dialog')).not.toBeInTheDocument();expect(review.deletePayrollRun).not.toHaveBeenCalled();
});
