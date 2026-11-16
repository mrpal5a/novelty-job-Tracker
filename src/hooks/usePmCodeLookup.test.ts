import { describe, it, expect } from 'vitest';
import { pickNewestExact, fillIfUntouched } from './usePmCodeLookup';
import type { JobSeparation } from '@/lib/types';

const row = (id: string, pm_code: string, cancelled_at: string | null = null) =>
  ({ id, pm_code, cancelled_at }) as unknown as JobSeparation;

describe('PM code fill', () => {
  it('takes the newest exact code, skipping cancelled lines and longer codes', () => {
    const rows = [row('a', 'PM-450'), row('b', 'pm-45', '2026-11-01'), row('c', 'PM-45 '), row('d', 'PM-45')];
    expect(pickNewestExact(rows, 'PM-45')?.id).toBe('c');
    expect(pickNewestExact([row('b', 'PM-45', '2026-11-01')], 'pm-45')?.id).toBe('b');
    expect(pickNewestExact([row('a', 'PM-450')], 'PM-45')).toBeUndefined();
  });

  it('never overwrites something typed by hand', () => {
    expect(fillIfUntouched('', '', 'ACME')).toBe('ACME');
    expect(fillIfUntouched('ACME', 'ACME', 'BETA')).toBe('BETA');   // still the last fill
    expect(fillIfUntouched('Typed', 'ACME', 'BETA')).toBe('Typed'); // hand-typed stays
  });
});
