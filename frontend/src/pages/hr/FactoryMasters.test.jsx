import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import FactoryMasters from './FactoryMasters';
import { useAuth } from '../../components/AuthContext';
import { getFactoryRevisions, getEffectiveFactoryMasters, createFactoryRevision } from '../../api/hrFactoryMastersApi';
vi.mock('../../components/AuthContext', () => ({ useAuth: vi.fn() }));
vi.mock('../../api/hrFactoryMastersApi', () => ({ getFactoryRevisions: vi.fn(), getEffectiveFactoryMasters: vi.fn(), createFactoryRevision: vi.fn() }));
const casual = 'SNP Casual Factory Labour';
function mount(url = '/factory-masters') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[url]}><FactoryMasters /></MemoryRouter></QueryClientProvider>);
}
beforeEach(() => {
  vi.resetAllMocks(); useAuth.mockReturnValue({ user: { role: 'factory_manager' } });
  getFactoryRevisions.mockResolvedValue({ data: { revisions: [], pagination: { totalPages: 1 } } });
  getEffectiveFactoryMasters.mockResolvedValue({ data: { wage_revision: null, rule_revision: null } });
  createFactoryRevision.mockResolvedValue({ data: { success: true } });
});
describe('Factory masters', () => {
  it('starts empty, uses explicit effective date, and saves only authoritative wage fields', async () => {
    mount(); expect(await screen.findByText('No revisions for this category.')).toBeInTheDocument();
    expect(screen.getByLabelText(/Effective From/)).toHaveValue('');
    fireEvent.change(screen.getByLabelText(/Effective From/), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save Revision' }));
    await waitFor(() => expect(createFactoryRevision).toHaveBeenCalledWith('wages', { employee_category: casual, effective_from: '2026-10-01', daily_wage: 400 }));
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
    fireEvent.change(screen.getByLabelText('Employee Category'), { target: { value: 'Local Daily-Wage Workers' } });
    expect(screen.getByLabelText(/Effective From/)).toHaveValue('');
    expect(screen.getByLabelText(/Standard Duty Hours/)).toHaveValue(12);
    expect(screen.getByLabelText(/Double Duty Multiplier/)).toHaveValue(2);
  });
  it('changing OT method submits only the corresponding rate', async () => {
    mount(`/factory-masters?tab=rules&category=${encodeURIComponent('Local Daily-Wage Workers')}`);
    await screen.findByText('No revisions for this category.');
    fireEvent.change(screen.getByLabelText('OT Method'), { target: { value: 'Fixed Hourly' } });
    fireEvent.change(screen.getByLabelText(/OT Hourly Rate \(₹\)/), { target: { value: '65' } });
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
    expect(await screen.findByText('Future')).toBeInTheDocument();
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
      expect(await screen.findByText(/Applicable on selected date:/)).toBeInTheDocument();
      expect(screen.getByText('2026-09-30')).toBeInTheDocument();

      // 3 distinct rule fieldset headings
      expect(screen.getByText('Effective Period & Base Hours')).toBeInTheDocument();
      expect(screen.getByText('Overtime & Multipliers')).toBeInTheDocument();
      expect(screen.getByText('Stoppage Policies')).toBeInTheDocument();
    });
  });
});
