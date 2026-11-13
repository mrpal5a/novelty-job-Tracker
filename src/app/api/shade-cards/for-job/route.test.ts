// GET /api/shade-cards/for-job — the shade card shown beside a job. It must
// be the card for that exact PM code or product: showing a near neighbour's
// approval status is worse than showing nothing.

import { describe, it, expect } from 'vitest';
import { signIn, respond, json, queries } from '@/test/api';
import { GET } from './route';

const find = (qs: Record<string, string>) => GET(json(`/api/shade-cards/for-job?${new URLSearchParams(qs)}`, 'GET'));
const CARD = { id: 'c1', pm_code: 'PM_100' };

describe('GET /api/shade-cards/for-job', () => {
  it('401 signed out', async () => {
    expect((await find({ pm_code: 'PM-1' })).status).toBe(401);
  });

  it('matches the PM code first, live versions only', async () => {
    signIn('QC'); respond(() => ({ data: [CARD] }));
    expect(await (await find({ pm_code: ' pm-1 ', party: 'Acme', product: 'Label' })).json()).toEqual({ cards: [CARD], basis: 'pm_code' });
    expect(queries('shade_cards')).toHaveLength(1);
    expect(queries('shade_cards')[0].filters).toContainEqual(['eq', 'is_current', true]);
    expect(queries('shade_cards')[0].filters).toContainEqual(['ilike', 'pm_code', 'pm-1']);
  });

  it('falls back to party + product when the PM code finds nothing', async () => {
    signIn('QC');
    respond((c) => ({ data: c.filters.some(([f, col]) => f === 'ilike' && col === 'party') ? [CARD] : [] }));
    expect((await (await find({ pm_code: 'PM-1', party: 'Acme', product: 'Label' })).json()).basis).toBe('party_product');
  });

  it('_ and % in a PM code or product name are text, not wildcards', async () => {
    signIn('QC');   // nothing matches, so both lookups run
    expect(await (await find({ pm_code: 'PM_100', party: 'A_B', product: 'Glypho 41% SL_01' })).json()).toEqual({ cards: [], basis: 'none' });
    const [byCode, byName] = queries('shade_cards');
    expect(byCode.filters).toContainEqual(['ilike', 'pm_code', 'PM\\_100']);
    expect(byName.filters).toContainEqual(['ilike', 'party', 'A\\_B']);
    expect(byName.filters).toContainEqual(['ilike', 'product_name', 'Glypho 41\\% SL\\_01']);
  });

  it('nothing to go on', async () => {
    signIn('QC');
    expect(await (await find({ party: 'Acme' })).json()).toEqual({ cards: [], basis: 'none' });
    expect(queries('shade_cards')).toHaveLength(0);
  });
});
