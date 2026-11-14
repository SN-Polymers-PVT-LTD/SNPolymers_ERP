import { newStatutoryConfiguration, withContributionBasis } from '../../components/payroll/statutoryPresets';
import React from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as api from '../../api/payrollProfilesApi';
import CompanyDeductions from './CompanyDeductions';

vi.mock('../../api/payrollProfilesApi');
vi.mock('../../components/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'accounts-user', role: 'accounts' } }),
}));
vi.mock('./PayrollMasters', () => ({ default: () => <div>Revision history</div> }));

const draftId = '9385b8bd-78db-472f-b5b8-128f2a3694c6';
const state = { id: 'cd64dd96-8aa6-42b0-b2fc-742e64d8cd13', name: 'West Bengal' };
const draftData = { establishment: 'Fabric Factory', state_id: state.id, jurisdiction: state.name, effective_from: '2098-01-01', rules: {} };
const response = result => ({ data: { result } });
const button = name => screen.getByRole('button', { name, exact: true });
const fill = (name, value) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
function Location() {
  return <output aria-label="Current URL">{useLocation().search}</output>;
}
function mount(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/admin/payroll/statutory' + search]}>
      <CompanyDeductions /><Location />
    </MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.resetAllMocks();
  api.getCompanyDeductionSetups.mockResolvedValue(response({ setups: [], total: 0, limit: 10 }));
  api.listGuidedDeductionDrafts.mockResolvedValue(response({ drafts: [], total: 0, limit: 10 }));
  api.getStatutoryStates.mockResolvedValue(response([state]));
  api.getGuidedDeductionDraft.mockResolvedValue(response({ id: draftId, version: 1, data: draftData }));
});

it('saves the company step, deep-links to the draft, and resumes it without rules', async () => {
  api.saveGuidedDeductionDraft.mockResolvedValue(response({ id: draftId, version: 1, data: draftData }));
  const first = mount();
  fireEvent.click(button('New company setup'));
  await screen.findByRole('option', { name: state.name });
  fill(/Establishment/, draftData.establishment);
  fill(/Jurisdiction/, state.id);
  fill(/Setup start date/, draftData.effective_from);
  fireEvent.click(button('Save draft'));
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent(draftId));
  expect(api.saveGuidedDeductionDraft).toHaveBeenCalledWith({ id: null, expected_version: 0, data: { ...draftData, initial_setup: false } });
  first.unmount();
  mount('?draft=' + draftId);
  expect(await screen.findByDisplayValue(draftData.establishment)).toBeInTheDocument();
  fireEvent.click(button('Continue to deduction rules'));
  expect(screen.getByLabelText('Include EPF')).not.toBeChecked();
});

it('reviews selected rules, handles a stale review, and publishes using the new token', async () => {
  api.saveGuidedDeductionDraft.mockImplementation(async ({ data }) => response({ id: draftId, version: 2, data }));
  const review = token => response({ publishable: true, review_token: token, blockers: [], effective_to: null });
  api.reviewGuidedDeductionDraft.mockResolvedValueOnce(review('old-token')).mockResolvedValueOnce(review('new-token'));
  api.publishGuidedDeductionDraft.mockRejectedValueOnce({ response: { status: 409, data: { message: 'Payroll changed. Review again.' } } })
    .mockResolvedValueOnce(response({ setup: { establishment_name: 'Fabric Factory', effective_from: draftData.effective_from } }));
  mount('?draft=' + draftId);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue to deduction rules' }));
  fireEvent.click(screen.getByLabelText('Include EPF'));
  fireEvent.click(button('Apply standard preset'));
  fill(/Which earnings count/, 'GROSS_ONLY');
  fill(/Change reason/, 'First setup');
  fireEvent.click(button('Continue to review'));
  expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
  expect(screen.getByText('Earnings used · Monthly gross salary')).toBeInTheDocument();
  expect(api.reviewGuidedDeductionDraft).toHaveBeenCalledWith(draftId, { expected_version: 2, initial_setup: false });
  fill(/Approval reference/, 'Accounts review 1');
  const confirm = () => fireEvent.click(screen.getByLabelText(/I checked the rates/));
  confirm();
  fireEvent.click(button('Publish setup'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Payroll changed');
  fireEvent.click(button('Review again'));
  await screen.findByText('Ready to publish');
  expect(button('Publish setup')).toBeDisabled();
  confirm();
  fireEvent.click(button('Publish setup'));
  expect(await screen.findByRole('link', { name: 'Assign to employees' })).toHaveAttribute('href', '/admin/employee-management?tab=payroll-setup');
  expect(api.publishGuidedDeductionDraft).toHaveBeenLastCalledWith(draftId, expect.objectContaining({ review_token: 'new-token', approval_reference: 'Accounts review 1', idempotency_key: expect.any(String) }));
});

it('keeps saved factory premiums when changing wage basis and hides their controls', async () => {
  const rule = {
    scheme: 'PT', jurisdiction: state.name, effective_from: draftData.effective_from, effective_to: null,
    reason: 'Existing rule', slabs: [],
    configuration: withContributionBasis(newStatutoryConfiguration('PT'), ['PACKAGE_BALANCE', 'OVERTIME', 'HOLIDAY_PREMIUM']),
  };
  api.getGuidedDeductionDraft.mockResolvedValue(response({ id: draftId, version: 1, data: { ...draftData, rules: { PT: rule } } }));
  api.saveGuidedDeductionDraft.mockImplementation(async ({ data }) => response({ id: draftId, version: 2, data }));
  mount('?draft=' + draftId);
  await screen.findByText('This rule also includes previously configured factory earnings.');
  fireEvent.click(screen.getByText('Advanced settings', { exact: true }));
  expect(screen.queryByRole('checkbox', { name: /overtime|holiday premium/i })).not.toBeInTheDocument();
  fill(/Which earnings count/, 'DAILY_WAGE');
  fireEvent.click(button('Save draft'));
  await waitFor(() => expect(api.saveGuidedDeductionDraft).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ rules: { PT: expect.objectContaining({
      configuration: expect.objectContaining({
        included_components: ['DAILY_WAGE', 'OVERTIME', 'HOLIDAY_PREMIUM'],
        excluded_components: ['PACKAGE_BALANCE', 'ADJUSTMENTS'],
      }),
    }) } }),
  })));
});
