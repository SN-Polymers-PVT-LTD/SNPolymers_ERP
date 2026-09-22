import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Docs from './Docs';
import { ThemeProvider } from '../../components/ThemeContext';

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
});
