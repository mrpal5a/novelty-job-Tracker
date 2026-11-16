import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({}) }));

import {
  LIST_WARMUP, jobSeparationListQuery, plateListQuery, plateListParams,
  dieListQuery, shadeCardListQuery, shadeCardListParams,
} from './listQueries';
import { buildNavGroups } from './adminNav';
import type { DeptPermissions } from '@/lib/constants/departments';

const admin: DeptPermissions = {
  key: 'admin', displayName: 'Admin', clientFacingName: 'Admin',
  isSuperAdmin: true, isReadOnly: false, allStages: true, printingMethodScope: null,
  features: [], stages: [], runStages: [],
};

describe('list warm-up from the menu', () => {
  it('every warmed href is a real menu link', () => {
    const hrefs = new Set(buildNavGroups(admin).flatMap((g) => g.items.map((i) => i.href)));
    for (const href of Object.keys(LIST_WARMUP)) expect(hrefs.has(href), href).toBe(true);
  });

  // The warm-up only helps if it fills the exact cache entry the page opens
  // on. These are each page's opening state; change one, change the other.
  it('default keys are the pages’ opening state', () => {
    expect(jobSeparationListQuery().queryKey).toEqual(['job-separations', '', 'all', 'month', 100]);
    expect(plateListQuery().queryKey).toEqual(['plates', '', 'all', 'created_at', 'desc', 100]);
    expect(dieListQuery().queryKey).toEqual(['dies', '', 'all', 0]);
    expect(shadeCardListQuery().queryKey).toEqual(['shade-cards', '', 'all', 'all', null, 1, 'shade_card_number', 'asc']);
  });
});

describe('list request parameters', () => {
  it('plates: field only with a search, and never "all"', () => {
    expect(plateListParams().toString()).toBe('sort=created_at&dir=desc');
    expect(plateListParams({ field: 'party' }).has('field')).toBe(false);
    expect(plateListParams({ search: 'acme', field: 'all' }).has('field')).toBe(false);
    expect(plateListParams({ search: 'acme', field: 'party' }).get('field')).toBe('party');
  });

  it('shade cards: the 7-day cutoff is sent only when given', () => {
    expect(shadeCardListParams().has('created_from')).toBe(false);
    expect(shadeCardListParams({ createdFrom: '2026-11-09T00:00:00.000Z' }).get('created_from')).toBe('2026-11-09T00:00:00.000Z');
    expect(shadeCardListParams({ search: 'x', field: 'party', status: 'Approved' }).toString())
      .toBe('search=x&field=party&status=Approved&sort=shade_card_number&dir=asc');
  });
});
