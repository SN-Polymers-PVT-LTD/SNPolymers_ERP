import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FactoryMasters from './FactoryMasters';
import { useAuth } from '../../components/AuthContext';
import { getFactoryRevisions, getEffectiveFactoryMasters, createFactoryRevision, getFactorySetupImpact, completeFactorySetup } from '../../api/hrFactoryMastersApi';
vi.mock('../../components/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/hrFactoryMastersApi', () => ({ getFactoryRevisions: vi.fn(), getEffectiveFactoryMasters: vi.fn(), createFactoryRevision: vi.fn(), getFactorySetupImpact: vi.fn(), completeFactorySetup: vi.fn() }));
const casual = 'SNP Casual Factory Labour';
function mount(url = '/factory-masters', openForm = true) {
  if(url.includes(encodeURIComponent('Local Daily-Wage Workers'))&&!url.includes('department='))url+='&department=SNP+Factory';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><FactoryMasters /></MemoryRouter></QueryClientProvider>);
  if (openForm && screen.queryByRole('button', { name: 'New revision' })) {
    fireEvent.click(screen.getByRole('button', { name: 'New revision' }));
    if (screen.queryByLabelText(/Reason for this revision/)) fireEvent.change(screen.getByLabelText(/Reason for this revision/), { target: { value: 'Reviewed factory pay rules' } });
  }
  return view;
}
beforeEach(() => {
  vi.resetAllMocks(); useAuth.mockReturnValue({ user: { role: 'factory_manager' } });
  getFactoryRevisions.mockResolvedValue({ data: { revisions: [], pagination: { totalPages: 1 } } });
  getEffectiveFactoryMasters.mockResolvedValue({ data: { wage_revision: null, rule_revision: null } });
  createFactoryRevision.mockResolvedValue({ data: { success: true } });
});
describe('Factory masters', () => {
  it('starts empty, uses explicit effective date, and saves only authoritative wage fields', async () => {
    mount(`/factory-masters?category=${encodeURIComponent(casual)}`); expect(await screen.findByText('No revisions for this category.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Effective From/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Effective From/), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Revision' }));
    await waitFor(() => expect(createFactoryRevision).toHaveBeenCalledWith('wages', { department:'SNP Factory', employee_category: casual, effective_from: '2026-10-01', daily_wage: 400, setup_reason:'Reviewed factory pay rules' }));
    expect(await screen.findByText(/Revision saved/)).toBeInTheDocument();
  });
  it('shows HO a read-only master with no revision form', async () => {
    useAuth.mockReturnValue({ user: { role: 'ho' } }); mount();
    expect(await screen.findByText('No revisions for this category.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save Revision' })).not.toBeInTheDocument();
  });
  it('loads a local rule deep link and saves derived OT/local restrictions', async () => {
    mount(`/factory-masters?tab=rules&category=${encodeURIComponent('Local Daily-Wage Workers')}`);
    expect(await screen.findByText('No revisions for this category.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Holiday Multiplier')).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Standard Duty Hours/)).toHaveValue(12);
    fireEvent.change(screen.getByLabelText(/Effective From/), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Revision' }));
    await waitFor(() => expect(createFactoryRevision).toHaveBeenCalledWith('rules', expect.objectContaining({
      employee_category: 'Local Daily-Wage Workers', ot_method: 'Derived from daily wage', ot_rate: null, ot_multiplier: 1,
      holiday_pay_enabled: false, holiday_multiplier: null, double_duty_multiplier: 2, short_hours_treatment: null
    })));
  });
  it('category change clears unsaved form fields and applies the correct starting references', async () => {
    mount('/factory-masters?tab=rules');
    expect(await screen.findByText('No revisions for this category.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Effective From/), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Worker type'), { target: { value: 'Local Daily-Wage Workers' } });
    fireEvent.click(screen.getByRole('button', { name: 'New revision' }));
    expect(screen.getByLabelText(/Effective From/)).toHaveValue('');
    expect(screen.getByLabelText(/Standard Duty Hours/)).toHaveValue(12);
    expect(screen.getByText(/Double duty pays 2×/)).toBeInTheDocument();
  });
  it('changing OT method submits only the corresponding rate', async () => {
    mount(`/factory-masters?tab=rules&category=${encodeURIComponent('Local Daily-Wage Workers')}`);
    await screen.findByText('No revisions for this category.');
    fireEvent.change(screen.getByLabelText('OT Method'), { target: { value: 'Fixed Hourly' } });
    fireEvent.change(screen.getByLabelText(/Overtime rate per hour \(₹\)/), { target: { value: '65' } });
    fireEvent.change(screen.getByLabelText(/Effective From/), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Revision' }));
    await waitFor(() => expect(createFactoryRevision).toHaveBeenCalledWith('rules', expect.objectContaining({ ot_rate: 65, ot_multiplier: null })));
  });
  it('reads repeated standard hours from the rule, rather than editing them in the wage form', async () => {
    getEffectiveFactoryMasters.mockResolvedValue({ data: { rule_revision: { standard_duty_hours: 8, effective_from: '2026-01-01', ot_method: 'Fixed Hourly', ot_rate: 50, double_duty_multiplier: null } } });
    mount(); expect(await screen.findByText(/8 standard hours/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Standard Duty Hours')).not.toBeInTheDocument();
    expect(screen.getByText(/Maintained in Pay Rule Master/)).toBeInTheDocument();
  });
  it('renders loading/error states and retry controls', async () => {
    getFactoryRevisions.mockRejectedValue(new Error('Unavailable'));
    getEffectiveFactoryMasters.mockReturnValue(new Promise(() => {}));
    mount(); expect(screen.getByText('Loading applicable configuration…')).toBeInTheDocument();
    expect(await screen.findByText('Unable to load revisions.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
  it('shows duplicate-date server errors without discarding the form', async () => {
    createFactoryRevision.mockRejectedValue({ response: { data: { message: 'A revision already exists for this category and effective date.' } } });
    mount(); await screen.findByText('No revisions for this category.');
    fireEvent.change(screen.getByLabelText(/Effective From/), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Revision' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A revision already exists');
    expect(screen.getByLabelText(/Effective From/)).toHaveValue('2026-10-01');
  });
  it('keeps deep-link pagination and renders server-derived status', async () => {
    getFactoryRevisions.mockResolvedValue({ data: { revisions: [{ id: 'test', effective_from: '2026-10-01', daily_wage: 450, display_status: 'Future', revision_number: 2 }], pagination: { totalPages: 3, totalItems: 45 } } });
    mount('/factory-masters?page=2&date=2026-09-30');
    expect((await screen.findAllByText('Future')).length).toBeGreaterThan(0);
    expect(getFactoryRevisions).toHaveBeenCalledWith('wages', expect.objectContaining({ page: 2, as_of: '2026-09-30' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    await waitFor(() => expect(getFactoryRevisions).toHaveBeenCalledWith('wages', expect.objectContaining({ page: 3 })));
  });

  describe('Step 2 Presentation Acceptance Tests', () => {
    it('renders exact pill tabs, explicit applicable snapshot card, and 3 distinct rule fieldsets', async () => {
      getEffectiveFactoryMasters.mockResolvedValue({
        data: {
          wage_revision: null,
          rule_revision: {
            standard_duty_hours: 8,
            effective_from: '2026-01-01',
            ot_enabled: true,
            ot_method: 'Fixed Hourly',
            ot_rate: 50,
            ot_multiplier: null,
            holiday_pay_enabled: true,
            holiday_multiplier: 1.5,
            management_stoppage_treatment: 'Full wage',
            double_duty_multiplier: null
          }
        }
      });
      mount('/factory-masters?tab=rules&date=2026-09-30');

      // Pill tabs
      expect(screen.getByRole('button', { name: 'Daily Wage Master' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Attendance & Pay Rules' })).toBeInTheDocument();

      // Applicable date card
      expect(await screen.findByText(/Rules in effect on:/)).toBeInTheDocument();
      expect(screen.getByText('2026-09-30')).toBeInTheDocument();

      // 3 distinct rule fieldset headings
      expect(screen.getByText('Effective Period & Base Hours')).toBeInTheDocument();
      expect(screen.getByText('Overtime & Multipliers')).toBeInTheDocument();
      expect(screen.getByText('Attendance pay treatment')).toBeInTheDocument();
    });
  });
});

describe('OT calculation setup',()=>{
 const row={id:'rule1',employee_category:'SNP Permanent Factory Labour',revision_number:1,effective_from:'2026-01-01',standard_duty_hours:8,ot_enabled:true,ot_method:'Salary-derived hourly',ot_multiplier:1.5};
 const prepare=()=>{getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});getFactorySetupImpact.mockResolvedValue({data:{impact:{effective_from:'2026-01-01',effective_to:null,draft_rows:6,protected_rows:2,locked_rows:0,calculation_configured:false,treatment_configured:false}}});completeFactorySetup.mockResolvedValue({data:{success:true}});};
 it('saves permanent gross basis and separate OT salary days with the new rule',async()=>{
  mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category));await screen.findByText('No revisions for this category.');
  expect(screen.getByLabelText(/Overtime calculation days|Days used to calculate overtime/)).toHaveValue(26);
  fireEvent.change(screen.getByLabelText(/Effective From/),{target:{value:'2026-08-01'}});fireEvent.click(screen.getByRole('button',{name:'Save Revision'}));
  await waitFor(()=>expect(createFactoryRevision).toHaveBeenCalledWith('rules',expect.objectContaining({calculation:{salary_days:26,reason:'Reviewed factory pay rules'}})));
 });
 it('shows impact in the shared modal and requires explicit confirmation and reason',async()=>{
  prepare();mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category));
  fireEvent.click(await screen.findByRole('button',{name:'Finish setup'}));await screen.findByText(/6 draft rows/);
  expect(screen.getByRole('dialog', {name:'Complete pay setup'})).toBeInTheDocument();
  const save=screen.getByRole('button',{name:'Save setup'});expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/Setup note/),{target:{value:'UAT approved document rounding'}});
  fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(save);
  await waitFor(()=>expect(completeFactorySetup).toHaveBeenCalledWith('rule1',{salary_days:26,holiday_salary_days:null,reason:'UAT approved document rounding'}));
  expect(await screen.findByText(/Pay rule setup saved/)).toBeInTheDocument();
 });
 it('blocks completion when a locked salary overlaps',async()=>{
  prepare();getFactorySetupImpact.mockResolvedValue({data:{impact:{effective_from:'2026-01-01',draft_rows:0,protected_rows:0,locked_rows:1}}});
  mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category));fireEvent.click(await screen.findByRole('button',{name:'Finish setup'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('locked payroll');expect(screen.getByRole('button',{name:'Save setup'})).toBeDisabled();
 });
 it('reports impact read and save errors without losing the form',async()=>{
  prepare();getFactorySetupImpact.mockRejectedValueOnce(new Error('offline'));
  mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category));fireEvent.click(await screen.findByRole('button',{name:'Finish setup'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to check');fireEvent.click(screen.getByRole('button',{name:'Retry'}));await screen.findByText(/6 draft rows/);
  completeFactorySetup.mockRejectedValueOnce({response:{data:{message:'Sources changed; retry'}}});fireEvent.change(screen.getByLabelText(/Setup note/),{target:{value:'Reviewed'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save setup'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('Sources changed');expect(screen.getByLabelText(/Setup note/)).toHaveValue('Reviewed');
 });
});


it('confirms attendance pay treatment without requesting certificates',async()=>{
 const row={id:'treatment-rule',employee_category:'SNP Permanent Factory Labour',revision_number:1,effective_from:'2026-01-01',ot_enabled:false,ot_method:'Fixed Hourly',ot_rate:50,holiday_pay_enabled:true,holiday_multiplier:1.5};
 getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});
 getFactorySetupImpact.mockResolvedValue({data:{impact:{effective_from:'2026-01-01',draft_rows:2,protected_rows:0,locked_rows:0,calculation_configured:false,treatment_configured:false}}});completeFactorySetup.mockResolvedValue({data:{success:true}});
 mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category));fireEvent.click(await screen.findByRole('button',{name:'Finish setup'}));
 await screen.findByText(/2 draft rows/);expect(screen.queryByLabelText(/certificate|medical document/i)).not.toBeInTheDocument();
 expect(screen.getByText(/follow HO’s Paid or Unpaid decision/)).toBeInTheDocument();fireEvent.change(screen.getByLabelText(/Setup note/),{target:{value:'Client-approved payroll treatment'}});fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save setup'}));
 await waitFor(()=>expect(completeFactorySetup).toHaveBeenCalledWith('treatment-rule',{salary_days:null,holiday_salary_days:26,reason:'Client-approved payroll treatment'}));
});


it('keeps revision entry collapsed until requested and allows cancellation', async () => {
 mount('/factory-masters?tab=rules', false);
 await screen.findByText('No revisions for this category.');
 expect(screen.queryByLabelText(/Effective From/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', {name:'New revision'}));
 expect(screen.getByLabelText(/Effective From/)).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button', {name:'Cancel'}));
 expect(screen.queryByLabelText(/Effective From/)).not.toBeInTheDocument();
});
it('hides irrelevant OT inputs when disabled while keeping the revision reason', async () => {
 mount('/factory-masters?tab=rules');
 fireEvent.change(screen.getByLabelText('OT Enabled'), {target:{value:'false'}});
 expect(screen.queryByLabelText('OT Method')).not.toBeInTheDocument();
 expect(screen.queryByLabelText('OT Multiplier')).not.toBeInTheDocument();
 expect(screen.getByLabelText(/Reason for this revision/)).toBeInTheDocument();
});
it('completes both missing settings with one save, preserving independent divisors', async () => {
 const row={id:'both',employee_category:'SNP Permanent Factory Labour',revision_number:1,ot_enabled:true,ot_method:'Salary-derived hourly',ot_multiplier:1,holiday_pay_enabled:true,holiday_multiplier:1.5};
 getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});
 getFactorySetupImpact.mockResolvedValue({data:{impact:{draft_rows:6,locked_rows:0,calculation_configured:false,treatment_configured:false}}});
 completeFactorySetup.mockResolvedValue({data:{success:true}});
 mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category),false);
 fireEvent.click(await screen.findByRole('button',{name:'Finish setup'}));
 await screen.findByText(/6 draft rows/);
 fireEvent.change(screen.getByLabelText(/Overtime calculation days|Days used to calculate overtime/),{target:{value:'30'}});
 fireEvent.change(screen.getByLabelText(/Setup note/),{target:{value:'Confirmed'}});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(screen.getByRole('button',{name:'Save setup'}));
 await waitFor(()=>expect(completeFactorySetup).toHaveBeenCalledWith('both',{salary_days:30,holiday_salary_days:26,reason:'Confirmed'}));
});
it('uses current server setup state and never edits previously confirmed OT settings', async () => {
 const row={id:'partial',employee_category:'SNP Permanent Factory Labour',ot_enabled:true,ot_method:'Salary-derived hourly',holiday_pay_enabled:true,holiday_multiplier:1.5};
 getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});
 getFactorySetupImpact.mockResolvedValue({data:{impact:{draft_rows:1,locked_rows:0,calculation_configured:true,treatment_configured:false}}});
 mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category),false);fireEvent.click(await screen.findByRole('button',{name:'Finish setup'}));
 await screen.findByText(/1 draft rows/);
 expect(screen.queryByLabelText(/Overtime calculation days|Days used to calculate overtime/)).not.toBeInTheDocument();
 expect(screen.getByLabelText(/Holiday calculation days|Days used to calculate holiday pay/)).toBeInTheDocument();
});


it('keeps the yellow save action outside the scrolling form and submits through its form owner', async () => {
 const row={id:'footer',employee_category:'SNP Permanent Factory Labour',revision_number:1,ot_enabled:true,ot_method:'Salary-derived hourly',ot_multiplier:1};
 getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});
 getFactorySetupImpact.mockResolvedValue({data:{impact:{draft_rows:1,locked_rows:0,calculation_configured:false,treatment_configured:false}}});
 completeFactorySetup.mockResolvedValue({data:{success:true}});
 mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category),false);
 fireEvent.click(await screen.findByRole('button',{name:'Finish setup',exact:true}));
 await screen.findByText(/1 draft rows/);
 const save=screen.getByRole('button',{name:'Save setup'});
 expect(save).toHaveClass('bg-yellow-500');
 expect(save.closest('form')).toBeNull();
 expect(save.form).toBe(document.getElementById('factory-setup-form'));
 const confirmation=screen.getByRole('checkbox');
 expect(confirmation.closest('form')).toBeNull();expect(confirmation.form).toBe(save.form);
 const details=screen.getByText('Calculation details').closest('details');
 expect(details).not.toHaveAttribute('open');
 expect(details).toHaveTextContent('1 draft rows');
 fireEvent.change(screen.getByLabelText(/Setup note/),{target:{value:'Reviewed'}});
 fireEvent.click(screen.getByRole('checkbox'));fireEvent.click(save);
 await waitFor(()=>expect(completeFactorySetup).toHaveBeenCalledWith('footer',{salary_days:26,holiday_salary_days:null,reason:'Reviewed'}));
});
it('shows compact revision cards with the same actionable settings as desktop',async()=>{
 const row={id:'card',employee_category:'SNP Permanent Factory Labour',revision_number:3,effective_from:'2026-08-01',display_status:'Current',standard_duty_hours:8,ot_enabled:true,ot_method:'Fixed Hourly',ot_rate:'50.00',holiday_pay_enabled:true,holiday_multiplier:'1.5'};
 getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});
 getFactorySetupImpact.mockResolvedValue({data:{impact:{draft_rows:0,locked_rows:0,calculation_configured:false,treatment_configured:false}}});
 mount('/factory-masters?tab=rules&category='+encodeURIComponent(row.employee_category),false);
 const cards=await screen.findByRole('list',{name:'Revision cards'});
 expect(within(cards).getByText('Revision 3')).toBeInTheDocument();
 expect(within(cards).getByText(/₹50.00 per hour/)).toBeInTheDocument();
 const action=within(cards).getByRole('button',{name:'Finish setup for revision 3'});
 expect(action).toHaveClass('bg-yellow-500');fireEvent.click(action);
 expect(await screen.findByRole('dialog',{name:'Complete pay setup'})).toBeInTheDocument();
});

it('separates factory caches, preserves worker type and sends the chosen Local scope',async()=>{
 mount('/factory-masters?tab=wages&category=Local+Daily-Wage+Workers&department=SNP+Factory',false);
 await screen.findByText('No revisions for this category.');
 expect(getFactoryRevisions).toHaveBeenLastCalledWith('wages',expect.objectContaining({department:'SNP Factory',employee_category:'Local Daily-Wage Workers'}));
 fireEvent.change(screen.getByLabelText('Factory'),{target:{value:'Fabric Factory'}});
 await waitFor(()=>expect(getFactoryRevisions).toHaveBeenLastCalledWith('wages',expect.objectContaining({department:'Fabric Factory',employee_category:'Local Daily-Wage Workers'})));
 fireEvent.click(screen.getByRole('button',{name:'New revision'}));
 fireEvent.change(screen.getByLabelText(/Effective From/),{target:{value:'2026-11-01'}});
 fireEvent.change(screen.getByLabelText(/Reason for this revision/),{target:{value:'Approved Fabric rate'}});
 fireEvent.click(screen.getByRole('button',{name:'Save Revision'}));
 await waitFor(()=>expect(createFactoryRevision).toHaveBeenCalledWith('wages',expect.objectContaining({department:'Fabric Factory',employee_category:'Local Daily-Wage Workers',setup_reason:'Approved Fabric rate'})));
});
it('prompts for a factory on ambiguous old Local links and never fetches an assumed rate',async()=>{
 mount('/factory-masters?tab=wages&category=Local+Daily-Wage+Workers',false);
 expect(screen.getByText(/Choose a factory to view Local/)).toBeInTheDocument();
 expect(getFactoryRevisions).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'New revision'})).toBeDisabled();
 fireEvent.click(screen.getByRole('button',{name:'Attendance & Pay Rules'}));
 expect(screen.getByLabelText('Worker type')).toHaveValue('Local Daily-Wage Workers');
 expect(screen.getByText(/Choose a factory to view Local/)).toBeInTheDocument();
 expect(getFactoryRevisions).not.toHaveBeenCalled();
});
it('clears an unsaved form when the selected factory changes',async()=>{
 mount('/factory-masters?tab=wages&category=Local+Daily-Wage+Workers&department=SNP+Factory',false);
 fireEvent.click(screen.getByRole('button',{name:'New revision'}));
 fireEvent.change(screen.getByLabelText(/Daily Wage/),{target:{value:'789'}});
 fireEvent.change(screen.getByLabelText('Factory'),{target:{value:'Fabric Factory'}});
 expect(screen.queryByLabelText(/Daily Wage/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'New revision'}));
 expect(screen.getByLabelText(/Daily Wage/)).not.toHaveValue(789);
});
it.each([
 ['wages','Local Daily-Wage Workers','Fabric Factory'],
 ['rules','Fabric Factory Permanent Employees','Fabric Factory'],
 ['rules','SNP Casual Factory Labour','SNP Factory']
])('removes the migration shortcut for %s %s while preserving normal actions',async(kind,category,department)=>{
 const row={id:'legacy',department:null,employee_category:category,revision_number:1,effective_from:'2026-01-01',daily_wage:'475.00',standard_duty_hours:'7',ot_enabled:false,holiday_pay_enabled:false};
 getEffectiveFactoryMasters.mockResolvedValue({data:{legacy_wage_revision:row,legacy_rule_revision:row,rule_revision:kind==='rules'?row:null}});
 getFactoryRevisions.mockResolvedValue({data:{revisions:[row],pagination:{totalPages:1}}});
 mount(`/factory-masters?tab=${kind}&category=${encodeURIComponent(category)}&department=${encodeURIComponent(department)}`,false);
 await screen.findByRole('heading',{name:'Revision History'});
 await waitFor(()=>expect(getEffectiveFactoryMasters).toHaveBeenCalled());
 expect(screen.queryByText(/Earlier settings remain in history/)).not.toBeInTheDocument();
 expect(screen.queryByRole('button',{name:'Use earlier values in a new revision'})).not.toBeInTheDocument();
 if(kind==='rules')expect(await screen.findByRole('button',{name:'Finish setup',exact:true})).toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'New revision'}));
 expect(screen.getByLabelText(/Effective From/)).toHaveValue('');
 expect(screen.getByLabelText(/Reason for this revision/)).toHaveValue('');
 if(kind==='wages')expect(screen.getByLabelText(/Daily Wage/)).not.toHaveValue(475);
 else expect(screen.getByLabelText(/Standard Duty Hours/)).toHaveValue(8);
});
