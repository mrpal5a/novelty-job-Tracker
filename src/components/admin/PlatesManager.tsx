'use client';
// src/components/admin/PlatesManager.tsx
// The plate rack. Every plate Prepress has made, searchable by the party,
// PM code, item or the serial etched on the plate itself.
//
// Read-only for most departments; Prepress and Admin can add, correct and
// remove records — this list is typed by hand, so mis-entries and duplicates
// have to be fixable.

import dynamic from 'next/dynamic';
import { useState, useEffect } from 'react';
import { useUrlSearch } from '@/hooks/useUrlSearch';
import { useIsDesk } from '@/hooks/useIsDesk';
import { plateListQuery, plateListParams, PLATE_PAGE_SIZE } from '@/lib/listQueries';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Search, Plus, Pencil, Trash2, Layers, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { cn, formatNumericDate } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { csvDate, csvTimestamp, type CsvColumn } from '@/lib/export/csv';
import type { SortDir } from '@/lib/sort';
import type { Plate } from '@/lib/types';
import CsvExportButton from './CsvExportButton';
import SortableHeaderLabel from './SortableHeaderLabel';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { SearchClearButton } from '@/components/ui/SearchClearButton';
import SizePairSearch, { useSizePair } from './SizePairSearch';
import { useDebouncedSearch } from '@/hooks/useDebouncedSearch';

// Loaded on first open, not with the page — it only renders when open.
const AddPlateModal = dynamic(() => import('./AddPlateModal'), { ssr: false });
const PlateDetailModal = dynamic(() => import('./PlateDetailModal'), { ssr: false });

// Header labels for the desk table — must stay in the same order as the
// <td>s rendered below. Party and item share a cell (party over item) so
// the table fits the 1240px content width with no sideways scroll.
const PLATE_COLUMNS = [
  'Location', 'Party · item', 'PM code', 'Size', 'Cylinder',
  'Labels / round', 'Plate date', 'Plate ID', 'Actions',
] as const;
type PlateColumn = typeof PLATE_COLUMNS[number];

// table-fixed widths. Every column has one, so no column soaks up the spare
// width on a wide screen — it's shared out in proportion instead. Sized to
// fit the 1232px table at a 1280px window (21% + 22% + 688px). Party · item
// wraps onto more lines rather than widening; other long text truncates,
// with the full value on hover and in the plate's detail dialog.
const COLUMN_WIDTH: Record<PlateColumn, string> = {
  'Plate ID':       'w-[21%]',
  'Party · item':   'w-[22%]',
  'PM code':        'w-[120px]',
  'Size':           'w-[104px]',
  'Cylinder':       'w-[76px]',
  'Labels / round': 'w-[76px]',
  'Location':       'w-[88px]',
  'Plate date':     'w-[104px]',
  'Actions':        'w-[120px]',
};
const NUMERIC_COLUMNS: PlateColumn[] = ['Cylinder', 'Labels / round'];

// Click-to-sort, mirroring JobSeparationManager/DiesManager. Size (across /
// around) is a merged header — it sorts by the more commonly filled field.
type SortField =
  | 'plate_id' | 'party' | 'pm_code' | 'item_name' | 'across_size' | 'cylinder'
  | 'label_per_round' | 'location' | 'plate_date' | 'created_at';

const COLUMN_SORT_FIELDS: Partial<Record<PlateColumn, SortField>> = {
  'Plate ID':         'plate_id',
  'Party · item':     'party',
  'PM code':          'pm_code',
  'Size':             'across_size',
  'Cylinder':         'cylinder',
  'Labels / round':   'label_per_round',
  'Location':         'location',
  'Plate date':       'plate_date',
};

// Stable reference — `data ?? []` would otherwise hand back a fresh array
// every render.
const EMPTY_PLATES: Plate[] = [];
const SHOW_STEP = PLATE_PAGE_SIZE;

// Mirrors PLATE_SEARCH_FIELDS in src/app/api/plates/route.ts — the value
// sent as ?field=. "All fields" (value 'all') skips the param, falling
// back to the server's multi-column OR search.
const PLATE_SEARCH_FIELDS: { value: string; label: string; placeholder: string }[] = [
  { value: 'all',             label: 'All fields',       placeholder: 'Search party, PM code, item or plate ID' },
  { value: 'party',           label: 'Party',            placeholder: 'Search by party' },
  { value: 'plate_id',        label: 'Plate ID',         placeholder: 'Search by plate ID' },
  { value: 'pm_code',         label: 'PM code',          placeholder: 'Search by PM code' },
  { value: 'item_name',       label: 'Item name',        placeholder: 'Search by item name' },
  { value: 'location',        label: 'Location',         placeholder: 'Search by location' },
  { value: 'size',            label: 'Size',             placeholder: 'Search by across or around size' },
  { value: 'cylinder',        label: 'Cylinder',         placeholder: 'Search by cylinder' },
  { value: 'label_per_round', label: 'Labels / round',   placeholder: 'Search by labels per round' },
];

const PLATE_EXPORT_COLUMNS: CsvColumn<Plate>[] = [
  { header: 'Plate ID',        value: (p) => p.plate_id ? p.plate_id.replace(/\n/g, '; ') : null },
  { header: 'Party',           value: (p) => p.party },
  { header: 'PM Code',         value: (p) => p.pm_code },
  { header: 'Item Name',       value: (p) => p.item_name },
  { header: 'Across Size (H)', value: (p) => p.across_size },
  { header: 'Around Size (W)', value: (p) => p.around_size },
  { header: 'Cylinder',        value: (p) => p.cylinder },
  { header: 'Label Per Round', value: (p) => p.label_per_round },
  { header: 'Location',        value: (p) => p.location },
  { header: 'Plate Date',      value: (p) => csvDate(p.plate_date) },
  { header: 'Added',           value: (p) => csvTimestamp(p.created_at) },
];

export default function PlatesManager({ canManage }: { canManage: boolean }) {
  const [search,      setSearch]      = useState('');
  const [searchField, setSearchField] = useState('all');
  const sizes = useSizePair();
  // Opened from Ctrl K with ?q=: a size ("210x60") fills the size boxes.
  useUrlSearch(setSearch, undefined, sizes.setSize);
  const [adding,      setAdding]      = useState(false);
  const [editing,     setEditing]     = useState<Plate | null>(null);
  const [viewing,     setViewing]     = useState<Plate | null>(null);
  // Actions only exist for Prepress/Admin; everyone else gets the space back.
  const columns = canManage ? PLATE_COLUMNS : PLATE_COLUMNS.filter((c) => c !== 'Actions');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [busyId,    setBusyId]    = useState<string | null>(null);
  const [sortField, setSortField] = useState<SortField>('created_at');
  const [sortDir,   setSortDir]   = useState<SortDir>('desc');

  // Click a header to sort by it; click the same one again to flip direction.
  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const queryClient = useQueryClient();

  const debouncedSearch = useDebouncedSearch(search);

  // The server sorts and sends one page (lib note in api/plates/route.ts):
  // the whole table is ~4,000 plates. "Show more" grows the page; a new
  // search or sort starts again from the top.
  const [visibleCount, setVisibleCount] = useState(SHOW_STEP);
  useEffect(() => { setVisibleCount(SHOW_STEP); }, [debouncedSearch, searchField, sizes.debounced, sortField, sortDir]);

  // Search + sort, shared by the page query and the CSV export. Key + fetch
  // live in lib/listQueries so the menu can warm this up.
  const listArgs = {
    search: debouncedSearch, field: searchField, sort: sortField, dir: sortDir,
    sizeA: sizes.debounced[0], sizeB: sizes.debounced[1],
  };
  const platesQuery = useQuery({
    ...plateListQuery({ ...listArgs, limit: visibleCount }),
    placeholderData: keepPreviousData,
  });
  const visiblePlates = platesQuery.data?.plates ?? EMPTY_PLATES;
  const total   = platesQuery.data?.total ?? 0;
  const loading = platesQuery.isLoading;
  const hiddenCount = Math.max(0, total - visiblePlates.length);
  const isWide = useIsDesk(1280); // Tailwind `xl`: table above, cards below

  // Every matching plate, in the order on screen — for the CSV export only.
  async function fetchAllPlates(): Promise<Plate[]> {
    const params = plateListParams(listArgs);
    params.set('all', '1');
    const res  = await fetch(`/api/plates?${params.toString()}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? 'Failed to load plates');
    return (data.plates ?? []) as Plate[];
  }

  useEffect(() => {
    if (platesQuery.error) toast.error((platesQuery.error as Error).message);
  }, [platesQuery.error]);

  async function deletePlate(plate: Plate) {
    setBusyId(plate.id);
    try {
      const res = await fetch(`/api/plates/${plate.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to delete plate');
        return;
      }
      queryClient.setQueriesData<{ plates: Plate[]; total: number }>(
        { queryKey: ['plates'] },
        (old) => old && { plates: old.plates.filter((p) => p.id !== plate.id), total: Math.max(0, old.total - 1) }
      );
      toast.success('Plate deleted');
    } catch {
      toast.error('Network error');
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  // One header for the skeleton and the loaded table, so the widths match.
  const tableHead = (sortable: boolean) => (
    <thead>
      <tr>
        {columns.map((col) => (
          <th key={col} scope="col" className={cn(
            'sticky top-0 z-10 px-2.5 py-2 text-left align-bottom',
            'bg-[var(--glass-bg-strong)] border-b border-white/12',
            COLUMN_WIDTH[col],
            (NUMERIC_COLUMNS.includes(col) || col === 'Actions') && 'text-right',
          )}>
            {sortable && COLUMN_SORT_FIELDS[col] ? (
              <SortableHeaderLabel
                label={col}
                active={sortField === COLUMN_SORT_FIELDS[col]}
                dir={sortDir}
                onClick={() => handleSort(COLUMN_SORT_FIELDS[col]!)}
              />
            ) : col === 'Actions' ? <span className="sr-only">Actions</span> : col}
          </th>
        ))}
      </tr>
    </thead>
  );

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <select
          value={searchField}
          onChange={(e) => setSearchField(e.target.value)}
          aria-label="Search field"
          title="Narrow the search to one field"
          className={cn(
            'min-h-11 px-3 rounded-xl text-sm shrink-0',
            'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
            'focus:outline-none focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
          )}
        >
          {PLATE_SEARCH_FIELDS.map((f) => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <div className="relative flex-1">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--glass-muted)]"
            aria-hidden="true"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={PLATE_SEARCH_FIELDS.find((f) => f.value === searchField)?.placeholder}
            aria-label="Search plates"
            title="Search this page (/)"
            data-global-search
            className={cn(
              'w-full min-h-11 pl-9 pr-11 rounded-xl text-sm',
              'bg-[var(--field-bg)] border border-[var(--field-border)] text-[var(--glass-ink)]',
              'placeholder:text-[var(--glass-muted)] focus:outline-none',
              'focus:border-emerald-300/70 focus:shadow-[0_0_0_4px_rgba(124,240,190,0.22)] transition-all',
            )}
          />
          <SearchClearButton value={search} onClear={() => setSearch('')} />
        </div>

        <SizePairSearch value={sizes.size} onChange={sizes.setSize} labels={['Across', 'Around']} />

        <CsvExportButton fetchRows={fetchAllPlates} count={total} columns={PLATE_EXPORT_COLUMNS} filename="plates" />

        {canManage && (
          <Button intent="primary" icon={Plus} onClick={() => setAdding(true)}>
              Add plate
          </Button>
        )}
      </div>

      {!loading && total > 0 && (
        <p className="text-sm text-[var(--glass-muted)]">
          <strong className="text-[var(--glass-ink)]">{total}</strong>
          {' '}{total === 1 ? 'plate' : 'plates'}
          {(search || sizes.active) && ' matching your search'}
        </p>
      )}

      {loading ? (
        <>
          {/* Phone / tablet: card skeleton */}
          <div className="xl:hidden space-y-2" aria-hidden="true">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-black/[0.04]" />
            ))}
          </div>
          {/* Desk: table skeleton */}
          <div className="hidden xl:block rounded-xl glass overflow-hidden">
            <table className="w-full table-fixed border-collapse text-sm [&_td+td]:border-l [&_th+th]:border-l [&_td+td]:border-[var(--glass-border)] [&_th+th]:border-[var(--glass-border)]">
              {tableHead(false)}
              <tbody>
                <SkeletonRows rows={5} cols={columns.length} />
              </tbody>
            </table>
          </div>
        </>
      ) : visiblePlates.length === 0 ? (
        <EmptyState hasSearch={Boolean(search) || sizes.active} />
      ) : (
        <>
          {/* Phone / tablet: card list. Tapping the top of a card opens the
              plate's detail, where every plate ID is listed. */}
          {!isWide && <ul className="space-y-3">
            {visiblePlates.map((plate) => {
              const ids = plateIdsOf(plate);
              return (
                <li key={plate.id} className="glass rounded-xl p-4">
                  <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div className="min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setViewing(plate)}
                        aria-label={`View plate ${ids[0] ?? plate.item_name ?? ''}`.trim()}
                        className="block w-full min-h-11 text-left rounded-lg -m-1 p-1 hover:bg-black/[0.03] transition-colors"
                      >
                        <div className="flex items-center gap-1.5 min-w-0">
                          <PlateIdChip ids={ids} />
                        </div>
                        {plate.party && (
                          <p className="text-xs font-medium text-[var(--glass-muted)] mt-1.5 break-words">
                            {plate.party}
                          </p>
                        )}
                        <p className="text-sm font-mono font-semibold text-[var(--glass-ink)] mt-1 break-words">
                          {plate.pm_code ?? '—'}
                        </p>
                        {plate.item_name && (
                          <p className="text-xs text-[var(--glass-muted)] mt-0.5 break-words">
                            {plate.item_name}
                          </p>
                        )}
                      </button>

                      {/* Specs: one labeled cell per field, aligned in a grid instead
                          of a wrapping inline list — each value gets its own space. */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3 mt-3 pt-3 border-t border-black/[0.06]">
                        <SpecField label="Size" value={sizeOf(plate)} mono />
                        <SpecField label="Cylinder" value={plate.cylinder?.toString()} mono />
                        <SpecField label="Labels / round" value={plate.label_per_round?.toString()} mono />
                        <SpecField label="Location" value={plate.location} />
                        <SpecField label="Plate date" value={plate.plate_date ? formatNumericDate(plate.plate_date) : null} mono />
                      </div>
                    </div>

                    {canManage && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => setEditing(plate)}
                          aria-label={`Edit plate for ${plate.party || plate.item_name || 'this plate'}`}
                          className={cn(
                            'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                            'text-xs font-medium border border-black/[0.12] text-[var(--glass-muted)]',
                            'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                          )}
                        >
                          <Pencil className="w-4 h-4" aria-hidden="true" />
                          Edit
                        </button>

                        {confirmId === plate.id ? (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => deletePlate(plate)}
                              disabled={busyId === plate.id}
                              className={cn(
                                'inline-flex items-center justify-center min-h-11 px-3 rounded-lg',
                                'text-xs font-medium border border-red-200 bg-red-50 text-red-800',
                                'hover:bg-red-100 disabled:opacity-50 transition-colors whitespace-nowrap',
                              )}
                            >
                              {busyId === plate.id ? 'Deleting…' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => setConfirmId(null)}
                              disabled={busyId === plate.id}
                              className="min-h-11 px-2 text-xs font-medium text-[var(--glass-muted)] hover:text-[var(--glass-ink)] disabled:opacity-40 transition-colors"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmId(plate.id)}
                            aria-label={`Delete plate for ${plate.party || plate.item_name || 'this plate'}`}
                            className={cn(
                              'inline-flex items-center justify-center gap-1.5 min-h-11 px-3 rounded-lg',
                              'text-xs font-medium border border-black/[0.12] text-[var(--glass-muted)]',
                              'hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors',
                            )}
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                            Delete
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>}

          {/* Desk: fixed-layout table — every column has a set width, long
              text truncates, so nothing pushes the table sideways. Click a
              row for the full record. */}
          {isWide && <div className="rounded-xl glass overflow-hidden">
            {/* `relative`: the rows' sr-only text is absolutely positioned;
                without a positioned scroll box it escapes to the page and
                stretches the document to the full table height. */}
            <div className="relative max-h-[70vh] overflow-y-auto">
              <table className="w-full table-fixed border-collapse text-sm [&_td+td]:border-l [&_th+th]:border-l [&_td+td]:border-[var(--glass-border)] [&_th+th]:border-[var(--glass-border)]">
                {tableHead(true)}
                <tbody>
                  {visiblePlates.map((plate, i) => {
                    const ids = plateIdsOf(plate);
                    return (
                      <tr
                        key={plate.id}
                        onClick={() => setViewing(plate)}
                        className={cn(
                          'border-b border-white/8 hover:bg-black/[0.03] transition-colors cursor-pointer',
                          i % 2 === 1 && 'bg-[var(--glass-bg)]',
                        )}
                      >
                        <td className="px-2.5 py-1.5 font-semibold text-[var(--glass-ink)] truncate" title={plate.location ?? undefined}>{plate.location || '—'}</td>
                        <td className="px-2.5 py-1.5">
                          <p className="font-semibold text-[var(--glass-ink)] [overflow-wrap:anywhere]">
                            {plate.party || '—'}
                          </p>
                          {plate.item_name && (
                            <p className="text-xs text-[var(--glass-muted)] mt-0.5 [overflow-wrap:anywhere]">
                              {plate.item_name}
                            </p>
                          )}
                        </td>
                        <td className="px-2.5 py-1.5 font-mono truncate" title={plate.pm_code ?? undefined}>{plate.pm_code ?? '—'}</td>
                        <td className="px-2.5 py-1.5 font-mono">{sizeOf(plate) ?? '—'}</td>
                        <td className="px-2.5 py-1.5 font-mono text-right">{plate.cylinder ?? '—'}</td>
                        <td className="px-2.5 py-1.5 font-mono text-right">{plate.label_per_round ?? '—'}</td>
                        <td className="px-2.5 py-1.5 font-mono text-[var(--glass-muted)] whitespace-nowrap">
                          {plate.plate_date ? formatNumericDate(plate.plate_date) : '—'}
                        </td>
                        <td className="px-2.5 py-1.5">
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setViewing(plate); }}
                            aria-label={`View plate ${ids[0] ?? plate.item_name ?? ''}`.trim()}
                            className="flex items-center gap-1.5 max-w-full min-h-11 text-left"
                          >
                            <PlateIdChip ids={ids} />
                          </button>
                        </td>
                        {canManage && (
                          <td className="px-2 py-1 text-right" onClick={(e) => e.stopPropagation()}>
                            {confirmId === plate.id ? (
                              <div className="inline-flex items-center gap-1">
                                <button
                                  onClick={() => deletePlate(plate)}
                                  disabled={busyId === plate.id}
                                  className="inline-flex items-center justify-center min-h-11 px-2.5 rounded-lg text-[11px] font-medium border border-red-200 bg-red-50 text-red-800 hover:bg-red-100 disabled:opacity-50 transition-colors whitespace-nowrap"
                                >
                                  {busyId === plate.id ? '…' : 'Confirm'}
                                </button>
                                <button
                                  onClick={() => setConfirmId(null)}
                                  disabled={busyId === plate.id}
                                  aria-label="Cancel delete"
                                  title="Cancel"
                                  className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg text-[var(--glass-muted)] hover:text-[var(--glass-ink)] hover:bg-black/[0.04] disabled:opacity-40 transition-colors"
                                >
                                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            ) : (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  onClick={() => setEditing(plate)}
                                  aria-label={`Edit plate for ${plate.party || plate.item_name || 'this plate'}`}
                                  title="Edit"
                                  className={cn(
                                    'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                    'border border-black/[0.12] text-[var(--glass-muted)]',
                                    'hover:bg-black/[0.04] hover:text-[var(--glass-ink)] transition-colors',
                                  )}
                                >
                                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  onClick={() => setConfirmId(plate.id)}
                                  aria-label={`Delete plate for ${plate.party || plate.item_name || 'this plate'}`}
                                  title="Delete"
                                  className={cn(
                                    'inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg',
                                    'border border-black/[0.12] text-[var(--glass-muted)]',
                                    'hover:bg-red-50 hover:border-red-200 hover:text-red-800 transition-colors',
                                  )}
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>}

          {hiddenCount > 0 && (
            <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 pt-1">
              <p className="text-sm text-[var(--glass-muted)]">
                Showing <strong className="text-[var(--glass-ink)] font-mono">{visiblePlates.length}</strong> of{' '}
                <strong className="text-[var(--glass-ink)] font-mono">{total}</strong>, search to jump straight to a plate
              </p>
              <Button intent="ghost" onClick={() => setVisibleCount((n) => n + SHOW_STEP)}>
                Show {Math.min(SHOW_STEP, hiddenCount)} more
              </Button>
            </div>
          )}
        </>
      )}

      {viewing && (
        <PlateDetailModal
          plate={viewing}
          plateIds={plateIdsOf(viewing)}
          onClose={() => setViewing(null)}
          onEdit={canManage ? () => { setEditing(viewing); setViewing(null); } : undefined}
        />
      )}
      {(adding || editing) && (
        <AddPlateModal
          editing={editing ?? undefined}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { setAdding(false); setEditing(null); queryClient.invalidateQueries({ queryKey: ['plates'] }); }}
        />
      )}
    </div>
  );
}

function sizeOf(plate: Plate): string | null {
  return plate.across_size || plate.around_size
    ? `${plate.across_size ?? '—'} × ${plate.around_size ?? '—'}`
    : null;
}

// Lists show a plate's first ID only — a multi-colour set can carry a dozen,
// which used to stretch the table sideways. "+N" says more are in the detail.
function PlateIdChip({ ids }: { ids: string[] }) {
  if (ids.length === 0) return <span className="text-[var(--glass-muted)]">—</span>;
  const more = ids.length - 1;
  return (
    <>
      <span
        className="min-w-0 truncate font-mono text-xs font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200"
        title={ids.join('\n').toUpperCase()}
      >
        {ids[0].toUpperCase()}
      </span>
      {more > 0 && (
        <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-black/[0.05] text-[var(--glass-muted)]">
          +{more}<span className="sr-only"> more plate {more === 1 ? 'ID' : 'IDs'}</span>
        </span>
      )}
    </>
  );
}

// A plate record can hold several etched IDs, one per line (entered via
// Shift+Enter in the form) — split them out so each renders as its own tag.
function plateIdsOf(plate: Plate): string[] {
  if (!plate.plate_id) return [];
  return plate.plate_id
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function SpecField({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value || value === '—') return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-medium text-[var(--glass-muted)] uppercase tracking-wide">
        {label}
      </p>
      <p className={cn('text-sm text-[var(--glass-ink)] font-semibold mt-0.5 truncate', mono && 'font-mono')}>
        {value}
      </p>
    </div>
  );
}

function EmptyState({ hasSearch }: { hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center text-center rounded-xl border border-black/[0.08] bg-white px-4 py-12">
      <Layers className="w-6 h-6 text-[var(--glass-muted)]" aria-hidden="true" />
      <p className="text-sm font-medium text-[var(--glass-ink)] mt-3">
        {hasSearch ? 'No plates match that search.' : 'No plates recorded yet.'}
      </p>
      <p className="text-xs text-[var(--glass-muted)] mt-1 max-w-[42ch]">
        {hasSearch
          ? 'Try the party name, PM code, item name or the ID etched on the plate.'
          : 'Prepress records a plate here once it is made, so the next run can find it on the rack.'}
      </p>
    </div>
  );
}
