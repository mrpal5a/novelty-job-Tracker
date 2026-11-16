import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/branding', () => ({
  getBranding: async () => ({ name: 'Acme <Labels>', shortName: 'A&L', address: '1 "Main" St' }),
}));

import { getConsolidatedEmailHTML, getEmailHTML } from './dispatchEmailTemplate';

const evil = '<img src=x onerror=alert(1)>';

describe('dispatch email HTML escaping', () => {
  it('escapes job, party and branding text in the consolidated email', async () => {
    const html = await getConsolidatedEmailHTML({
      party: evil, contactName: evil, audience: 'team',
      items: [{ job_name: evil, po_number: evil, pm_code: evil, remark: evil, status: 'Dispatched', qty: 5 }],
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Acme &lt;Labels&gt;');
  });

  it('escapes the single-job client email', async () => {
    const html = await getEmailHTML({
      job_name: evil, po_number: evil, party: evil, companyName: evil,
      status: 'On Hold', remark: evil, qty: null,
    });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('1 &quot;Main&quot; St');
  });
});
