import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, fireEvent, waitFor, act } from '@testing-library/react';
import UserMappings from './UserMappings';
import {
  renderPage,
  assertUrlState,
  describePageContract,
  mockApiScenario,
  withFakeTimers
} from '../test';
import authApi from '../api/authApi';

vi.mock('../api/authApi', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    interceptors: { response: { use: vi.fn() } }
  }
}));

// 1. Layer 1 & 2 Page Contract Proof
describePageContract(UserMappings, {
  name: 'UserMappings',
  route: '/user-mappings',
  allowedRoles: ['zo', 'ho', 'admin'],
  unauthorizedRole: 'je',
  headingMatch: /JE-to-ZO User Mappings/i,
  emptyTextMatch: /No active user mappings found/i
});

// 2. Layer 3 & Domain Interactions Proof
describe('UserMappings Page Domain & URL Contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('renders user mapping records from populated domain fixture', async () => {
    renderPage(<UserMappings />, {
      initialUrl: '/user-mappings',
      role: 'admin'
    });

    expect(await screen.findByText('Vikram JE')).toBeInTheDocument();
    expect(screen.getByText('Priya ZO')).toBeInTheDocument();
  });

  it('switches to history tab when button is clicked and writes ?tab=history', async () => {
    const { readLocation } = renderPage(<UserMappings />, {
      initialUrl: '/user-mappings',
      role: 'admin'
    });

    const historyTabBtn = await screen.findByRole('button', { name: /^History$/i });
    fireEvent.click(historyTabBtn);

    await waitFor(() => {
      assertUrlState({ tab: 'history' });
    });
    expect(readLocation()).toContain('tab=history');
  });

  it('opens Assign JE modal when clicking Assign / Transfer JE button', async () => {
    renderPage(<UserMappings />, {
      initialUrl: '/user-mappings',
      role: 'admin'
    });

    const assignBtn = await screen.findByRole('button', { name: /Assign \/ Transfer JE/i });
    fireEvent.click(assignBtn);

    expect(await screen.findByText(/Assign \/ Transfer Junior Engineer/i)).toBeInTheDocument();
  });
});

describe('UserMappings URL State, Modals & Aliases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiScenario(authApi, { scenario: 'populated' });
  });

  it('hydrates tab=history, search alias, and modal=assign from deep link', async () => {
    renderPage(<UserMappings />, {
      role: 'admin',
      initialUrl: '/user-mappings?tab=history&search=Vikram&modal=assign&source=bookmark',
      routePath: '/user-mappings'
    });

    expect(await screen.findByText(/Assign \/ Transfer Junior Engineer/i)).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText(/Search JEs or ZOs by name\/mobile/i);
    expect(searchInput).toHaveValue('Vikram');
  });

  it('closes assign modal while preserving tab, search, and bookmark parameter', async () => {
    const { readLocation } = renderPage(<UserMappings />, {
      role: 'admin',
      initialUrl: '/user-mappings?tab=history&search=Vikram&modal=assign&source=bookmark',
      routePath: '/user-mappings'
    });

    expect(await screen.findByText(/Assign \/ Transfer Junior Engineer/i)).toBeInTheDocument();

    const cancelBtn = screen.getByRole('button', { name: /Cancel/i });
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      const loc = readLocation();
      expect(loc).not.toContain('modal=');
      expect(loc).toContain('tab=history');
      expect(loc).toContain('search=Vikram');
      expect(loc).toContain('source=bookmark');
    });
  });

  it('safely handles invalid modal parameter without opening dialog', async () => {
    renderPage(<UserMappings />, {
      role: 'admin',
      initialUrl: '/user-mappings?modal=corrupted_modal&id=fake_id',
      routePath: '/user-mappings'
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /JE-to-ZO User Mappings/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/Assign \/ Transfer Junior Engineer/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
