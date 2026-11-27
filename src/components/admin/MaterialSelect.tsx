'use client';
// src/components/admin/MaterialSelect.tsx
// The Material field on plates and roto dies: a dropdown of the BOM material
// list, so a material is spelt one way across the app. A record saved before
// the list existed keeps its old value, shown as "not in BOM list", until
// someone picks a BOM name for it.

import { useBomMaterialNames } from '@/hooks/useReferenceData';

/** The BOM spelling of `value` (case and spaces ignored), else null. */
export function bomName(names: string[], value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key ? names.find((n) => n.trim().toLowerCase() === key) ?? null : null;
}

export default function MaterialSelect({ value, onChange, className }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { data: names = [], isLoading, isError } = useBomMaterialNames();
  const listed = bomName(names, value);
  const old = value.trim() && !listed && !isLoading ? value : null;
  return (
    <>
      <select aria-label="Material" className={className}
        value={listed ?? value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{isLoading ? 'Loading materials…' : 'Pick the material'}</option>
        {old && <option value={old}>{old} (not in BOM list)</option>}
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {isError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load the BOM material list</p>}
      {old && <p className="mt-1 text-xs text-[var(--glass-muted)]">Not in BOM → Materials. Pick one from the list, or ask Admin to add it.</p>}
    </>
  );
}
