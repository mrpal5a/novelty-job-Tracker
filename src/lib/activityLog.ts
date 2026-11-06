// src/lib/activityLog.ts
// ============================================================
// How the Activity Log reads: which sections exist, what each recorded table
// is called, and how a raw change becomes words. The recording itself is the
// database trigger in migration 089.
// ============================================================

import { formatAdminDate, formatNumericDate } from '@/lib/utils';

export const ACTIVITY_PAGE_SIZE = 50;

export type ActivityAction = 'added' | 'changed' | 'deleted';

export type ActivityEntry = {
  id:         number;
  changed_at: string;
  actor_id:   string | null;
  actor_name: string | null;
  actor_dept: string | null;
  table_name: string;
  action:     ActivityAction;
  label:      string | null;
  changes:    Record<string, [unknown, unknown]>;
};

// Every table the trigger watches, grouped the way the header groups the app.
export const ACTIVITY_SECTIONS: { key: string; label: string; tables: Record<string, string> }[] = [
  { key: 'separation', label: 'Job Separation', tables: { job_separations: 'order line' } },
  { key: 'jobs', label: 'Jobs', tables: {
    jobs: 'job', print_runs: 'print run', stage_comments: 'job note', job_status_requests: 'status request',
  } },
  { key: 'production', label: 'Production', tables: {
    machines: 'machine', machine_queue_items: 'machine queue item', printing_units: 'printing unit',
    plates: 'plate', dies: 'die', flatbed_dies: 'flatbed die', cylinders: 'cylinder',
  } },
  { key: 'shade', label: 'Shade Cards', tables: { shade_cards: 'shade card' } },
  { key: 'stock', label: 'Stock', tables: {
    label_stock: 'label stock', paper_rolls: 'paper roll', paper_stock_movements: 'paper stock movement',
  } },
  { key: 'dispatch', label: 'Dispatch', tables: {
    pending_dispatch_notifications: 'dispatch entry', dispatch_schedules: 'dispatch schedule',
    party_contacts: 'party contact', parties: 'party', internal_notification_recipients: 'email recipient',
  } },
  { key: 'bom', label: 'BOM', tables: {
    bom_materials: 'material', bom_costings: 'costing', bom_material_requests: 'material request', bom_material_orders: 'material order',
  } },
  { key: 'followups', label: 'Follow-ups', tables: {
    register_accounts: 'account', register_deals: 'deal', register_activities: 'follow-up',
  } },
  { key: 'prepress', label: 'Prepress', tables: { prepress_todos: 'prepress task' } },
  { key: 'setup', label: 'Setup', tables: {
    departments: 'department', department_feature_permissions: 'department permission',
    department_stage_permissions: 'department stage permission',
    department_run_stage_permissions: 'department run permission', company_settings: 'company settings',
  } },
];

const RECORD_NAMES: Record<string, string> = Object.assign({}, ...ACTIVITY_SECTIONS.map((s) => s.tables));

export const ACTIVITY_TABLES = Object.keys(RECORD_NAMES);

/** The tables behind a section filter, or null for an unknown section. */
export function tablesInSection(key: string): string[] | null {
  const section = ACTIVITY_SECTIONS.find((s) => s.key === key);
  return section ? Object.keys(section.tables) : null;
}

/** "Changed die", "Added order line". */
export function describeAction(entry: Pick<ActivityEntry, 'action' | 'table_name'>): string {
  const verb = { added: 'Added', changed: 'Changed', deleted: 'Deleted' }[entry.action];
  return `${verb} ${RECORD_NAMES[entry.table_name] ?? entry.table_name}`;
}

const WORDS: Record<string, string> = { po: 'PO', pm: 'PM', qc: 'QC', jc: 'JC', aw: 'Artwork', sr: 'Sr', no: 'No', id: 'ID', mm: '(mm)' };

/** "damage_reason" → "Damage reason", "po_no" → "PO No". */
export function fieldLabel(column: string): string {
  const text = column.split('_').map((w) => WORDS[w] ?? w).join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'blank';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string') {
    if (TIMESTAMP.test(value)) return formatAdminDate(value);
    if (DATE.test(value)) return formatNumericDate(value);
    return value;
  }
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export type ChangedField = { field: string; from: string; to: string };

/** The changes worth reading. A raw row id means nothing to a person, so a
 *  field whose values are only ids is left out. */
export function changedFields(changes: ActivityEntry['changes']): ChangedField[] {
  const isIdOrEmpty = (v: unknown) => v === null || (typeof v === 'string' && UUID.test(v));
  return Object.entries(changes)
    .filter(([, [from, to]]) => !(isIdOrEmpty(from) && isIdOrEmpty(to)))
    .map(([column, [from, to]]) => ({ field: fieldLabel(column), from: formatValue(from), to: formatValue(to) }))
    .sort((a, b) => a.field.localeCompare(b.field));
}
