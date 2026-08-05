import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import FormattedCurrencyInput from './FormattedCurrencyInput';

// Stateful wrapper to test controlled component behavior realistically
const ControlledInputWrapper = ({ initialValue = '', ...props }) => {
  const [value, setValue] = useState(initialValue);
  return (
    <FormattedCurrencyInput
      value={value}
      onValueChange={setValue}
      {...props}
    />
  );
};

describe('FormattedCurrencyInput Component Tests', () => {
  it('should render the input field with initial formatted value', () => {
    render(<FormattedCurrencyInput value="150000" onValueChange={() => {}} />);
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(input.value).toBe('1,50,000');
  });

  it('should remain formatted on focus and blur', () => {
    render(<ControlledInputWrapper initialValue="150000" />);
    const input = screen.getByRole('textbox');

    // 1. Initial display (not focused) -> formatted
    expect(input.value).toBe('1,50,000');

    // 2. Focus -> remains formatted
    fireEvent.focus(input);
    expect(input.value).toBe('1,50,000');

    // 3. Blur -> remains formatted
    fireEvent.blur(input);
    expect(input.value).toBe('1,50,000');
  });

  it('should call onValueChange and onChange when typing, and format in real-time', () => {
    const onValueChangeMock = vi.fn();
    const onChangeMock = vi.fn();
    render(
      <FormattedCurrencyInput
        value=""
        onValueChange={onValueChangeMock}
        onChange={onChangeMock}
        name="test_input"
      />
    );
    const input = screen.getByRole('textbox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1234.50' } });

    expect(onValueChangeMock).toHaveBeenCalledWith('1234.50');
    expect(onChangeMock).toHaveBeenCalledWith({
      target: { name: 'test_input', value: '1234.50' }
    });
    // Formatted in real-time
    expect(input.value).toBe('1,234.50');
  });

  it('should format correctly in real-time during typing', () => {
    render(<ControlledInputWrapper initialValue="" />);
    const input = screen.getByRole('textbox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '1234500' } });

    expect(input.value).toBe('12,34,500');
  });

  it('should strip non-numeric characters when typing', () => {
    render(<ControlledInputWrapper initialValue="" />);
    const input = screen.getByRole('textbox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '₹12,34abc5.00' } });

    expect(input.value).toBe('12,345.00');
  });

  it('should handle negative numbers when allowNegative is true', () => {
    render(<ControlledInputWrapper initialValue="" allowNegative={true} />);
    const input = screen.getByRole('textbox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '-1234.50' } });
    expect(input.value).toBe('-1,234.50');
  });

  it('should strip negative sign if allowNegative is false', () => {
    render(<ControlledInputWrapper initialValue="" allowNegative={false} />);
    const input = screen.getByRole('textbox');

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: '-1234.50' } });
    expect(input.value).toBe('1,234.50');
  });
});
