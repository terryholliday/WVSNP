'use client';

import React from 'react';

export interface FormFieldProps {
  label: string;
  name: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

export function FormField({
  label,
  name,
  required = false,
  error,
  hint,
  children,
  className = ''
}: FormFieldProps) {
  const fieldId = `field-${name}`;
  const errorId = error ? `error-${name}` : undefined;
  const hintId = hint ? `hint-${name}` : undefined;

  return (
    <div className={`space-y-1 ${className}`}>
      {/* Label */}
      <label
        htmlFor={fieldId}
        className="block text-sm font-medium text-gray-700"
      >
        {label}
        {required && (
          <span className="text-red-500 ml-1" aria-label="required">
            *
          </span>
        )}
      </label>

      {/* Field */}
      <div className="relative">
        {React.cloneElement(children as React.ReactElement, {
          id: fieldId,
          name,
          'aria-required': required,
          'aria-invalid': !!error,
          'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
        })}
      </div>

      {/* Error Message */}
      {error && (
        <p
          id={errorId}
          className="text-sm text-red-600"
          role="alert"
          aria-live="polite"
        >
          {error}
        </p>
      )}

      {/* Hint Text */}
      {hint && !error && (
        <p
          id={hintId}
          className="text-sm text-gray-500"
        >
          {hint}
        </p>
      )}
    </div>
  );
}
