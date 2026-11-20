import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import AsyncMasterSelect from './AsyncMasterSelect';

describe('AsyncMasterSelect component', () => {
  const mockFetchOptions = vi.fn();
  const mockOnChange = vi.fn();
  const mockOnSelectItem = vi.fn();

  const sampleSubcontractors = [
    { id: 'sub-1', subcontractor_name: 'Alpha Infra', is_active: true },
    { id: 'sub-2', subcontractor_name: 'Beta Const', is_active: true }
  ];

  it('renders with label and placeholder', () => {
    render(
      <AsyncMasterSelect
        label="Subcontractor"
        placeholder="Select subcontractor..."
        fetchOptions={mockFetchOptions}
        onChange={mockOnChange}
      />
    );

    expect(screen.getByText('Subcontractor')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Select subcontractor...')).toBeInTheDocument();
  });

  it('fetches options on focus and displays them', async () => {
    mockFetchOptions.mockResolvedValueOnce({
      data: {
        subcontractors: sampleSubcontractors,
        pagination: { totalPages: 1 }
      }
    });

    render(
      <AsyncMasterSelect
        label="Subcontractor"
        fetchOptions={mockFetchOptions}
        getOptionValue={item => item.id}
        getOptionLabel={item => item.subcontractor_name}
        onChange={mockOnChange}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(mockFetchOptions).toHaveBeenCalledWith(
        expect.objectContaining({ is_active: 'true', page: 1 })
      );
    });

    await waitFor(() => {
      expect(screen.getByText('Alpha Infra')).toBeInTheDocument();
      expect(screen.getByText('Beta Const')).toBeInTheDocument();
    });
  });

  it('calls onChange and onSelectItem when an option is selected', async () => {
    mockFetchOptions.mockResolvedValueOnce({
      data: {
        subcontractors: sampleSubcontractors,
        pagination: { totalPages: 1 }
      }
    });

    render(
      <AsyncMasterSelect
        label="Subcontractor"
        fetchOptions={mockFetchOptions}
        getOptionValue={item => item.id}
        getOptionLabel={item => item.subcontractor_name}
        onChange={mockOnChange}
        onSelectItem={mockOnSelectItem}
      />
    );

    const input = screen.getByRole('textbox');
    fireEvent.focus(input);

    await waitFor(() => {
      expect(screen.getByText('Alpha Infra')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Alpha Infra'));

    expect(mockOnChange).toHaveBeenCalledWith('sub-1');
    expect(mockOnSelectItem).toHaveBeenCalledWith(sampleSubcontractors[0]);
  });

  it('includes persisted option even if inactive', async () => {
    const inactiveOption = { id: 'sub-old', subcontractor_name: 'Old Partner', is_active: false };

    render(
      <AsyncMasterSelect
        label="Subcontractor"
        value="sub-old"
        fetchOptions={mockFetchOptions}
        persistedOption={inactiveOption}
        getOptionValue={item => item.id}
        getOptionLabel={item => item.subcontractor_name}
        onChange={mockOnChange}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('Old Partner (Inactive)')).toBeInTheDocument();
    });
  });
});
