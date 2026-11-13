// Date helpers that run on the server. Vercel's clock is UTC and the plant's
// is IST, so these tests run in UTC (vitest.config.ts) and pin the hours
// where the two disagree: midnight to 5:30 AM in India.

import { afterEach, describe, it, expect, vi } from 'vitest';
import { toMonthKey, getDeliveryCountdown, formatAdminDate, formatQty, getMissingPrerequisite } from './utils';

afterEach(() => { vi.useRealTimers(); });

/** Freeze the clock at an instant, leaving timers and promises alone. */
function at(iso: string) {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
}

describe('the tests themselves', () => {
  it('run in UTC, like the server', () => {
    expect(new Date().getTimezoneOffset()).toBe(0);
  });
});

describe('toMonthKey', () => {
  it('is the IST month: 1:30 AM on 1 Dec in India is December, not November', () => {
    expect(toMonthKey(new Date('2026-11-30T20:00:00Z'))).toBe('2026-12');
  });

  it('mid-month is unaffected', () => {
    expect(toMonthKey(new Date('2026-06-15T10:00:00Z'))).toBe('2026-06');
  });
});

describe('getDeliveryCountdown', () => {
  it('no date', () => {
    expect(getDeliveryCountdown(null).color).toBe('muted');
  });

  it('due today, in the small hours in India', () => {
    at('2026-11-12T20:00:00Z');   // 13 Nov, 1:30 AM IST
    expect(getDeliveryCountdown('2026-11-13').label).toBe('Delivery due today');
  });

  it('overdue from the first minute of the next IST day', () => {
    at('2026-11-13T18:31:00Z');   // 14 Nov, 12:01 AM IST
    expect(getDeliveryCountdown('2026-11-13')).toEqual({ label: 'Overdue by 1 day', color: 'red' });
  });

  it('counts down in whole days', () => {
    at('2026-11-10T06:00:00Z');
    expect(getDeliveryCountdown('2026-11-11').label).toBe('Due tomorrow');
    expect(getDeliveryCountdown('2026-11-12').label).toBe('Due in 2 days');
    expect(getDeliveryCountdown('2026-11-20')).toEqual({ label: 'Delivery in 10 days', color: 'green' });
    expect(getDeliveryCountdown('2026-11-07').label).toBe('Overdue by 3 days');
  });
});

describe('display formatters', () => {
  it('print IST wall-clock time whatever the server zone', () => {
    expect(formatAdminDate('2026-06-09T09:15:00Z')).toBe('09-06-2026, 02:45 PM');
  });

  it('Indian digit grouping', () => {
    expect(formatQty(500000)).toBe('5,00,000');
    expect(formatQty(null)).toBe('—');
    expect(formatQty(0)).toBe('0');
  });
});

describe('getMissingPrerequisite', () => {
  it('names the stage that has to come first', () => {
    expect(getMissingPrerequisite('Packing', ['Slitting'], 'New')).toBe('Quality Check');
    expect(getMissingPrerequisite('Packing', ['Quality Check'], 'New')).toBeNull();
    expect(getMissingPrerequisite('In Printing', ['Job Card Done'], 'Repeat')).toBeNull();
    expect(getMissingPrerequisite('In Printing', ['Job Card Done'], 'New')).toBe('Shade Card Approved');
  });
});
