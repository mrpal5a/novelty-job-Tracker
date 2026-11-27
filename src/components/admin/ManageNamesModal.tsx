'use client';
// src/components/admin/ManageNamesModal.tsx
// A master list of names a field picks from, managed by Prepress/Admin: add
// one the picker doesn't have yet, or remove one that was mistyped. Used for
// Parties (Job Separation) and Materials (plates, dies, job cards).
//
// Removing a name never touches a record already saved with it: records
// store the name as text, not a reference to the list.

import React, { useState, useEffect, useCallback, useId } from 'react';
import { Trash2, Plus, X, type LucideIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import { ModalShell } from './modals';
import { useQueryClient } from '@tanstack/react-query';

const inputCls = cn(
  'w-full min-h-11 px-3 py-2 rounded-lg text-sm bg-[var(--field-bg)] border border-[var(--field-border)]',
  'text-[var(--glass-ink)] placeholder:text-[var(--glass-muted)]',
  'focus:outline-none focus:border-emerald-300/70 focus:bg-white/[0.14]',
  'focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
);

type Item = { id: string; name: string };

/** `url` serves GET { [plural]: Item[] }, POST { name } → { [singular]: Item },
 *  DELETE `${url}/${id}`. */
export default function ManageNamesModal({ title, subtitle, icon: Icon, url, plural, singular, queryKey, onClose }: {
  title: string; subtitle: string; icon: LucideIcon; url: string;
  plural: string; singular: string; queryKey: readonly string[]; onClose: () => void;
}) {
  const titleId = useId();
  const [items,    setItems]    = useState<Item[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [newName,    setNewName]    = useState('');
  const [adding,     setAdding]     = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busyId,     setBusyId]     = useState<string | null>(null);
  // The forms pick from a cached list: refresh it.
  const queryClient = useQueryClient();

  const load = useCallback(async () => {
    try {
      const res  = await fetch(url);
      const data = await res.json();
      if (res.ok) setItems(data[plural] ?? []);
      else toast.error(data.error ?? `Failed to load ${plural}`);
    } catch {
      toast.error('Network error');
    } finally {
      setLoading(false);
    }
  }, [url, plural]);

  useEffect(() => { load(); }, [load]);

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;

    setAdding(true);
    try {
      const res  = await fetch(url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Failed to add ${singular}`);
        return;
      }
      setItems((prev) =>
        prev.some((p) => p.id === data[singular].id)
          ? prev
          : [...prev, data[singular]].sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
            )
      );
      setNewName('');
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
      toast.success(`${data[singular].name} added`);
    } catch {
      toast.error('Network error');
    } finally {
      setAdding(false);
    }
  }

  async function remove(item: Item) {
    setBusyId(item.id);
    try {
      const res  = await fetch(`${url}/${item.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? `Failed to remove ${singular}`);
        return;
      }
      setItems((prev) => prev.filter((p) => p.id !== item.id));
      queryClient.invalidateQueries({ queryKey: [...queryKey] });
      toast.success(`${item.name} removed`);
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirming(null);
    }
  }

  return (
    <ModalShell titleId={titleId} onClose={onClose}>
      <div className="flex flex-col max-h-[85vh]">
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-white/12 shrink-0">
          <div>
            <h2 id={titleId} className="text-base font-semibold text-[var(--glass-ink)] flex items-center gap-2">
              <Icon className="w-4 h-4" aria-hidden="true" />
              {title}
            </h2>
            <p className="text-xs text-[var(--glass-muted)] mt-0.5">
              {subtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 -m-1.5 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={addItem} className="flex items-center gap-2 px-5 py-3 border-b border-white/12 shrink-0">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={`Add a ${singular} name…`}
            aria-label={`New ${singular} name`}
            maxLength={200}
            className={inputCls}
          />
          <button
            type="submit"
            disabled={adding || !newName.trim()}
            className={cn(
              'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg shrink-0',
              'text-sm font-medium bg-brand-primary text-white hover:bg-brand-primary/90',
              'disabled:opacity-40 transition-colors',
            )}
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add
          </button>
        </form>

        <div className="px-5 py-3 overflow-y-auto">
          {loading ? (
            <div className="space-y-2" aria-hidden="true">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-black/[0.04]" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-[var(--glass-muted)] text-center py-6">
              No {plural} yet. Add the first one above.
            </p>
          ) : (
            <ul className="divide-y divide-white/10">
              {items.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm text-[var(--glass-ink)] truncate">{p.name}</span>
                  <button
                    type="button"
                    onClick={() => (confirming === p.id ? remove(p) : setConfirming(p.id))}
                    onBlur={() => setConfirming((id) => (id === p.id ? null : id))}
                    disabled={busyId === p.id}
                    aria-label={`${confirming === p.id ? 'Confirm removing' : 'Remove'} ${p.name}`}
                    className={cn(
                      'inline-flex items-center gap-1.5 shrink-0 min-h-11 px-2.5 rounded-lg',
                      'text-xs font-medium border transition-colors disabled:opacity-50 whitespace-nowrap',
                      confirming === p.id
                        ? 'border-red-300 bg-red-100 text-red-800 hover:bg-red-200'
                        : 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100',
                    )}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {busyId === p.id ? 'Removing…' : confirming === p.id ? 'Confirm' : 'Remove'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </ModalShell>
  );
}
