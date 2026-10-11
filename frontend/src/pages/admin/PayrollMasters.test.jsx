import React from 'react';
import {describe,it,expect,beforeEach,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {ModalProvider} from '../../components/ModalContext';
import PayrollMasters from './PayrollMasters';
import * as api from '../../api/payrollMastersApi';
vi.mock('../../api/payrollMastersApi');
let role='admin';vi.mock('../../components/AuthContext',()=>({useAuth:()=>({user:{role}})}));
function mount(kind='policies'){return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><ModalProvider><MemoryRouter><PayrollMasters kind={kind}/></MemoryRouter></ModalProvider></QueryClientProvider>);}
const empty={revisions:[],events:[],total:0,groups:[{code:'HO_STAFF'}]};
beforeEach(()=>{vi.resetAllMocks();role='admin';api.listPayrollMasters.mockResolvedValue({data:{result:empty}});api.savePayrollMaster.mockResolvedValue({data:{result:{id:'draft'}}});});
describe('Admin payroll master screens',()=>{
 it('shows empty state and approved business method distinct from publication',async()=>{mount();expect(await screen.findByText(/No master revisions/)).toBeInTheDocument();expect(screen.getByText(/Fixed 30 is the currently approved/)).toBeInTheDocument();});
 it('loading, server error and retry are visible',async()=>{api.listPayrollMasters.mockImplementation(()=>new Promise(()=>{}));const view=mount();expect(screen.getByText(/Loading revisions/)).toBeInTheDocument();view.unmount();api.listPayrollMasters.mockRejectedValue(new Error('Synthetic API unavailable'));mount();expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic API unavailable');expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();});
 it('draft saves independent methods and exact decimal strings, then refreshes',async()=>{mount();await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));fireEvent.change(screen.getByLabelText(/Effective from/),{target:{value:'2090-01-01'}});fireEvent.change(screen.getByLabelText(/Effective to/),{target:{value:'2099-12-31'}});fireEvent.change(screen.getByLabelText(/Change reason/),{target:{value:'Synthetic policy evidence'}});fireEvent.change(screen.getByLabelText('LOP method'),{target:{value:'ACTUAL_CALENDAR_DAYS'}});expect(screen.queryByLabelText('LOP fixed divisor')).not.toBeInTheDocument();expect(screen.getByLabelText('Joining/leaving proration')).toHaveValue('UNRESOLVED');fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(api.savePayrollMaster).toHaveBeenCalled());expect(api.savePayrollMaster.mock.calls[0][1].data).toMatchObject({lop_method:'ACTUAL_CALENDAR_DAYS',lop_fixed_divisor:null,partial_month_proration_method:'UNRESOLVED',sandwich_enabled:false});expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();});
 it('statutory draft has no invented rates and separate advisor evidence fields',async()=>{mount('statutory');await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));expect(screen.getByLabelText('employee rate (%)')).toHaveValue('');expect(screen.getByLabelText('employer rate (%)')).toHaveValue('');expect(screen.getByLabelText('Advisor verification')).toHaveValue('UNVERIFIED');fireEvent.change(screen.getByLabelText('Advisor verification'),{target:{value:'ADVISOR_VERIFIED'}});expect(screen.getByLabelText(/Verification evidence reference/)).toBeInTheDocument();fireEvent.change(screen.getByLabelText('Scheme'),{target:{value:'PT'}});expect(screen.queryByLabelText('employee rate (%)')).not.toBeInTheDocument();fireEvent.click(screen.getByRole('button',{name:'Add slab'}));expect(screen.getByLabelText('Slab 1 deduction amount')).toBeInTheDocument();});
 it('changing statutory financial rules clears prior advisor verification',async()=>{
  mount('statutory');await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));
  fireEvent.change(screen.getByLabelText('Advisor verification'),{target:{value:'ADVISOR_VERIFIED'}});
  fireEvent.change(screen.getByLabelText(/Verification evidence reference/),{target:{value:'Old synthetic evidence'}});
  fireEvent.change(screen.getByLabelText('employee rate (%)'),{target:{value:'7.125'}});
  expect(screen.getByLabelText('Advisor verification')).toHaveValue('UNVERIFIED');expect(screen.queryByLabelText(/Verification evidence reference/)).not.toBeInTheDocument();
 });
 it('publish requires preview, approval reference and explicit acknowledgement',async()=>{
  const r={id:'draft',status:'DRAFT',version:1,group_code:'HO_STAFF',effective_from:'2090-01-01',effective_to:'2099-12-31',lop_method:'FIXED_DIVISOR',lop_fixed_divisor:'30'};
  api.listPayrollMasters.mockResolvedValue({data:{result:{...empty,revisions:[r],total:1}}});api.previewPayrollPublication.mockResolvedValue({data:{result:{revision:r,diff:[{field:'lop_method',before:null,after:'FIXED_DIVISOR'}],supersedes:[],blockers:[{field:'full_month_unpaid_treatment',code:'UNRESOLVED'}],conflicts:[],affected_draft_rows:0,publishable:true,preview_token:'token'}}});api.publishPayrollMaster.mockResolvedValue({data:{result:{...r,status:'PUBLISHED'}}});mount();fireEvent.click(await screen.findByRole('button',{name:'Review publication'}));const button=await screen.findByRole('button',{name:'Publish revision'});expect(button).toBeDisabled();fireEvent.change(screen.getByLabelText(/Supporting approval reference/),{target:{value:'Synthetic signed approval'}});expect(button).toBeDisabled();fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed the rules/}));expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(api.publishPayrollMaster).toHaveBeenCalledWith('policies','draft',{expected_version:1,preview_token:'token',approval_reference:'Synthetic signed approval'}));
 });
 it('non-Admin direct screen exposes no writes or master reads',()=>{role='accounts';mount();expect(screen.getByRole('alert')).toHaveTextContent('Admin');expect(api.listPayrollMasters).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Create draft'})).not.toBeInTheDocument();});
});

it('typed wage basis starts unresolved and never derives treatment from the aggregate',async()=>{
 mount('statutory');await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));
 for(const type of ['SALARY ARREARS','BONUS','REIMBURSEMENT','RECOVERY'])expect(screen.getByLabelText(`${type} statutory basis`)).toHaveValue('UNRESOLVED');
 expect(screen.queryByRole('checkbox',{name:/ADJUSTMENTS/})).not.toBeInTheDocument();
 expect(Array.from(screen.getByLabelText('RECOVERY statutory basis').options).map(o=>o.value)).toEqual(['UNRESOLVED','DEDUCTION_ONLY']);
 fireEvent.change(screen.getByLabelText('BONUS statutory basis'),{target:{value:'EXCLUDE'}});
 expect(screen.getByLabelText('SALARY ARREARS statutory basis')).toHaveValue('UNRESOLVED');
});
