// GET /api/bom-costings — the Bill of Material list is the Job Separation
// rows through a costing lens, so its search has to find the same rows.

import { describe, it, expect } from 'vitest';
import { signIn, json, queries } from '@/test/api';
import { GET } from './route';
import { orContains } from '@/lib/search';

const search = (q: string) => GET(json(`/api/bom-costings?${new URLSearchParams({ search: q })}`, 'GET'));

describe('GET /api/bom-costings', () => {
  it('401 signed out, 403 without Bill of Material access', async () => {
    expect((await search('x')).status).toBe(401);
    signIn('Dispatch');
    expect((await search('x')).status).toBe(403);
  });

  it('keeps commas, brackets and % in the search as typed', async () => {
    signIn('Admin');
    const res = await search('Glypho (500 ml), 41% SL');
    expect(res.status).toBe(200);
    expect(queries('job_separations')[0].filters).toContainEqual(
      ['or', orContains(['sr_no', 'party', 'po_no', 'pm_code', 'material_name'], 'Glypho (500 ml), 41% SL')],
    );
  });

  it('never lists a cancelled line', async () => {
    signIn('Admin');
    await search('x');
    expect(queries('job_separations')[0].filters).toContainEqual(['is', 'cancelled_at', null]);
  });
});
