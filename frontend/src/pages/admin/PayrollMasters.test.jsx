import React from 'react';
import {describe,it,expect,beforeEach,vi} from 'vitest';
import {render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {MemoryRouter} from 'react-router-dom';
import {ModalProvider} from '../../components/ModalContext';
import PayrollMasters from './PayrollMasters';
import { newStatutoryConfiguration, withContributionBasis, statutoryDraftInput } from '../../components/payroll/statutoryPresets';
import * as api from '../../api/payrollMastersApi';
import * as profiles from '../../api/payrollProfilesApi';
vi.mock('../../api/payrollProfilesApi');
vi.mock('../../api/payrollMastersApi');
let role='admin';vi.mock('../../components/AuthContext',()=>({useAuth:()=>({user:{role}})}));
function mount(kind='policies',statutoryRole='accounts'){if(kind==='statutory')role=statutoryRole;return render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}})}><ModalProvider><MemoryRouter><PayrollMasters kind={kind}/></MemoryRouter></ModalProvider></QueryClientProvider>);}
const empty={revisions:[],events:[],total:0,groups:[{code:'HO_STAFF'}]};
beforeEach(()=>{vi.resetAllMocks();profiles.getCompanyDeductionSetups.mockResolvedValue({data:{result:{setups:[],total:0}}});profiles.getStatutoryProfileContext.mockResolvedValue({data:{result:{scopes:[],bindings:[],total:0}}});profiles.getStatutoryStates.mockResolvedValue({data:{result:[{id:'assam',name:'Assam'},{id:'bihar',name:'Bihar'},{id:'wb',name:'West Bengal'},{id:'odisha',name:'Odisha'}]}});role='admin';api.listPayrollMasters.mockResolvedValue({data:{result:empty}});api.savePayrollMaster.mockResolvedValue({data:{result:{id:'draft'}}});});
describe('Admin payroll master screens',()=>{
 it('shows empty state and approved business method distinct from publication',async()=>{mount();expect(await screen.findByText(/No master revisions/)).toBeInTheDocument();expect(screen.getByText(/Fixed 30 is the currently approved/)).toBeInTheDocument();});
 it('loading, server error and retry are visible',async()=>{api.listPayrollMasters.mockImplementation(()=>new Promise(()=>{}));const view=mount();expect(screen.getByText(/Loading revisions/)).toBeInTheDocument();view.unmount();api.listPayrollMasters.mockRejectedValue(new Error('Synthetic API unavailable'));mount();expect(await screen.findByRole('alert')).toHaveTextContent('Synthetic API unavailable');expect(screen.getByRole('button',{name:'Retry'})).toBeInTheDocument();});
 it('draft saves independent methods and exact decimal strings, then refreshes',async()=>{mount();await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));fireEvent.change(screen.getByLabelText(/Effective from/),{target:{value:'2090-01-01'}});fireEvent.change(screen.getByLabelText(/Effective to/),{target:{value:'2099-12-31'}});fireEvent.change(screen.getByLabelText(/Change reason/),{target:{value:'Synthetic policy evidence'}});fireEvent.change(screen.getByLabelText('Unpaid-leave deduction'),{target:{value:'ACTUAL_CALENDAR_DAYS'}});expect(screen.queryByLabelText('Days used for unpaid leave')).not.toBeInTheDocument();expect(screen.getByLabelText('Joining/leaving salary calculation')).toHaveValue('UNRESOLVED');fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(api.savePayrollMaster).toHaveBeenCalled());expect(api.savePayrollMaster.mock.calls[0][1].data).toMatchObject({lop_method:'ACTUAL_CALENDAR_DAYS',lop_fixed_divisor:null,partial_month_proration_method:'UNRESOLVED',sandwich_enabled:false});expect(await screen.findByText(/Draft saved/)).toBeInTheDocument();});
 it('Accounts authoring has no confirmation dropdown or manual identity fields',async()=>{mount('statutory');await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('');expect(screen.queryByLabelText('Accounts setup confirmation')).not.toBeInTheDocument();expect(screen.queryByLabelText(/Setup confirmed by/)).not.toBeInTheDocument();expect(screen.getByText(/Accounts confirmation is recorded automatically/)).toBeInTheDocument();expect(screen.queryByRole('option',{name:/Recorded basic/})).not.toBeInTheDocument();fireEvent.change(screen.getByLabelText('Scheme'),{target:{value:'PT'}});fireEvent.click(screen.getByRole('button',{name:'Add slab'}));expect(screen.getByLabelText('Slab 1 deduction amount')).toBeInTheDocument();});
 it('publish requires preview, approval reference and explicit acknowledgement',async()=>{
  const r={id:'draft',status:'DRAFT',version:1,group_code:'HO_STAFF',effective_from:'2090-01-01',effective_to:'2099-12-31',lop_method:'FIXED_DIVISOR',lop_fixed_divisor:'30'};
  api.listPayrollMasters.mockResolvedValue({data:{result:{...empty,revisions:[r],total:1}}});api.previewPayrollPublication.mockResolvedValue({data:{result:{revision:r,diff:[{field:'lop_method',before:null,after:'FIXED_DIVISOR'}],supersedes:[],blockers:[{field:'full_month_unpaid_treatment',code:'UNRESOLVED'}],conflicts:[],affected_draft_rows:0,publishable:true,preview_token:'token'}}});api.publishPayrollMaster.mockResolvedValue({data:{result:{...r,status:'PUBLISHED'}}});mount();fireEvent.click(await screen.findByRole('button',{name:'Review publication'}));const button=await screen.findByRole('button',{name:'Publish revision'});expect(button).toBeDisabled();fireEvent.change(screen.getByLabelText(/Supporting approval reference/),{target:{value:'Synthetic signed approval'}});expect(button).toBeDisabled();fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed the rules/}));expect(button).toBeEnabled();fireEvent.click(button);await waitFor(()=>expect(api.publishPayrollMaster).toHaveBeenCalledWith('policies','draft',{expected_version:1,preview_token:'token',approval_reference:'Synthetic signed approval'}));
 });
 it('non-Admin direct screen exposes no writes or master reads',()=>{role='accounts';mount();expect(screen.getByRole('alert')).toHaveTextContent('Admin');expect(api.listPayrollMasters).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'Create draft'})).not.toBeInTheDocument();});
});

it('only bonus and arrears need adjustment choices; recovery is automatic',async()=>{
 mount('statutory');await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));
 fireEvent.click(screen.getByText(/Advanced settings —/));
 expect(screen.getByLabelText('Bonus contribution treatment')).toHaveValue('UNRESOLVED');
 expect(screen.getByLabelText('Salary arrears contribution treatment')).toHaveValue('UNRESOLVED');
 for(const label of ['Eligibility','Calculation method','Jurisdiction conditions','LOP statutory component allocation','Included arrears contribution period','Statutory rounding method','Statutory decimal places','Statutory rounding stage','RECOVERY statutory basis','REIMBURSEMENT statutory basis'])expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
 expect(screen.queryByRole('checkbox',{name:/ADJUSTMENTS/})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Bonus contribution treatment'),{target:{value:'EXCLUDE'}});
 expect(screen.getByLabelText('Salary arrears contribution treatment')).toHaveValue('UNRESOLVED');
 expect(screen.getByText(/Advance recoveries are saved as separate salary deductions/)).toBeInTheDocument();
});

describe('simplified statutory authoring', () => {
 async function create() { mount('statutory'); await screen.findByText(/No master revisions/); fireEvent.click(screen.getByRole('button', { name: 'Create draft' })); }
 const change = (label, value) => fireEvent.change(within(screen.getByRole('button', { name: 'Save draft' }).closest('form')).getByLabelText(label), { target: { value } });
 it('keeps technical settings collapsed and requires a deliberate wage basis', async () => {
  await create();
  expect(screen.getByText(/Advanced settings —/).closest('details')).not.toHaveAttribute('open');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect(screen.queryByLabelText(/Contribution minimum/i)).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Eligibility ceiling \(₹\)/)).not.toBeInTheDocument();
  change(/Contribution wage basis/, 'GROSS_ONLY');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  change(/Contribution wage basis/, 'CUSTOM');
  await waitFor(() => expect(screen.getByText(/Advanced settings —/).closest('details')).toHaveAttribute('open'));
 });
 it('saves exact preset strings with explicit wages and server-owned Accounts confirmation', async () => {
  await create();
  change(/Effective from/, '2027-01-01');
  await waitFor(() => expect(screen.getByLabelText(/Jurisdiction \/ state/)).not.toBeDisabled());
  change(/Jurisdiction \/ state/, 'wb'); change(/Establishment/, 'SNP Factory');
  change(/Contribution wage basis/, 'GROSS_ONLY'); change(/Change reason/, 'UAT standard EPF');
  expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('');
  fireEvent.click(screen.getByRole('button', { name: 'Apply standard preset' }));
  expect(screen.getByLabelText(/Wage ceiling \(₹\)/)).toHaveValue('25000');
  expect(screen.queryByLabelText('Accounts setup confirmation')).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Contribution wage basis/)).toHaveValue('GROSS_ONLY');
  expect(screen.getByRole('button', { name: 'Save draft' })).toBeEnabled();
  expect(Array.from(screen.getByRole('button', { name: 'Save draft' }).closest('form').elements).filter(el => !el.checkValidity()).map(el => ({ id: el.id, value: el.value }))).toEqual([]);
  fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
  await waitFor(() => expect(api.savePayrollMaster).toHaveBeenCalledTimes(1));
  expect(api.savePayrollMaster.mock.calls[0][1].data).toMatchObject({
   scheme: 'EPF', configuration: {
    employee_rate: '12', employer_rate: '12', wage_ceiling: '25000', eligibility_ceiling: null,
    included_components: ['PACKAGE_BALANCE'], calculation_method: 'CAPPED_WAGE_PERCENTAGE',
    collection_timing: 'INCREMENTAL_MONTHLY', lop_wage_basis: 'PROPORTIONAL_COMPONENTS', adjustment_basis: { RECOVERY: 'DEDUCTION_ONLY', REIMBURSEMENT: 'UNRESOLVED' }, rounding: { method: 'HALF_UP', precision: 0, stage: 'MONTH' }
   }
  });
  expect(api.savePayrollMaster.mock.calls[0][1].data).not.toHaveProperty('preset');
  expect(api.savePayrollMaster.mock.calls[0][1].data).not.toHaveProperty('verification_status');
  expect(api.savePayrollMaster.mock.calls[0][1].data).not.toHaveProperty('advisor_name');
 });
 it('switches scheme without retaining incompatible rates, slabs or wage decisions', async () => {
  await create(); change(/Effective from/, '2027-01-01');
  fireEvent.click(screen.getByRole('button', { name: 'Apply standard preset' }));
  change(/Contribution wage basis/, 'GROSS_ONLY');
  change('Scheme', 'ESI');
  expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('');
  expect(screen.getByLabelText(/Contribution wage basis/)).toHaveValue('');
  expect(screen.queryByLabelText(/Wage ceiling \(₹\)/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply standard preset' }));
  expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('0.75');
  expect(screen.getByLabelText(/Eligibility ceiling \(₹\)/)).toHaveValue('21000');
  expect(screen.queryByLabelText('Accounts setup confirmation')).not.toBeInTheDocument();
  change('Scheme', 'PT');
  expect(screen.queryByRole('button', { name: 'Apply standard preset' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/Eligibility ceiling \(₹\)/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Add slab' }));
  expect(screen.getByLabelText('Slab 1 deduction amount')).toBeInTheDocument();
  change('Scheme', 'EPF');
  expect(screen.queryByLabelText('Slab 1 deduction amount')).not.toBeInTheDocument();
 });
 it('warns on date changes without overwriting manually edited rates', async () => {
  await create(); change(/Effective from/, '2025-01-01');
  fireEvent.click(screen.getByRole('button', { name: 'Apply standard preset' }));
  change(/employee rate \(%\)/, '7.1234'); change(/Effective from/, '2026-10-01');
  expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('7.1234');
  expect(screen.getByLabelText(/Wage ceiling \(₹\)/)).toHaveValue('15000');
  expect(screen.getByText(/effective date changed after applying/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Apply standard preset' }));
  expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('12');
  expect(screen.getByLabelText(/Wage ceiling \(₹\)/)).toHaveValue('25000');
  change(/Effective from/, '2026-09-01');
  expect(screen.queryByRole('button', { name: 'Apply standard preset' })).not.toBeInTheDocument();
 });
});

it('opening and saving a legacy draft preserves exact amounts, evidence and advanced settings', async () => {
 const data = {
  scheme: 'ESI', jurisdiction: 'West Bengal', state_id: 'wb', establishment: 'Saved Factory', effective_from: '2027-01-01', effective_to: null, reason: 'Existing evidence', slabs: [],
  verification_status: 'ACCOUNTS_CONFIRMED', advisor_name: 'Saved owner', verification_reference: 'SAVED-REFERENCE', verified_on: '2026-10-01',
  configuration: { ...withContributionBasis(newStatutoryConfiguration('ESI'), ['PACKAGE_BALANCE', 'DAILY_WAGE']), employee_rate: '7.1234', employer_rate: '9.9876', contribution_minimum: '123.45', contribution_cap: '789.01', calculation_method: 'CAPPED_WAGE_PERCENTAGE', wage_ceiling: '54321.12', eligibility_ceiling: '45678.90', collection_timing: 'MONTH_CLOSE', rounding: { method: 'HALF_EVEN', precision: 4, stage: 'AGGREGATE' } }
 };
 const original = structuredClone(data);
 api.listPayrollMasters.mockResolvedValue({ data: { result: { ...empty, revisions: [{ id: 'saved', version: 4, status: 'DRAFT', ...data, data }], total: 1 } } });
 mount('statutory');
 fireEvent.click(await screen.findByRole('button', { name: 'Edit draft' }));
 await waitFor(() => expect(screen.getByLabelText(/Jurisdiction \/ state/)).not.toBeDisabled());
 expect(screen.getByText(/Saved contribution limits are unsupported/)).toBeInTheDocument();
 expect(screen.getByLabelText(/employee rate \(%\)/)).toHaveValue('7.1234');
 expect(screen.getByText(/contribution wage cap ₹54321.12/)).toBeInTheDocument();
 expect(screen.getByText(/4 decimal places/)).toBeInTheDocument();
 expect(screen.queryByLabelText('Accounts setup confirmation')).not.toBeInTheDocument();
 expect(screen.getByText(/Advanced settings —/).closest('details')).not.toHaveAttribute('open');
 fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
 await waitFor(() => expect(api.savePayrollMaster).toHaveBeenCalledWith('statutory', { id: 'saved', expected_version: 4, data: statutoryDraftInput(original) }));
 expect(data).toEqual(original);
});
it.each(['admin', 'ho', 'zo', 'je'])('%s cannot author deduction presets', role => {
 mount('statutory', role);
 expect(screen.getByRole('alert')).toHaveTextContent('Accounts only');
 expect(api.listPayrollMasters).not.toHaveBeenCalled();
 expect(screen.queryByRole('button', { name: 'Create draft' })).not.toBeInTheDocument();
});

it('a stored retired component requires an explicit supported replacement before saving', async () => {
 const data={scheme:'EPF',jurisdiction:'West Bengal',state_id:'wb',establishment:'Stored component factory',effective_from:'2027-01-01',effective_to:null,reason:'UAT replacement',slabs:[],configuration:{...newStatutoryConfiguration(),included_components:['BASIC'],excluded_components:['STAFF_WELFARE','OTHER_FIXED','PACKAGE_BALANCE','DAILY_WAGE','OVERTIME','HOLIDAY_PREMIUM','ADJUSTMENTS']}};
 api.listPayrollMasters.mockResolvedValue({data:{result:{...empty,revisions:[{id:'retired',version:1,status:'DRAFT',...data,data}],total:1}}});mount('statutory');
 fireEvent.click(await screen.findByRole('button',{name:'Edit draft'}));
 expect(screen.getByText(/This rule uses retired salary components/)).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Save draft'})).toBeDisabled();
 expect(screen.queryByRole('option',{name:/Recorded basic/})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText(/Contribution wage basis/),{target:{value:'GROSS_ONLY'}});
 expect(screen.queryByText(/This rule uses retired salary components/)).not.toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Save draft'})).toBeEnabled();
});

it('split-run collection is optional and saved with explicit bonus decisions', async () => {
 mount('statutory'); await screen.findByText(/No master revisions/);
 fireEvent.click(screen.getByRole('button',{name:'Create draft'}));
 const change=(label,value)=>fireEvent.change(within(screen.getByRole('button',{name:'Save draft'}).closest('form')).getByLabelText(label),{target:{value}});
 change(/Effective from/,'2027-01-01');
 await waitFor(()=>expect(screen.getByLabelText(/Jurisdiction \/ state/)).not.toBeDisabled());
 change(/Jurisdiction \/ state/,'wb'); change(/Establishment/,'UAT Factory');
 change(/Contribution wage basis/,'GROSS_ONLY'); change(/Change reason/,'UAT collection override');
 fireEvent.click(screen.getByRole('button',{name:'Apply standard preset'}));
 fireEvent.click(screen.getByText(/Advanced settings —/));
 expect(screen.queryByLabelText('Collection timing')).not.toBeInTheDocument();
 fireEvent.click(screen.getByLabelText('Change collection timing for split runs'));
 change('Collection timing','MONTH_CLOSE');
 change('Bonus contribution treatment','INCLUDE');
 change('Salary arrears contribution treatment','EXCLUDE');
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));
 await waitFor(()=>expect(api.savePayrollMaster).toHaveBeenCalledTimes(1));
 expect(api.savePayrollMaster.mock.calls[0][1].data.configuration).toMatchObject({collection_timing:'MONTH_CLOSE',adjustment_basis:{BONUS:'INCLUDE',SALARY_ARREARS:'EXCLUDE',RECOVERY:'DEDUCTION_ONLY'}});
});

it('initial publication requires a fresh explicit preview and carries the mode on publish',async()=>{
 const r={id:'draft',status:'DRAFT',version:1,group_code:'HO_STAFF',effective_from:'2025-01-01',effective_to:'2025-12-31',lop_method:'FIXED_DIVISOR',lop_fixed_divisor:'30'};
 api.listPayrollMasters.mockResolvedValue({data:{result:{...empty,revisions:[r],total:1}}});
 const result={revision:r,diff:[],supersedes:[],blockers:[],conflicts:[{code:'FUTURE_MONTH_START_REQUIRED'}],publishable:false,preview_token:'normal'};
 api.previewPayrollPublication.mockResolvedValueOnce({data:{result}}).mockResolvedValueOnce({data:{result:{...result,conflicts:[],initial_setup:true,publishable:true,preview_token:'initial'}}});
 api.publishPayrollMaster.mockResolvedValue({data:{result:{...r,status:'PUBLISHED'}}});
 mount();fireEvent.click(await screen.findByRole('button',{name:'Review publication'}));
 expect(await screen.findByText('Effective date must be the 1st of a future month.')).toBeInTheDocument();
 fireEvent.click(screen.getByRole('checkbox',{name:'Initial payroll setup for a past or current month'}));
 await waitFor(()=>expect(api.previewPayrollPublication).toHaveBeenLastCalledWith('policies','draft',true));
 await waitFor(()=>expect(screen.queryByText('Effective date must be the 1st of a future month.')).not.toBeInTheDocument());
 expect(screen.getByRole('button',{name:'Publish revision'})).toBeDisabled();
 fireEvent.change(screen.getByLabelText(/Supporting approval reference/),{target:{value:'Initial setup approval'}});
 fireEvent.click(screen.getByRole('checkbox',{name:/I reviewed the rules/}));
 fireEvent.click(screen.getByRole('button',{name:'Publish revision'}));
 await waitFor(()=>expect(api.publishPayrollMaster).toHaveBeenCalledWith('policies','draft',{expected_version:1,preview_token:'initial',approval_reference:'Initial setup approval',initial_setup:true}));
});

it('policy settings require an explicit action and preserve independent salary methods', async()=>{
 mount(); await screen.findByText(/No master revisions/); fireEvent.click(screen.getByRole('button',{name:'Create draft'}));
 expect(screen.getByText('Additional rules and rounding').closest('details')).not.toHaveAttribute('open');
 expect(within(screen.getByLabelText('Joining/leaving salary calculation')).queryByRole('option',{name:'WORK CALENDAR'})).not.toBeInTheDocument();
 fireEvent.change(screen.getByLabelText('Joining/leaving salary calculation'),{target:{value:'ACTUAL_CALENDAR_DAYS'}});
 fireEvent.click(screen.getByRole('button',{name:'Use standard calculation settings'}));
 expect(screen.getByLabelText('Unpaid-leave deduction')).toHaveValue('FIXED_DIVISOR');
 expect(screen.getByLabelText('Joining/leaving salary calculation')).toHaveValue('ACTUAL_CALENDAR_DAYS');
 expect(screen.getByLabelText('lop precision')).toHaveValue(2);
 expect(screen.getByLabelText('Split-run allocation')).toHaveValue('CALENDAR_WEIGHTED_WITH_RESIDUAL');
});
it('salary policy end date is optional and cleared dates save as null',async()=>{
 mount();await screen.findByText(/No master revisions/);fireEvent.click(screen.getByRole('button',{name:'Create draft'}));
 const end=screen.getByLabelText('Effective to');expect(end).not.toBeRequired();
 fireEvent.change(screen.getByLabelText(/Effective from/),{target:{value:'2090-01-01'}});
 fireEvent.change(end,{target:{value:'2099-12-31'}});fireEvent.change(end,{target:{value:''}});
 fireEvent.change(screen.getByLabelText(/Change reason/),{target:{value:'Ongoing default policy'}});
 fireEvent.click(screen.getByRole('button',{name:'Save draft'}));await waitFor(()=>expect(api.savePayrollMaster).toHaveBeenCalled());
 expect(api.savePayrollMaster.mock.calls[0][1].data.effective_to).toBeNull();
});
