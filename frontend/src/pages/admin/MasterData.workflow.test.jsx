import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import MasterData from './MasterData';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../../test';
import authApi from '../../api/authApi';

vi.mock('../../api/authApi');

describe('MasterData Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockProjects = [
    {
      work_order_no: 'WO-101',
      estimate_no: 'EST-101',
      work_order_value: 5000000,
      earnest_money_deposit: 100000,
      site_details: 'Substation Alpha, North District',
      state: 'West Bengal',
      district: 'Bankura',
      zone: 'North',
      department: 'Electrical',
      status: 'Running',
      zo_user_id: '+919876543212',
      site_latitude: '22.5726',
      site_longitude: '88.3639',
      project_start_date: '2026-08-01',
      project_end_date: '2027-08-01'
    }
  ];

  it('creates a new project with in-flight loading state, payload verification, and success notification', async () => {
    renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data',
      overrides: {
        '/projects': { success: true, projects: mockProjects },
        '/user-mappings/eligible-zos': { success: true, zos: [{ mobile_number: '+919876543212', display_name: 'Western Zone Office' }] }
      }
    });

    const deferredCreate = createDeferred();
    const createInterceptor = interceptApiCall(authApi, 'post', '/projects', { deferred: deferredCreate });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Master Data Sheet/i })).toBeInTheDocument();
      expect(screen.getByText('WO-101')).toBeInTheDocument();
    });

    // Open New Project Modal
    const newProjectBtn = screen.getByRole('button', { name: /New Project/i });
    fireEvent.click(newProjectBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Create Project/i })).toBeInTheDocument();
    });

    // Fill form inputs
    const woInput = screen.getByPlaceholderText('e.g. WB_APD_101');
    fireEvent.change(woInput, { target: { value: 'WO-999' } });

    const estimateInput = screen.getByPlaceholderText('e.g. APD_1');
    fireEvent.change(estimateInput, { target: { value: 'EST-999' } });

    const valueInput = screen.getByPlaceholderText('e.g. 2500000');
    fireEvent.change(valueInput, { target: { value: '3500000' } });

    const stateInput = screen.getByPlaceholderText('e.g. West Bengal');
    fireEvent.change(stateInput, { target: { value: 'West Bengal' } });

    const districtInput = screen.getByPlaceholderText('e.g. Bankura');
    fireEvent.change(districtInput, { target: { value: 'Kolkata' } });

    const zoneInput = screen.getByPlaceholderText('e.g. North');
    fireEvent.change(zoneInput, { target: { value: 'South' } });

    const deptInput = screen.getByPlaceholderText('e.g. PWD');
    fireEvent.change(deptInput, { target: { value: 'Power' } });

    const detailsInput = screen.getByPlaceholderText('Site location / description');
    fireEvent.change(detailsInput, { target: { value: 'Substation Transmission Grid' } });

    // Submit form
    const submitBtn = screen.getByRole('button', { name: /Create Project/i });
    expect(submitBtn).not.toBeDisabled();
    fireEvent.click(submitBtn);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByText(/Saving…/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Saving…/i })).toBeDisabled();
    });

    // Resolve deferred
    deferredCreate.resolve({
      data: {
        success: true,
        project: { work_order_no: 'WO-999' }
      }
    });

    // Verify success feedback
    await waitFor(() => {
      expect(screen.getByText(/Project WO-999 created successfully\./i)).toBeInTheDocument();
    });

    expect(createInterceptor.calls.length).toBe(1);
    assertApiCalledWith(createInterceptor, {
      url: '/projects',
      partialBody: {
        work_order_no: 'WO-999',
        estimate_no: 'EST-999',
        work_order_value: '3500000',
        state: 'West Bengal',
        district: 'Kolkata',
        zone: 'South',
        department: 'Power',
        site_details: 'Substation Transmission Grid'
      }
    });

    // Modal closes
    expect(screen.queryByText('New Record')).not.toBeInTheDocument();
  });

  it('edits an existing project with immutable WO guard, PUT payload verification, and feedback', async () => {
    renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data',
      overrides: {
        '/projects': { success: true, projects: mockProjects },
        '/user-mappings/eligible-zos': { success: true, zos: [{ mobile_number: '+919876543212', display_name: 'Western Zone Office' }] }
      }
    });

    const deferredUpdate = createDeferred();
    const updateInterceptor = interceptApiCall(authApi, 'put', '/projects/WO-101', { deferred: deferredUpdate });

    await waitFor(() => {
      expect(screen.getByText('WO-101')).toBeInTheDocument();
    });

    // Click Edit button for WO-101
    const editBtn = document.getElementById('btn-edit-WO-101');
    expect(editBtn).toBeInTheDocument();
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Edit Project/i })).toBeInTheDocument();
      expect(screen.getByText('Modify Record')).toBeInTheDocument();
    });

    // Verify work_order_no input is disabled
    const woInput = screen.getByPlaceholderText('e.g. WB_APD_101');
    expect(woInput).toBeDisabled();
    expect(screen.getByText(/Immutable after creation/i)).toBeInTheDocument();

    // Modify site details
    const detailsInput = screen.getByPlaceholderText('Site location / description');
    fireEvent.change(detailsInput, { target: { value: 'Substation Alpha upgraded capacity' } });

    // Click Save Changes
    const saveBtn = screen.getByRole('button', { name: /Save Changes/i });
    expect(saveBtn).not.toBeDisabled();
    fireEvent.click(saveBtn);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByText(/Saving…/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Saving…/i })).toBeDisabled();
    });

    // Resolve deferred
    deferredUpdate.resolve({
      data: {
        success: true,
        project: { work_order_no: 'WO-101', site_details: 'Substation Alpha upgraded capacity' }
      }
    });

    // Verify success feedback
    await waitFor(() => {
      expect(screen.getByText(/Project WO-101 updated successfully\./i)).toBeInTheDocument();
    });

    expect(updateInterceptor.calls.length).toBe(1);
    assertApiCalledWith(updateInterceptor, {
      url: '/projects/WO-101',
      partialBody: {
        site_details: 'Substation Alpha upgraded capacity'
      }
    });

    // Modal closes
    expect(screen.queryByText('Modify Record')).not.toBeInTheDocument();
  });

  it('updates project status via quick-change modal with radio selection, PATCH payload assertion, and feedback', async () => {
    renderPage(<MasterData />, {
      role: 'admin',
      initialUrl: '/admin/master-data',
      overrides: {
        '/projects': { success: true, projects: mockProjects }
      }
    });

    const deferredStatus = createDeferred();
    const statusInterceptor = interceptApiCall(authApi, 'patch', '/projects/WO-101/status', { deferred: deferredStatus });

    await waitFor(() => {
      expect(screen.getByText('WO-101')).toBeInTheDocument();
    });

    // Click status quick-change button for WO-101
    const statusBtn = document.getElementById('btn-status-WO-101');
    expect(statusBtn).toBeInTheDocument();
    fireEvent.click(statusBtn);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: /Update Status/i })).toBeInTheDocument();
    });

    // "Apply Status" should initially be disabled because status hasn't changed
    const applyBtn = screen.getByRole('button', { name: /Apply Status/i });
    expect(applyBtn).toBeDisabled();

    // Select "Closed" radio option
    const radios = screen.getAllByRole('radio');
    const closedRadio = radios.find(r => r.value === 'Closed');
    expect(closedRadio).toBeInTheDocument();
    fireEvent.click(closedRadio);

    // Now Apply Status should be enabled
    expect(applyBtn).not.toBeDisabled();
    fireEvent.click(applyBtn);

    // Verify in-flight loading state
    await waitFor(() => {
      expect(screen.getByText(/Updating…/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Updating…/i })).toBeDisabled();
    });

    // Resolve deferred
    deferredStatus.resolve({
      data: {
        success: true,
        message: 'Status updated'
      }
    });

    // Verify success feedback
    await waitFor(() => {
      expect(screen.getByText(/Status for WO-101 updated to "Closed"\./i)).toBeInTheDocument();
    });

    expect(statusInterceptor.calls.length).toBe(1);
    assertApiCalledWith(statusInterceptor, {
      url: '/projects/WO-101/status',
      body: {
        status: 'Closed'
      }
    });

    // Modal closes
    expect(screen.queryByText('Update Status')).not.toBeInTheDocument();
  });
});
