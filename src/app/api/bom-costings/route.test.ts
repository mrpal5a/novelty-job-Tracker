// GET /api/bom-costings — the Bill of Material list is the Job Separation
// rows through a costing lens, so its search has to find the same rows.

import { describe, it, expect } from 'vitest';
import { signIn, json, queries } from '@/test/api';
import { GET } from './route';
import { orContains, termFilter } from '@/lib/search';

const search = (q: string) => GET(json(`/api/bom-costings?${new URLSearchParams({ search: q })}`, 'GET'));

describe('GET /api/bom-costings', () => {
  it('401 signed out, 403 without Bill of Material access', async () => {
    expect((await search('x')).status).toBe(401);
    signIn('Dispatch');
    expect((await search('x')).status).toBe(403);
  });

  it('searches like Job Separation: the phrase first, then each word', async () => {
    signIn('Admin');
    // No line holds the phrase (nothing is answered), so it goes word by word.
    const res = await search('Glypho (500 ml), 41% SL');
    expect(res.status).toBe(200);
    const [list, probe] = queries('job_separations');
    expect(probe.filters).toContainEqual(['or', termFilter('glypho500ml41sl')]);
    for (const w of ['glypho', '500', 'ml', '41', 'sl']) {
      expect(list.filters).toContainEqual(['or', termFilter(w)]);
    }
  });

  it('only punctuation typed: matched as typed, quoted so it cannot break the filter', async () => {
    signIn('Admin');
    await search('%');
    expect(queries('job_separations')[0].filters).toContainEqual(
      ['or', orContains(['sr_no', 'party', 'po_no', 'pm_code', 'material_name'], '%')],
    );
  });

  it('never lists a cancelled line', async () => {
    signIn('Admin');
    await search('x');
    expect(queries('job_separations')[0].filters).toContainEqual(['is', 'cancelled_at', null]);
  });
});
