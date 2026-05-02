import React from 'react';
import { cn } from '../lib/utils';

export const PageHeader = ({ title, description, meta }) => (
  <div className="mb-6 flex flex-col gap-2">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description && <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {meta && <div className="text-xs text-muted-foreground">{meta}</div>}
    </div>
  </div>
);

export const Panel = ({ children, className }) => (
  <section className={cn('rounded-md border bg-card text-card-foreground shadow-sm', className)}>
    {children}
  </section>
);

export const PanelHeader = ({ title, description, actions }) => (
  <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
    <div>
      <h3 className="font-semibold">{title}</h3>
      {description && <p className="mt-1 text-xs text-muted-foreground">{description}</p>}
    </div>
    {actions}
  </div>
);

export const EmptyState = ({ children = 'No data for the selected filters.' }) => (
  <div className="p-8 text-center text-sm text-muted-foreground">{children}</div>
);

export const SelectField = ({ label, value, onChange, options, allLabel = 'All' }) => (
  <label className="flex flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
    {label}
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="min-w-[150px] rounded-md border bg-background px-3 py-2 text-sm font-normal normal-case tracking-normal text-foreground"
    >
      {allLabel && <option value="all">{allLabel}</option>}
      {options.map((option) => (
        <option key={option.value ?? option} value={option.value ?? option}>
          {option.label ?? option}
        </option>
      ))}
    </select>
  </label>
);

export const CheckboxPills = ({ label, values, selected, onChange }) => {
  const toggle = (value) => {
    if (selected.includes(value)) {
      onChange(selected.filter((item) => item !== value));
      return;
    }
    onChange([...selected, value]);
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      <div className="flex flex-wrap gap-2">
        {values.map((value) => {
          const active = selected.includes(value);
          return (
            <button
              key={value}
              type="button"
              onClick={() => toggle(value)}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm transition-colors',
                active
                  ? 'border-foreground bg-foreground text-background'
                  : 'border-input bg-background text-foreground hover:bg-muted'
              )}
            >
              {value}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export const LoadingOrError = ({ isLoading, error }) => {
  if (isLoading) return <div className="mb-4 text-sm text-muted-foreground">Loading benchmark data...</div>;
  if (error) return <div className="mb-4 text-sm text-red-600">{error}</div>;
  return null;
};
