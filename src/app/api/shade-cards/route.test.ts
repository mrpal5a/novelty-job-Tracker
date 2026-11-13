// GET /api/shade-cards — the search box on the busiest list in the app.
// Party and product names carry commas, brackets and % signs, and people
// type them as written.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, queries } from '@/test/api';
import { GET } from './route';
import { orContains } from '@/lib/search';
import { SHADE_CARD_SEARCH_COLUMNS } from '@/lib/constants/shadeCards';

const search = (qs: Record<string, string>) =>
  GET(json(`/api/shade-cards?${new URLSearchParams(qs)}`, 'GET'));

const filters = () => queries('shade_cards')[0].filters;

describe('GET /api/shade-cards', () => {
  it('401 signed out', async () => {
    expect((await search({})).status).toBe(401);
  });

  it('answers a page with its total', async () => {
    signIn('QC');
    respond(() => ({ data: [{ id: 'c1' }], count: 41 }));
    expect(await (await search({ page: '2' })).json()).toEqual({ cards: [{ id: 'c1' }], total: 41, page: 2, pageSize: 25 });
    expect(filters()).toContainEqual(['range', 25, 49]);
    expect(filters()).toContainEqual(['eq', 'is_current', true]);
  });

  // Approve the only card on the last page of "Pending Approval" and the list
  // reloads a page that no longer exists.
  it('a page past the end is an empty page with the real total, not an error', async () => {
    signIn('QC');
    respond((c) => (c.filters.some(([f, from]) => f === 'range' && from === 50)
      ? { error: { code: 'PGRST103', message: 'Requested range not satisfiable' } }
      : { data: [{ id: 'c1' }], count: 50 }));
    const res = await search({ page: '3' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ cards: [], total: 50, page: 3, pageSize: 25 });
  });

  it('"all fields" keeps commas and brackets in the search as typed', async () => {
    signIn('QC');
    await search({ search: 'Labels (Pvt), Ltd' });
    expect(filters()).toContainEqual(['or', orContains(SHADE_CARD_SEARCH_COLUMNS, 'Labels (Pvt), Ltd')]);
  });

  it('a single field keeps them too', async () => {
    signIn('QC');
    await search({ search: 'Glypho (500 ml), 41% SL', field: 'product_name' });
    expect(filters()).toContainEqual(['ilike', 'product_name', '%Glypho (500 ml), 41\\% SL%']);
  });

  it('% and _ are text, not wildcards', async () => {
    signIn('QC');
    await search({ search: 'PM_1%', field: 'pm_code' });
    expect(filters()).toContainEqual(['ilike', 'pm_code', '%PM\\_1\\%%']);
  });

  it('an unknown field or status is ignored, not passed to the database', async () => {
    signIn('QC');
    await search({ search: 'x', field: 'created_by; drop', status: 'Nonsense', sort: 'password' });
    expect(filters().some(([f, col]) => f === 'ilike' || (f === 'eq' && col === 'status'))).toBe(false);
    expect(filters()).toContainEqual(['order', 'updated_at', { ascending: false, nullsFirst: false }]);
  });
});
