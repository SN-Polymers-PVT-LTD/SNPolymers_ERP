import React from 'react';
import {test,expect,vi,beforeEach} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import PayrollSalaryDates from './PayrollSalaryDates';
import * as api from '../../api/hrPayStructuresApi';
vi.mock('../../api/hrPayStructuresApi');
const employee={id:'employee',joining_date:'2025-01-01',employee_category:'SNP Permanent Factory Labour',department:'SNP Factory'};
const mount=()=>render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><PayrollSalaryDates employee={employee} revisions={[{id:'salary',status:'Active',revision_number:1,pay_basis:'Monthly salary',guaranteed_monthly_gross:'18000.00'}]}/></QueryClientProvider>);
beforeEach(()=>{vi.resetAllMocks();api.getPayrollSalaryContext.mockResolvedValue({data:{result:{version:0,assignment_version:0,intervals:[]}}});api.savePayrollSalary.mockResolvedValue({data:{success:true}});api.initializePayrollAssignment.mockResolvedValue({data:{success:true}});});
test('initial setup requires a confirmed date, existing salary identity and reason without copying pay terms',async()=>{
 mount();await screen.findByText(/Confirm when the recorded salary/);
 const button=screen.getByRole('button',{name:'Confirm existing salary dates'});expect(button).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/Setup applies from/),{target:{value:'2025-01-01'}});fireEvent.change(screen.getByLabelText('Salary setup reason'),{target:{value:'Confirmed historical pay'}});fireEvent.change(screen.getByLabelText('Existing salary to link'),{target:{value:'salary'}});fireEvent.click(button);
 await waitFor(()=>expect(api.savePayrollSalary).toHaveBeenCalledWith({employee_id:'employee',existing_id:'salary',effective_from:'2025-01-01',expected_version:0,pay:null,reason:'Confirmed historical pay'}));expect(await screen.findByText(/Effective dates saved/)).toBeInTheDocument();
});
test('existing dated history is displayed and cannot be initialized again',async()=>{
 api.getPayrollSalaryContext.mockResolvedValue({data:{result:{version:1,assignment_version:1,intervals:[{effective_from:'2025-01-01',effective_to:null}]}}});mount();expect(await screen.findByText('Salary applies from 2025-01-01 to ongoing.')).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Confirm existing salary dates'})).not.toBeInTheDocument();
});
test('initial assignment clearly displays the category and department being confirmed',async()=>{
 mount();await screen.findByText(/Assignment to confirm/);fireEvent.change(screen.getByLabelText(/Setup applies from/),{target:{value:'2025-01-01'}});fireEvent.change(screen.getByLabelText('Salary setup reason'),{target:{value:'Confirmed assignment'}});fireEvent.click(screen.getByRole('button',{name:'Confirm initial payroll assignment'}));await waitFor(()=>expect(api.initializePayrollAssignment).toHaveBeenCalledWith({employee_id:'employee',effective_from:'2025-01-01',reason:'Confirmed assignment'}));
});
