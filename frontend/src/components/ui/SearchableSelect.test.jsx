import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SearchableSelect from './SearchableSelect';

const options = [
  { value: '1', label: 'Travelling & Conveyance' },
  { value: '2', label: 'Travelling Expenses' }
];

// The dropdown menu is rendered through a portal into document.body (not
// nested inside this component's own container) so it can't be clipped or
// out-stacked by an ancestor with overflow-x-auto — Table.jsx wraps every
// table in one, and per the CSS overflow spec, setting only overflow-x forces
// overflow-y to 'auto' too, silently turning that wrapper into a clipping
// container for anything absolutely-positioned inside it.
describe('SearchableSelect — dropdown renders via a body portal, not nested in the table', () => {
  it('renders the option list outside the component\'s own container, in document.body', () => {
    const { container } = render(<SearchableSelect options={options} placeholder="Search..." />);
    fireEvent.focus(screen.getByPlaceholderText('Search...'));

    const option = screen.getByText('Travelling & Conveyance');
    expect(container.contains(option)).toBe(false);
    expect(document.body.contains(option)).toBe(true);
  });

  it('still fires onSelect when clicking a portaled option (click-outside logic must not eat the click)', () => {
    const onSelect = vi.fn();
    render(<SearchableSelect options={options} placeholder="Search..." onSelect={onSelect} />);
    fireEvent.focus(screen.getByPlaceholderText('Search...'));

    fireEvent.mouseDown(screen.getByText('Travelling Expenses'));
    fireEvent.click(screen.getByText('Travelling Expenses'));

    expect(onSelect).toHaveBeenCalledWith(options[1]);
  });

  it('closes when clicking truly outside both the input and the portaled menu', () => {
    render(<SearchableSelect options={options} placeholder="Search..." />);
    fireEvent.focus(screen.getByPlaceholderText('Search...'));
    expect(screen.getByText('Travelling & Conveyance')).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('Travelling & Conveyance')).not.toBeInTheDocument();
  });
});

// For a row near the bottom of the viewport (e.g. the last row in the
// table), opening downward would run the menu off-screen. It should flip to
// open above the input instead once there isn't enough room below.
describe('SearchableSelect — flips above the input when there is no room below', () => {
  it('positions the menu with `top` (opens downward) when there is plenty of room below', () => {
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 100, bottom: 130, left: 20, right: 300, width: 280, height: 30
    });

    render(<SearchableSelect options={options} placeholder="Search..." />);
    fireEvent.focus(screen.getByPlaceholderText('Search...'));

    const menu = screen.getByText('Travelling & Conveyance').closest('div');
    expect(menu.style.top).toBe('134px');
    expect(menu.style.bottom).toBe('');

    vi.restoreAllMocks();
  });

  it('positions the menu with `bottom` (opens upward) when the row is near the bottom of the viewport', () => {
    Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 380, bottom: 410, left: 20, right: 300, width: 280, height: 30
    });

    render(<SearchableSelect options={options} placeholder="Search..." />);
    fireEvent.focus(screen.getByPlaceholderText('Search...'));

    const menu = screen.getByText('Travelling & Conveyance').closest('div');
    expect(menu.style.bottom).toBe('24px');
    expect(menu.style.top).toBe('');

    vi.restoreAllMocks();
  });
});

// autoFocus is forwarded to the underlying Input — needed by callers like
// LineItemRow's Particulars field, which focuses a freshly-created row.
describe('SearchableSelect — autoFocus', () => {
  it('focuses the input on mount when autoFocus is true', () => {
    render(<SearchableSelect options={options} placeholder="Search..." autoFocus />);
    expect(screen.getByPlaceholderText('Search...')).toHaveFocus();
  });

  it('does not focus the input when autoFocus is false (default)', () => {
    render(<SearchableSelect options={options} placeholder="Search..." />);
    expect(screen.getByPlaceholderText('Search...')).not.toHaveFocus();
  });
});
