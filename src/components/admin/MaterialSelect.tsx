'use client';
// src/components/admin/MaterialSelect.tsx
// The Material field on plates and roto dies: a dropdown of Prepress's
// material list (not BOM's), so a material is spelt one way across the app.
// A record saved with a name no longer on the list keeps it, shown as "not in
// material list", until someone picks one from the list.

import { useState } from 'react';
import { Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { MATERIALS_KEY, useMaterials } from '@/hooks/useReferenceData';
import ManageNamesModal from '@/components/admin/ManageNamesModal';

/** The list's spelling of `value` (case and spaces ignored), else null. */
export function listName(names: string[], value: string | null | undefined): string | null {
  const key = value?.trim().toLowerCase();
  return key ? names.find((n) => n.trim().toLowerCase() === key) ?? null : null;
}

export default function MaterialSelect({ value, onChange, className }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { data, isLoading, isError } = useMaterials();
  const names = (data ?? []).map((m) => m.name);
  const listed = listName(names, value);
  const old = value.trim() && !listed && !isLoading ? value : null;
  return (
    <>
      <select aria-label="Material" className={className}
        value={listed ?? value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{isLoading ? 'Loading materials…' : 'Pick the material'}</option>
        {old && <option value={old}>{old} (not in material list)</option>}
        {names.map((n) => <option key={n} value={n}>{n}</option>)}
      </select>
      {isError && <p role="alert" className="mt-1 text-xs text-red-600">Could not load the material list</p>}
      {old && <p className="mt-1 text-xs text-[var(--glass-muted)]">Not on the material list. Pick one, or ask Prepress to add it.</p>}
    </>
  );
}

/** "Materials" on the Plates and Dies toolbars: Prepress/Admin keep the list. */
export function ManageMaterialsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} title="Manage materials"
        className={cn(
          'inline-flex items-center justify-center gap-1.5 min-h-11 min-w-11 px-3 rounded-xl shrink-0',
          'text-sm font-medium border border-[var(--glass-border)] text-[var(--glass-muted)]',
          'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
        )}>
        <Layers className="w-4 h-4" aria-hidden="true" />
        <span className="max-sm:sr-only">Materials</span>
      </button>
      {open && (
        <ManageNamesModal title="Materials" subtitle="What every Material field picks from: plates, dies and job cards. BOM keeps its own list."
          icon={Layers} url="/api/materials" plural="materials" singular="material" queryKey={MATERIALS_KEY} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
