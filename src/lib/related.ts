// src/lib/related.ts
// ============================================================
// Everything connected to one plate, die or shade card, as lists of links.
// PM code joins orders, plates and shade cards; plates, dies and job cards
// hold each other's ids. Codes typed for "no code" (N/A, NIL…) join nothing.
// ============================================================

import { isPlaceholderPm } from '@/lib/plateDie';

export type RelatedItem = { id: string; title: string; detail: string; tag?: string; href: string };
export type RelatedGroup = { key: 'orders' | 'jobCards' | 'plates' | 'dies' | 'shadeCards'; title: string; note?: string; items: RelatedItem[] };

/** A PM code as compared: trimmed, any case. Null when it isn't one. */
export function pmKey(code: string | null | undefined): string | null {
  const c = code?.trim().toLowerCase() ?? '';
  return c && !isPlaceholderPm(c) ? c : null;
}

/** The distinct real PM codes on some records. */
export function pmKeys(rows: { pm_code: string | null }[]): string[] {
  return Array.from(new Set(rows.map((r) => pmKey(r.pm_code)).filter((c): c is string => c !== null)));
}

const line = (...parts: (string | number | null | undefined | false)[]) => parts.filter(Boolean).join(' · ');
const q = (v: string) => encodeURIComponent(v);

export type LineRow = {
  id: string; sr_no: string | null; party: string; po_no: string | null; pm_code: string | null;
  material_name: string | null; quantity: number | null; jc_status: string | null; cancelled_at: string | null;
};
export function orderItem(r: LineRow): RelatedItem {
  return {
    id: r.id,
    title: line(r.sr_no, r.party),
    detail: line(r.material_name, r.po_no && `PO ${r.po_no}`, r.quantity != null && `${r.quantity.toLocaleString('en-IN')} labels`),
    tag: r.cancelled_at ? 'Cancelled' : undefined,
    href: `/admin/job-separation?q=${q(r.sr_no ?? r.po_no ?? r.party)}`,
  };
}

export type CardRow = {
  id: string; card_number: string | null; manual?: { number: string | null } | null; party: string | null; job_name: string | null; part: number; part_name: string | null; issued_at: string | null;
  job_separations: { sr_no: string | null } | null;
};
export function jobCardItem(r: CardRow): RelatedItem {
  return {
    id: r.id,
    title: line(r.card_number ?? r.job_separations?.sr_no ?? r.manual?.number ?? 'Job card', r.part_name),
    detail: line(r.party, r.job_name),
    tag: r.issued_at ? undefined : 'Draft',
    href: `/admin/job-cards/${r.id}`,
  };
}

export type PlateRow = {
  id: string; party: string; pm_code: string | null; item_name: string | null; plate_id: string | null; die_id: string | null;
  across_size: string | null; around_size: string | null; cylinder: number | null; location: string | null;
};
export function plateItem(r: PlateRow, linked = false): RelatedItem {
  // A set carries several IDs, one per line; the first finds it.
  const first = r.plate_id?.split('\n')[0].trim();
  return {
    id: r.id,
    title: r.item_name || r.pm_code || first || 'Plate',
    detail: line(r.location && `Location ${r.location}`, `${r.across_size ?? '—'} × ${r.around_size ?? '—'}`, r.cylinder && `${r.cylinder}T`, r.party),
    tag: linked ? 'Linked' : undefined,
    href: `/admin/plates?q=${q(first || r.pm_code || r.item_name || r.party)}`,
  };
}

export type DieRow = {
  id: string; serial_no: string | null; job_name: string; location: string | null; ups: number | null; status: string;
  length: string | null; width: string | null; cylinder: number | null;
};
export function dieItem(r: DieRow, linked = false): RelatedItem {
  return {
    id: r.id,
    title: `Roto die at ${r.location || '—'}`,
    detail: line(r.serial_no, `${r.length ?? '—'} × ${r.width ?? '—'}`, r.cylinder && `${r.cylinder}T`, r.ups && `${r.ups} ups`),
    tag: r.status === 'DAMAGE' ? 'Damaged' : linked ? 'Linked' : r.status === 'EXTRA' ? 'Extra' : undefined,
    // "AUTO ENTRY" is on hundreds of dies; a location or size finds this one.
    href: r.serial_no && r.serial_no !== 'PENDING' && !isPlaceholderPm(r.serial_no) ? `/admin/dies?q=${q(r.serial_no)}`
      : r.location ? `/admin/dies?field=location&q=${q(r.location)}` : `/admin/dies?field=size&q=${q(r.length ?? '')}`,
  };
}

export type ShadeRow = { id: string; shade_card_number: string | null; product_name: string; party: string; status: string };
export function shadeItem(r: ShadeRow): RelatedItem {
  return {
    id: r.id,
    title: r.shade_card_number ? `Shade card ${r.shade_card_number}` : r.product_name,
    detail: line(r.shade_card_number && r.product_name, r.party),
    tag: r.status === 'Approved' ? undefined : r.status,
    href: `/admin/shade-cards/${r.id}`,
  };
}
