import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ACTIVITY_TABLES, changedFields, describeAction, fieldLabel, formatValue, tablesInSection } from './activityLog';

const migration = readFileSync('supabase/migrations/089_activity_log.sql', 'utf8');
const watched = Array.from(migration.matchAll(/^\s*\['([a-z_]+)',/gm), (m) => m[1]);

describe('what gets recorded', () => {
  it('names every table the trigger watches, and no others', () => {
    expect(watched.length).toBeGreaterThan(0);
    expect([...ACTIVITY_TABLES].sort()).toEqual([...watched].sort());
  });

  it('never records team chat', () => {
    for (const t of ['messages', 'conversations', 'conversation_participants', 'note_reads']) {
      expect(watched).not.toContain(t);
      expect(ACTIVITY_TABLES).not.toContain(t);
    }
  });
});

describe('reading an entry', () => {
  it('says what happened to what', () => {
    expect(describeAction({ action: 'changed', table_name: 'dies' })).toBe('Changed die');
    expect(describeAction({ action: 'added', table_name: 'job_separations' })).toBe('Added order line');
  });

  it('turns column names into words', () => {
    expect(fieldLabel('damage_reason')).toBe('Damage reason');
    expect(fieldLabel('po_no')).toBe('PO No');
  });

  it('formats values the way the rest of the admin does', () => {
    expect(formatValue(null)).toBe('blank');
    expect(formatValue('')).toBe('blank');
    expect(formatValue(true)).toBe('Yes');
    expect(formatValue(0)).toBe('0');
    expect(formatValue('2026-11-05')).toBe('05-11-2026');
    expect(formatValue('2026-11-05T09:15:00+00:00')).toBe('05-11-2026, 02:45 PM');
  });

  it('leaves out fields that are only row ids, but keeps a real change to blank', () => {
    const id = '6f2f6cb0-0000-4000-8000-000000000000';
    expect(changedFields({
      line_id:   [null, id],
      status:    ['IN USE', 'DAMAGE'],
      location:  ['Rack 4', null],
    })).toEqual([
      { field: 'Location', from: 'Rack 4', to: 'blank' },
      { field: 'Status',   from: 'IN USE', to: 'DAMAGE' },
    ]);
  });

  it('rejects a section that does not exist', () => {
    expect(tablesInSection('shade')).toEqual(['shade_cards']);
    expect(tablesInSection('messages')).toBeNull();
  });
});
