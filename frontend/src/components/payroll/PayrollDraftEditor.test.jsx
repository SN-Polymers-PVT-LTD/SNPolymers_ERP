import React from 'react';import {describe,it,expect,vi,beforeEach} from 'vitest';import {render,screen,fireEvent,waitFor} from '@testing-library/react';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import PayrollDraftEditor from './PayrollDraftEditor';import * as api from '../../api/payrollReviewApi';vi.mock('../../api/payrollReviewApi');
import {getSalaryRegister} from '../../api/payrollReportsApi';vi.mock('../../api/payrollReportsApi');
const mount=props=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><PayrollDraftEditor {...props}/></QueryClientProvider>);
beforeEach(()=>{vi.resetAllMocks();getSalaryRegister.mockResolvedValue({data:{register:{rows:[],total:0}}});api.getPayrollReviewQueue.mockResolvedValue({data:{queue:{rows:[],total:0}}});});
describe('existing payroll foundation authoring UI',()=>{
 it('Accounts creates an office sheet using existing canonical group/date API, not a financial input',async()=>{
  api.getPayrollFoundationContext.mockResolvedValue({data:{context:{groups:[{code:'HO_STAFF',department:'Head Office'},{code:'SNP_CASUAL',department:'SNP Factory'}]}}});const created={id:'run',created_by:'accounts',group_code:'HO_STAFF',department:'Head Office',period_from:'2091-10-01',period_to:'2091-10-31'};api.generatePayrollRun.mockResolvedValue({data:{run:created}});const change=vi.fn(),updated=vi.fn();mount({user:{id:'accounts',role:'accounts'},onRunChange:change,onUpdated:updated});
  fireEvent.change(await screen.findByLabelText('Payroll group / department'),{target:{value:'HO_STAFF:Head Office'}});expect(screen.queryByRole('option',{name:'SNP_CASUAL / SNP Factory'})).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Draft period from'),{target:{value:'2091-10-01'}});fireEvent.change(screen.getByLabelText('Draft period to'),{target:{value:'2091-10-31'}});fireEvent.click(screen.getByRole('button',{name:'Generate payroll'}));await waitFor(()=>expect(api.generatePayrollRun).toHaveBeenCalledWith({group_code:'HO_STAFF',department:'Head Office',period_from:'2091-10-01',period_to:'2091-10-31',cycle:'Monthly'}));expect(change).toHaveBeenCalledWith({...created,generation:undefined});expect(updated).toHaveBeenCalled();
 });
 it('active FM can prepare either factory without grant controls and cannot select office payroll',async()=>{
  api.getPayrollFoundationContext.mockResolvedValue({data:{context:{groups:[{code:'SNP_CASUAL',department:'SNP Factory'},{code:'FABRIC_CASUAL',department:'Fabric Factory'},{code:'HO_STAFF',department:'Head Office'}]}}});
  api.generatePayrollRun.mockResolvedValue({data:{run:{id:'fabric-run',created_by:'fm'}}});
  mount({user:{id:'fm',role:'factory_manager'},onRunChange:vi.fn(),onUpdated:vi.fn()});
  const group=await screen.findByLabelText('Payroll group / department');
  expect(screen.getByRole('option',{name:'SNP_CASUAL / SNP Factory'})).toBeInTheDocument();
  expect(screen.getByRole('option',{name:'FABRIC_CASUAL / Fabric Factory'})).toBeInTheDocument();
  expect(screen.queryByRole('option',{name:'HO_STAFF / Head Office'})).not.toBeInTheDocument();
  fireEvent.change(group,{target:{value:'FABRIC_CASUAL:Fabric Factory'}});
  fireEvent.change(screen.getByLabelText('Draft period from'),{target:{value:'2091-10-01'}});
  fireEvent.change(screen.getByLabelText('Draft period to'),{target:{value:'2091-10-31'}});
  fireEvent.click(screen.getByRole('button',{name:'Generate payroll'}));
  await waitFor(()=>expect(api.generatePayrollRun).toHaveBeenCalledWith({group_code:'FABRIC_CASUAL',department:'Fabric Factory',period_from:'2091-10-01',period_to:'2091-10-31',cycle:'Monthly'}));
 });
 it('missing factory groups report configuration rather than asking for removed grants',async()=>{
  api.getPayrollFoundationContext.mockResolvedValue({data:{context:{groups:[]}}});
  mount({user:{id:'fm',role:'factory_manager'},onRunChange:vi.fn(),onUpdated:vi.fn()});
  expect(await screen.findByText('No payroll groups available')).toBeInTheDocument();
  expect(screen.getByText(/check payroll configuration/)).toBeInTheDocument();
  expect(screen.queryByText(/set_payroll_factory_scope/)).not.toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Generate payroll'})).toBeDisabled();
 });
 it('FM adds an authoritative candidate interval to its own sheet without client salary values',async()=>{
  const run={id:'run',created_by:'fm',group_code:'SNP_CASUAL',department:'SNP Factory',period_from:'2091-10-01',period_to:'2091-10-31'};api.getPayrollDraftCandidates.mockResolvedValue({data:{selection:{candidates:[{id:'assignment',employee_name:'Synthetic',employee_code:'TEST',payable_from:'2091-10-02',payable_to:'2091-10-10'}],total_intervals:1}}});api.addPayrollDraftEmployee.mockResolvedValue({data:{row:{id:'row'}}});mount({user:{id:'fm',role:'factory_manager'},run,onRunChange:vi.fn(),onUpdated:vi.fn()});
  fireEvent.click(screen.getByText('Add an individual employee interval (exception)'));
  fireEvent.change(await screen.findByLabelText('Evidenced employee assignment'),{target:{value:'assignment'}});expect(screen.getByLabelText('Draft period from')).toHaveValue('2091-10-02');fireEvent.click(screen.getByRole('button',{name:'Add employee draft'}));await waitFor(()=>expect(api.addPayrollDraftEmployee).toHaveBeenCalledWith('run',{assignment_id:'assignment',period_from:'2091-10-02',period_to:'2091-10-10'}));expect(await screen.findByRole('status')).toHaveTextContent('Employee draft added');
 });
 it.each(['admin','ho'])('%s has no salary-preparer controls',role=>{mount({user:{id:role,role},onRunChange:vi.fn(),onUpdated:vi.fn()});expect(screen.queryByRole('button',{name:'Generate payroll'})).not.toBeInTheDocument();expect(api.getPayrollFoundationContext).not.toHaveBeenCalled();});
});
