import React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,test,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import EmployeeAdjustments from './EmployeeAdjustments';import PayrollPeriodSetup from './PayrollPeriodSetup';import * as api from '../../api/payrollLedgerApi';vi.mock('../../api/payrollLedgerApi');
const wrap=node=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>);
const advance={id:'advance',kind:'ADVANCE',amount:'1000.00',status:'DRAFT',version:1,effective_date:'2026-10-01',created_by:'accounts',installment:'333.33',outstanding_balance:'1000.00',history:[]};
beforeEach(()=>{vi.resetAllMocks();api.getEmployeeAdjustments.mockResolvedValue({data:{result:{rows:[advance],total:1}}});api.actOnAdjustment.mockResolvedValue({data:{result:{}}});api.createEmployeeAdjustment.mockResolvedValue({data:{result:{}}});api.setPayrollCutoff.mockResolvedValue({data:{result:{}}});api.publishPayrollCalendar.mockResolvedValue({data:{result:{}}});});
test('HO reviews an employee advance independently with a reason/version and no payment action',async()=>{
 wrap(<EmployeeAdjustments employeeId="employee" rowId="row" user={{id:'ho',role:'ho'}}/>);expect(await screen.findByText(/Outstanding 1000.00/)).toBeInTheDocument();const approve=screen.getByRole('button',{name:'approve ADVANCE'});expect(approve).toBeDisabled();fireEvent.change(screen.getByLabelText('Adjustment approval / plan reason'),{target:{value:'Approved issued advance evidence'}});fireEvent.click(approve);await waitFor(()=>expect(api.actOnAdjustment).toHaveBeenCalledWith('advance',{action:'approve',expected_version:1,reason:'Approved issued advance evidence',data:{}}));expect(screen.queryByRole('button',{name:/Pay|Transfer|Disburse/})).not.toBeInTheDocument();
});
test('Accounts can record advances while bonus and arrears entry are paused',async()=>{
 api.getEmployeeAdjustments.mockResolvedValue({data:{result:{rows:[
  advance, {...advance,id:'bonus',kind:'BONUS'}, {...advance,id:'arrears',kind:'SALARY_ARREARS'},
 ],total:3}}});
 wrap(<EmployeeAdjustments employeeId="employee" user={{id:'accounts',role:'accounts'}}/>);
 expect(await screen.findByText(/Outstanding 1000.00/)).toBeInTheDocument();
 expect(screen.queryByText(/bonus|arrears/i)).not.toBeInTheDocument();
 expect(screen.queryByLabelText('Adjustment kind')).not.toBeInTheDocument();
 for (const [field,value] of Object.entries({amount:'1000.25','effective date':'2026-10-05','evidence reference':'Advance receipt',installment:'250','recovery start month':'2026-11-01'})) {
  fireEvent.change(screen.getByLabelText(new RegExp('^Adjustment '+field)),{target:{value}});
 }
 fireEvent.click(screen.getByRole('button',{name:'Record for HO approval'}));
 await waitFor(()=>expect(api.createEmployeeAdjustment).toHaveBeenCalledWith('employee',expect.objectContaining({
  kind:'ADVANCE', amount:'1000.25', target_row_id:null, installment:'250', recovery_start_month:'2026-11-01',
 })));
});
test('HO cannot approve an adjustment they created',async()=>{api.getEmployeeAdjustments.mockResolvedValue({data:{result:{rows:[{...advance,created_by:'ho'}],total:1}}});wrap(<EmployeeAdjustments employeeId="employee" rowId="row" user={{id:'ho',role:'ho'}}/>);await screen.findByText(/Outstanding 1000.00/);expect(screen.queryByRole('button',{name:'approve ADVANCE'})).not.toBeInTheDocument();});
test('cutoff uses independent HO approval and retains the expected proposal version',async()=>{
 wrap(<PayrollPeriodSetup run={{id:'run',group_code:'HO_STAFF',department:'Head Office'}} cutoff={{version:1,status:'PROPOSED',cutoff_at:'2026-11-01T00:00:00Z'}} user={{id:'ho',role:'ho'}}/>);fireEvent.change(screen.getByLabelText(/^Cutoff approval evidence/),{target:{value:'Approved cutoff record'}});fireEvent.click(screen.getByRole('button',{name:'Approve cutoff'}));await waitFor(()=>expect(api.setPayrollCutoff).toHaveBeenCalledWith('run',{action:'approve',expected_version:1,cutoff_at:null,evidence_reference:'Approved cutoff record'}));
});
test('calendar publication uses explicit paid rest-day classification, no inferred weekdays',async()=>{
 wrap(<PayrollPeriodSetup run={{id:'run',group_code:'HO_STAFF',department:'Head Office'}} user={{id:'ho',role:'ho'}}/>);for(const name of ['Calendar from','Calendar to'])fireEvent.change(screen.getByLabelText(new RegExp('^'+name)),{target:{value:'2026-10-05'}});fireEvent.change(screen.getByLabelText('Calendar day classification'),{target:{value:'Weekly Off'}});fireEvent.change(screen.getByLabelText(/^Calendar evidence reference/),{target:{value:'Approved dated calendar'}});fireEvent.click(screen.getByRole('button',{name:'Publish calendar evidence'}));await waitFor(()=>expect(api.publishPayrollCalendar).toHaveBeenCalledWith({group_code:'HO_STAFF',department:'Head Office',days:[{calendar_date:'2026-10-05',day_type:'Weekly Off',compensation_treatment:'PAID'}],evidence_reference:'Approved dated calendar'}));
});

test('factory payroll links to the shared calendar instead of publishing per employee',()=>{
 wrap(<PayrollPeriodSetup run={{id:'run',group_code:'SNP_PERMANENT',department:'SNP Factory'}} user={{id:'ho',role:'ho'}}/>);
 expect(screen.getByRole('link',{name:'Open factory work calendar',hidden:true})).toHaveAttribute('href','/factory-masters?tab=calendar&department=SNP%20Factory');
 expect(screen.queryByText('Calendar from')).not.toBeInTheDocument();
});
