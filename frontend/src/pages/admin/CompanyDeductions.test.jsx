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
const stateTrigger = label => screen.getByRole('button', { name: label });
const openStates = async label => {
  await waitFor(() => expect(stateTrigger(label)).toBeEnabled());
  fireEvent.click(stateTrigger(label));
  return screen.getByRole('group', { name: /options$/ });
};
const chooseState = async (label, name) => {
  await openStates(label);
  fireEvent.click(screen.getByRole('button', { name, exact: true }));
};
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
  fill(/Establishment/, draftData.establishment);
  await chooseState(/Jurisdiction/, state.name);
  fill(/Setup start date/, draftData.effective_from);
  fireEvent.click(button('Save draft'));
  await waitFor(() => expect(screen.getByLabelText('Current URL')).toHaveTextContent(draftId));
  expect(api.saveGuidedDeductionDraft).toHaveBeenCalledWith({ id: null, expected_version: 0, data: { ...draftData, initial_setup: false } });
  first.unmount();
  mount('?draft=' + draftId);
  expect(await screen.findByDisplayValue(draftData.establishment)).toBeInTheDocument();
  expect(screen.getByLabelText('Include EPF')).not.toBeChecked();
  expect(button('Continue to deduction rules')).toBeDisabled();
});

it('reviews selected rules, handles a stale review, and publishes using the new token', async () => {
  api.saveGuidedDeductionDraft.mockImplementation(async ({ data }) => response({ id: draftId, version: 2, data }));
  const review = token => response({
    publishable: true, review_token: token, blockers: [], effective_to: null,
    rules: { EPF: { configuration_warnings: ['BONUS', 'SALARY_ARREARS', 'REIMBURSEMENT', 'RECOVERY'].map(kind => ({
      field: `adjustment_basis.${kind}`, code: 'ADJUSTMENT_CLASSIFICATION_REQUIRED',
    })) } },
  });
  api.reviewGuidedDeductionDraft.mockResolvedValueOnce(review('old-token')).mockResolvedValueOnce(review('new-token'));
  api.publishGuidedDeductionDraft.mockRejectedValueOnce({ response: { status: 409, data: { message: 'Payroll changed. Review again.' } } })
    .mockResolvedValueOnce(response({ setup: { establishment_name: 'Fabric Factory', effective_from: draftData.effective_from } }));
  mount('?draft=' + draftId);
  fireEvent.click(await screen.findByLabelText('Include EPF'));
  fireEvent.click(button('Continue to deduction rules'));
  expect(screen.queryByLabelText('Include EPF')).not.toBeInTheDocument();
  fireEvent.click(button('Apply standard preset'));
  fireEvent.click(button('Use standard calculation settings'));
  expect(screen.getByText('This draft already uses the standard settings.')).toBeInTheDocument();
  await chooseState('EPF contribution basis', 'Uncapped qualifying wages');
  expect(screen.queryByLabelText(/Wage ceiling/)).not.toBeInTheDocument();
  await chooseState(/Which earnings count/, 'Monthly gross salary');
  fill(/Change reason/, 'First setup');
  fireEvent.click(button('Continue to review'));
  expect(await screen.findByText('Ready to publish')).toBeInTheDocument();
  expect(screen.getByText('No contribution cap')).toBeInTheDocument();
  expect(screen.queryByText(/bonus|arrears|reimbursement/i)).not.toBeInTheDocument();
  expect(screen.getByText('Advance recovery treatment needs review.')).toBeInTheDocument();
  expect(api.saveGuidedDeductionDraft.mock.calls.at(-1)[0].data.rules.EPF.configuration)
    .toMatchObject({ calculation_method: 'QUALIFYING_WAGE_PERCENTAGE', wage_ceiling: null });
  expect(screen.getByText('Earnings used · Monthly gross salary')).toBeInTheDocument();
  expect(api.reviewGuidedDeductionDraft).toHaveBeenCalledWith(draftId, { expected_version: 2, initial_setup: false });
  expect(screen.getByLabelText(/Approval reference/)).not.toBeRequired();
  expect(button('Publish setup')).toBeDisabled();
  const confirm = () => fireEvent.click(screen.getByLabelText(/I checked the rates/));
  confirm();
  fireEvent.click(button('Publish setup'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Payroll changed');
  fireEvent.click(button('Review again'));
  await screen.findByText('Ready to publish');
  expect(button('Publish setup')).toBeDisabled();
  confirm();
  fireEvent.click(button('Publish setup'));
  expect(await screen.findByRole('link', { name: 'Assign to employees' })).toHaveAttribute('href', '/acct-requisitions/payroll-setup');
  expect(api.publishGuidedDeductionDraft).toHaveBeenLastCalledWith(draftId, expect.objectContaining({ review_token: 'new-token', approval_reference: null, idempotency_key: expect.any(String) }));
});

it('shows the default ESI wage basis without a dropdown', async () => {
  mount('?draft=' + draftId);
  fireEvent.click(await screen.findByLabelText('Include ESI'));
  fireEvent.click(button('Continue to deduction rules'));
  expect(screen.getByText('Monthly gross salary')).toBeInTheDocument();
  expect(screen.queryByLabelText(/Which earnings count/)).not.toBeInTheDocument();
  expect(screen.getByLabelText(/Eligibility ceiling/)).toBeRequired();
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
  await chooseState(/Which earnings count/, 'Daily wage earnings');
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

it('shows both factories and saves a reused published Pan India rule by revision ID', async () => {
  api.getCompanyDeductionOptions.mockResolvedValue(response({ total: 1, rules: [{
    id: 'shared-epf', scheme: 'EPF', jurisdiction: 'Pan India', establishment: 'Shared rule', revision_number: 1,
  }] }));
  api.saveGuidedDeductionDraft.mockImplementation(async ({ data }) => response({ id: draftId, version: 1, data }));
  mount();
  fireEvent.click(button('New company setup'));
  fireEvent.click(screen.getByLabelText('Include EPF'));
  fireEvent.click(screen.getByLabelText('All factories'));
  expect(screen.getAllByText(/Fabric Factory · S.N. Polymers Factory/).length).toBeGreaterThan(0);
  await chooseState(/Jurisdiction/, 'Pan India');
  expect(button('Continue to deduction rules')).toBeDisabled();
  expect(screen.queryByLabelText(/Establishment state/)).not.toBeInTheDocument();
  fill(/Setup start date/, draftData.effective_from);
  fireEvent.click(button('Continue to deduction rules'));
  expect(screen.getByLabelText('Pan India')).toBeChecked();
  fireEvent.click(button('Use published rule'));
  await openStates('Published EPF rule');
  fireEvent.click(await screen.findByRole('button', { name: /Pan India · Shared rule/ }));
  fireEvent.click(button('Save draft'));
  await waitFor(() => expect(api.saveGuidedDeductionDraft).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ state_id: null, all_factories: true, pan_india: true, rules: { EPF: { revision_id: 'shared-epf' } } }),
  })));
});

it('shows one state selector for PT only and drops Pan India after removing EPF', async () => {
  api.saveGuidedDeductionDraft.mockImplementation(async ({ data }) => response({ id: draftId, version: 1, data }));
  mount();
  fireEvent.click(button('New company setup'));
  fireEvent.click(screen.getByLabelText('Include Professional Tax'));
  expect(screen.queryByRole('button', { name: /Establishment state/ })).not.toBeInTheDocument();
  await openStates(/^State$/);
  expect(screen.queryByRole('button', { name: 'Pan India', exact: true })).not.toBeInTheDocument();
  fireEvent.keyDown(stateTrigger(/^State$/), { key: 'Escape' });
  await chooseState(/^State$/, state.name);

  fireEvent.click(screen.getByLabelText('Include EPF'));
  await chooseState(/Jurisdiction/, 'Pan India');
  expect(stateTrigger(/Establishment state/)).toHaveTextContent(state.name);
  expect(screen.getAllByRole('button', { name: 'Add state' })).toHaveLength(1);
  fireEvent.click(screen.getByLabelText('Include EPF'));
  expect(screen.queryByRole('button', { name: /Establishment state/ })).not.toBeInTheDocument();
  expect(stateTrigger(/^State$/)).toHaveTextContent(state.name);
  await openStates(/^State$/);
  expect(screen.queryByRole('button', { name: 'Pan India', exact: true })).not.toBeInTheDocument();
  fireEvent.keyDown(stateTrigger(/^State$/), { key: 'Escape' });

  fill(/Establishment/, draftData.establishment);
  fill(/Setup start date/, draftData.effective_from);
  fireEvent.click(button('Save draft'));
  await waitFor(() => expect(api.saveGuidedDeductionDraft).toHaveBeenCalled());
  const { data } = api.saveGuidedDeductionDraft.mock.calls.at(-1)[0];
  expect(data.state_id).toBe(state.id);
  expect(data).not.toHaveProperty('pan_india');
  expect(Object.keys(data.rules)).toEqual(['PT']);
});

it('allows Pan India without a second state selector for ESI only', async () => {
  mount();
  fireEvent.click(button('New company setup'));
  fireEvent.click(screen.getByLabelText('Include ESI'));
  await chooseState(/Jurisdiction/, 'Pan India');
  expect(stateTrigger(/Jurisdiction/)).toHaveTextContent('Pan India');
  expect(screen.queryByRole('button', { name: 'Add state' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Establishment state/ })).not.toBeInTheDocument();
});

it('keeps the PT state menu open while focus moves to a choice', async () => {
  mount();
  fireEvent.click(button('New company setup'));
  fireEvent.click(screen.getByLabelText('Include Professional Tax'));
  const menu = await openStates(/^State$/);
  const trigger = stateTrigger(/^State$/);
  fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  fireEvent.keyDown(document.activeElement, { key: 'ArrowDown' });
  expect(document.activeElement).toHaveTextContent(state.name);
  expect(menu).toBeVisible();
  fireEvent.click(document.activeElement);
  expect(trigger).toHaveTextContent(state.name);
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(document.activeElement).toBe(trigger);
});

it('displays the saved PT start date when it matches the setup date and keeps the end date', async () => {
  const rule = {
    scheme: 'PT', effective_from: draftData.effective_from, effective_to: '2098-12-31',
    reason: 'PT dates', slabs: [],
    configuration: withContributionBasis(newStatutoryConfiguration('PT'), ['PACKAGE_BALANCE']),
  };
  api.getGuidedDeductionDraft.mockResolvedValue(response({
    id: draftId, version: 1, data: { ...draftData, rules: { PT: rule } },
  }));
  mount('?draft=' + draftId);
  fireEvent.click(await screen.findByText('Effective dates', { exact: true }));
  expect(screen.getByLabelText(/Rule start date override/)).toHaveValue(draftData.effective_from);
  expect(screen.getByLabelText(/Rule end date/)).toHaveValue(rule.effective_to);
});
