import React, { useState, useEffect } from 'react';
import Input from './Input';
import { parseCurrencyString, formatIndianCurrency } from '../../utils/currencyFormatter';

const FormattedCurrencyInput = React.forwardRef(({
  value = '',
  onValueChange,
  onChange, // for backward compatibility/alias
  allowNegative = false,
  onFocus,
  onBlur,
  ...props
}, ref) => {
  const [displayValue, setDisplayValue] = useState('');

  // Sync display value when prop value changes from parent
  useEffect(() => {
    setDisplayValue(formatIndianCurrency(value));
  }, [value]);

  const handleChange = (e) => {
    const input = e.target;
    const rawInput = input.value;
    const originalSelectionStart = input.selectionStart;

    // Count how many non-comma characters were before the cursor in the raw input
    const rawSub = rawInput.slice(0, originalSelectionStart);
    const digitsBeforeCursor = rawSub.replace(/,/g, '').length;

    // Sanitize the input
    let sanitized = rawInput.replace(/[^\d.-]/g, '');
    
    // Ensure only one dot is allowed
    const dotParts = sanitized.split('.');
    if (dotParts.length > 2) {
      sanitized = dotParts[0] + '.' + dotParts.slice(1).join('');
    }

    // Ensure minus sign is only at the beginning
    if (sanitized.includes('-')) {
      if (allowNegative) {
        const hasMinus = sanitized.startsWith('-');
        sanitized = sanitized.replace(/-/g, '');
        if (hasMinus) sanitized = '-' + sanitized;
      } else {
        sanitized = sanitized.replace(/-/g, '');
      }
    }

    // Format in real-time
    const cleanVal = parseCurrencyString(sanitized, { allowNegative });
    const formatted = formatIndianCurrency(cleanVal);

    setDisplayValue(formatted);

    // Emit clean numeric string immediately
    if (onValueChange) {
      onValueChange(cleanVal);
    }
    if (onChange) {
      onChange({ target: { name: props.name, value: cleanVal } });
    }

    // Restore caret position in the next tick after DOM has updated
    setTimeout(() => {
      if (!input) return;
      
      let newSelectionStart = 0;
      let digitsFound = 0;
      for (let i = 0; i < formatted.length; i++) {
        if (digitsFound === digitsBeforeCursor) {
          newSelectionStart = i;
          break;
        }
        if (formatted[i] !== ',') {
          digitsFound++;
        }
        newSelectionStart = i + 1;
      }

      input.setSelectionRange(newSelectionStart, newSelectionStart);
    }, 0);
  };

  return (
    <Input
      ref={ref}
      type="text"
      value={displayValue}
      onFocus={onFocus}
      onBlur={onBlur}
      onChange={handleChange}
      inputMode="decimal"
      {...props}
    />
  );
});

FormattedCurrencyInput.displayName = 'FormattedCurrencyInput';

export default FormattedCurrencyInput;
