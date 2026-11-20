import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Docs from './Docs';
import { ThemeProvider } from '../../components/ThemeContext';
import { LocationProbe, HistoryControls, readLocation, setBrowserUrl } from '../../test/routerTestUtils';

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

const renderDocs = (initialEntry = '/docs') => {
  return render(
    <ThemeProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/docs" element={<Docs />} />
          <Route path="/docs/:pageId" element={<Docs />} />
        </Routes>
        <LocationProbe />
        <HistoryControls />
      </MemoryRouter>
    </ThemeProvider>
  );
};

describe('Docs Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders default documentation page (What is IDBP?) with headings and breadcrumbs', async () => {
    renderDocs('/docs');

    expect(screen.getByText('Documentation Portal')).toBeInTheDocument();
    expect(screen.getAllByText('What is IDBP?').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Getting Started').length).toBeGreaterThanOrEqual(1);

    // Check TOC section
    expect(screen.getByText('In this article')).toBeInTheDocument();
    expect(screen.getAllByText('Core Functional Modules').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Access & Role Model').length).toBeGreaterThanOrEqual(1);
  });

  it('renders specific page when navigated to via slug /docs/account-setup', async () => {
    renderDocs('/docs/account-setup');

    expect(screen.getAllByText('Setting Up Your Account').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Step 1: Whitelist Authorization')).toBeInTheDocument();
  });

  it('filters sidebar navigation when typing in the search box', async () => {
    renderDocs('/docs');

    const searchInput = screen.getAllByPlaceholderText('Search docs...')[0];
    fireEvent.change(searchInput, { target: { value: 'Estimating' } });

    // Should show Cost Estimating page
    expect(screen.getByText('Cost Estimating')).toBeInTheDocument();
  });

  it('clears search box and restores full navigation on clicking clear button', async () => {
    renderDocs('/docs?q=Estimating');

    const clearButton = screen.getAllByTitle('Clear search')[0];
    expect(clearButton).toBeInTheDocument();

    fireEvent.click(clearButton);

    const searchInput = screen.getAllByPlaceholderText('Search docs...')[0];
    expect(searchInput.value).toBe('');
  });

  it('clicks Table of Contents link and triggers scrollIntoView', async () => {
    renderDocs('/docs/what-is-idbp');

    const headingLink = screen.getByRole('link', { name: 'Core Functional Modules' });
    fireEvent.click(headingLink);

    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('keeps the active documentation search when navigating through the sidebar', async () => {
    renderDocs('/docs/what-is-idbp?q=Estimating');

    const estimatingLink = await screen.findByRole('link', { name: 'Cost Estimating' });
    fireEvent.click(estimatingLink);

    expect(readLocation()).toBe('/docs/cost-estimates?q=Estimating');
    expect((await screen.findAllByText('Cost Estimating')).length).toBeGreaterThan(0);
  });

  it('restores the previous documentation page and search with browser Back', async () => {
    renderDocs('/docs/what-is-idbp?q=Estimating');

    fireEvent.click(await screen.findByRole('link', { name: 'Cost Estimating' }));
    expect(readLocation()).toBe('/docs/cost-estimates?q=Estimating');

    fireEvent.click(screen.getByTestId('router-back'));
    expect(readLocation()).toBe('/docs/what-is-idbp?q=Estimating');
  });

  it('redirects an unknown page slug to the canonical documentation page', async () => {
    renderDocs('/docs/not-a-real-page');

    expect((await screen.findAllByText('What is IDBP?')).length).toBeGreaterThan(0);
    expect(readLocation()).toBe('/docs/what-is-idbp');
  });

  it('debounces docs search URL writes and only persists the latest input', async () => {
    vi.useFakeTimers();
    try {
      renderDocs('/docs/what-is-idbp');
      const searchInput = screen.getAllByPlaceholderText('Search docs...')[0];

      fireEvent.change(searchInput, { target: { value: 'Account' } });
      fireEvent.change(searchInput, { target: { value: 'Estimat' } });
      expect(readLocation()).toBe('/docs/what-is-idbp');

      await act(async () => { vi.advanceTimersByTime(300); });
      expect(readLocation()).toBe('/docs/what-is-idbp?q=Estimat');
    } finally {
      vi.useRealTimers();
    }
  });

  it('writes a canonical heading fragment when a TOC item is selected', async () => {
    setBrowserUrl('/docs/what-is-idbp?q=setup');
    renderDocs('/docs/what-is-idbp?q=setup');

    fireEvent.click(screen.getByRole('link', { name: 'Core Functional Modules' }));
    expect(window.location.hash).toBe('#core-functions');
    expect(window.location.search).toBe('?q=setup');
  });
});
