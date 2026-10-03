import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import MaterialMaster from './MaterialMaster';
import {
  renderPage,
  createDeferred,
  interceptApiCall,
  assertApiCalledWith
} from '../test';
import authApi from '../api/authApi';

vi.mock('../api/authApi');

describe('MaterialMaster Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockCategories = {
    mainHeads: ['Electrical', 'Civil', 'Mechanical'],
    subHeads: ['Cables', 'Pipes', 'Structural']
  };

  const mockMaterials = [
    {
      id: 'mat-1',
      Material_Main_Head: 'Electrical',
      Material_Sub_Head: 'Cables',
      Material_Details: 'Armoured Cable 4C 16 sq mm',
      M_Unit: 'Mtr',
      is_active: true
    }
  ];

  it('creates a new material with in-flight state, payload assertion, and success feedback', async () => {
    renderPage(<MaterialMaster />, {
      role: 'admin',
      initialUrl: '/materials',
      overrides: {
        '/materials/categories': { success: true, ...mockCategories },
        '/materials': { success: true, materials: mockMaterials, pagination: { totalItems: 1, totalPages: 1 } }
      }
    });

    const deferredCreate = createDeferred();
    const createInterceptor = interceptApiCall(authApi, 'post', '/materials', { deferred: deferredCreate });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /Material Master/i })).toBeInTheDocument();
    });

    // Open Create Modal
    const createBtn = screen.getByRole('button', { name: /\+ Create Material/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(screen.getByText('Create Material Record')).toBeInTheDocument();
    });

    // Fill form fields
    const mainHeadInput = screen.getByPlaceholderText('e.g. Raw Materials');
    fireEvent.change(mainHeadInput, { target: { value: 'Civil' } });

    const subHeadInput = screen.getByPlaceholderText('e.g. Cement (OPC/PPC)');
    fireEvent.change(subHeadInput, { target: { value: 'Cement' } });

    const detailsInput = screen.getByPlaceholderText(/Enter detailed description of the material/i);
    fireEvent.change(detailsInput, { target: { value: 'Portland Pozzolana Cement 53 Grade' } });

    const unitInput = screen.getByPlaceholderText('e.g. Bag, Cum / CFT, Kg');
    fireEvent.change(unitInput, { target: { value: 'Bag' } });

    // Submit form
    const form = screen.getByText('Create Material Record').closest('.glass-panel').querySelector('form');
    fireEvent.submit(form);

    // Verify API called and payload
    deferredCreate.resolve({
      data: {
        success: true,
        material: {
          id: 'mat-new',
          Material_Main_Head: 'Civil',
          Material_Sub_Head: 'Cement',
          Material_Details: 'Portland Pozzolana Cement 53 Grade',
          M_Unit: 'Bag',
          is_active: true
        }
      }
    });

    await waitFor(() => {
      expect(screen.getByText(/Material created successfully!/i)).toBeInTheDocument();
    });

    expect(createInterceptor.calls.length).toBe(1);
    assertApiCalledWith(createInterceptor, {
      url: '/materials',
      body: {
        Material_Main_Head: 'Civil',
        Material_Sub_Head: 'Cement',
        Material_Details: 'Portland Pozzolana Cement 53 Grade',
        M_Unit: 'Bag',
        is_active: true
      }
    });
  });

  it('edits an existing material with pre-populated values, PUT payload assertion, and success feedback', async () => {
    renderPage(<MaterialMaster />, {
      role: 'admin',
      initialUrl: '/materials',
      overrides: {
        '/materials/categories': { success: true, ...mockCategories },
        '/materials': { success: true, materials: mockMaterials, pagination: { totalItems: 1, totalPages: 1 } }
      }
    });

    const deferredUpdate = createDeferred();
    const updateInterceptor = interceptApiCall(authApi, 'put', '/materials/mat-1', { deferred: deferredUpdate });

    await waitFor(() => {
      expect(screen.getByText('Armoured Cable 4C 16 sq mm')).toBeInTheDocument();
    });

    // Click Edit button
    const editBtn = screen.getByRole('button', { name: /^Edit$/i });
    fireEvent.click(editBtn);

    await waitFor(() => {
      expect(screen.getByText('Edit Material Record')).toBeInTheDocument();
    });

    // Check pre-filled value
    const detailsInput = screen.getByPlaceholderText(/Enter detailed description of the material/i);
    expect(detailsInput.value).toBe('Armoured Cable 4C 16 sq mm');

    // Update details
    fireEvent.change(detailsInput, { target: { value: 'Armoured Cable 4C 16 sq mm XLPE High-Voltage' } });

    // Submit form
    const form = screen.getByText('Edit Material Record').closest('.glass-panel').querySelector('form');
    fireEvent.submit(form);

    // Resolve deferred
    deferredUpdate.resolve({
      data: {
        success: true,
        material: {
          id: 'mat-1',
          Material_Main_Head: 'Electrical',
          Material_Sub_Head: 'Cables',
          Material_Details: 'Armoured Cable 4C 16 sq mm XLPE High-Voltage',
          M_Unit: 'Mtr',
          is_active: true
        }
      }
    });

    await waitFor(() => {
      expect(screen.getByText(/Material updated successfully!/i)).toBeInTheDocument();
    });

    expect(updateInterceptor.calls.length).toBe(1);
    assertApiCalledWith(updateInterceptor, {
      url: '/materials/mat-1',
      body: {
        Material_Main_Head: 'Electrical',
        Material_Sub_Head: 'Cables',
        Material_Details: 'Armoured Cable 4C 16 sq mm XLPE High-Voltage',
        M_Unit: 'Mtr',
        is_active: true
      }
    });
  });

  it('toggles operational status of a material with PATCH /status payload assertion and feedback', async () => {
    renderPage(<MaterialMaster />, {
      role: 'admin',
      initialUrl: '/materials',
      overrides: {
        '/materials/categories': { success: true, ...mockCategories },
        '/materials': { success: true, materials: mockMaterials, pagination: { totalItems: 1, totalPages: 1 } }
      }
    });

    const deferredStatus = createDeferred();
    const statusInterceptor = interceptApiCall(authApi, 'patch', '/materials/mat-1/status', { deferred: deferredStatus });

    await waitFor(() => {
      expect(screen.getByText('Armoured Cable 4C 16 sq mm')).toBeInTheDocument();
    });

    // Click Active status badge button to toggle to Inactive
    const statusBadge = screen.getByText('Active');
    const statusButton = statusBadge.closest('button');
    expect(statusButton).toBeInTheDocument();
    fireEvent.click(statusButton);

    // Resolve deferred status
    deferredStatus.resolve({
      data: {
        success: true,
        message: 'Material status updated.'
      }
    });

    await waitFor(() => {
      expect(screen.getByText(/Material status updated to Inactive\./i)).toBeInTheDocument();
    });

    expect(statusInterceptor.calls.length).toBe(1);
    assertApiCalledWith(statusInterceptor, {
      url: '/materials/mat-1/status',
      body: {
        is_active: false
      }
    });
  });
});
