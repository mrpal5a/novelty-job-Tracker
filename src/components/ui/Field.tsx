'use client';
// src/components/ui/Field.tsx
import React, { useId } from 'react';
import { cn } from '@/lib/utils';

const INPUT_BASE =
  'peer w-full rounded-xl bg-white border border-brand-border ' +
  'px-3.5 pt-5 pb-2 text-sm text-brand-ink outline-none ' +
  'placeholder:text-transparent transition-all duration-200 ' +
  'focus:-translate-y-0.5 motion-reduce:focus:translate-y-0 ' +
  'focus:border-[#16A06A] focus:bg-white ' +
  'focus:shadow-[var(--ring-focus)]';

const LABEL_BASE =
  'pointer-events-none absolute left-3.5 top-3.5 text-sm text-brand-muted transition-all duration-200 ' +
  'peer-focus:top-1.5 peer-focus:text-[10px] peer-focus:uppercase peer-focus:tracking-wide peer-focus:text-[#0B7A4F] ' +
  'peer-[:not(:placeholder-shown)]:top-1.5 peer-[:not(:placeholder-shown)]:text-[10px] ' +
  'peer-[:not(:placeholder-shown)]:uppercase peer-[:not(:placeholder-shown)]:tracking-wide ' +
  'peer-[:not(:placeholder-shown)]:text-[#0B7A4F]';

type FieldProps = React.InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  multiline?: boolean;
  rows?: number;
};

export function Field({ label, multiline, rows = 3, className, id, ...rest }: FieldProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="relative">
      {multiline ? (
        <textarea
          id={fieldId}
          rows={rows}
          placeholder=" "
          className={cn(INPUT_BASE, 'resize-none', className)}
          {...(rest as unknown as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input id={fieldId} placeholder=" " className={cn(INPUT_BASE, className)} {...rest} />
      )}
      <label htmlFor={fieldId} className={LABEL_BASE}>{label}</label>
    </div>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string };

export function SelectField({ label, className, id, children, ...rest }: SelectProps) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <div className="relative">
      <select
        id={fieldId}
        className={cn(
          'w-full rounded-xl bg-[var(--glass-bg)] border border-[var(--glass-border)] px-3.5 pt-5 pb-2 text-sm',
          'text-[var(--glass-ink)] outline-none transition-all duration-200',
          'focus:border-[#16A06A] focus:bg-white focus:shadow-[var(--ring-focus)]',
          className,
        )}
        {...rest}
      >
        {children}
      </select>
      <label
        htmlFor={fieldId}
        className="pointer-events-none absolute left-3.5 top-1.5 text-[10px] uppercase tracking-wide text-[#0B7A4F]"
      >
        {label}
      </label>
    </div>
  );
}
