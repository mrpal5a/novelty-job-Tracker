import { describe, it, expect } from 'vitest';
import { dieItem, jobCardItem, orderItem, plateItem, pmKeys, shadeItem } from './related';

describe('related records', () => {
  it('joins on real PM codes only, once each', () => {
    expect(pmKeys(['2000000081', ' 2000000081 ', 'ps5739', 'PS5739', 'N/A', 'nil', '-', '', null].map((pm_code) => ({ pm_code }))))
      .toEqual(['2000000081', 'ps5739']);
  });

  it('links each record to where it opens', () => {
    const plate = { id: 'p', party: 'UPL', pm_code: 'X1', item_name: 'CENTURION', plate_id: '26AG06159 (16-03-2026)\nCGG-1', die_id: null, across_size: '132', around_size: '70', cylinder: 88, location: '3008' };
    expect(plateItem(plate).href).toBe('/admin/plates?q=26AG06159%20(16-03-2026)');
    expect(plateItem({ ...plate, plate_id: null }).href).toBe('/admin/plates?q=X1');
    const die = { id: 'd', serial_no: 'BNK25', job_name: 'AUTO ENTRY', location: '93', ups: 3, status: 'IN USE', length: '70', width: '132', cylinder: 88 };
    expect(dieItem(die).href).toBe('/admin/dies?q=BNK25');
    // "AUTO ENTRY" and "PENDING" are on many dies: never searched for.
    expect(dieItem({ ...die, serial_no: 'PENDING' }).href).toBe('/admin/dies?field=location&q=93');
    expect(dieItem({ ...die, serial_no: null, location: null }).href).toBe('/admin/dies?field=size&q=70');
    expect(dieItem({ ...die, status: 'DAMAGE' }, true).tag).toBe('Damaged');
    expect(shadeItem({ id: 's', shade_card_number: '2592', product_name: 'C', party: 'UPL', status: 'Pending Approval' }))
      .toMatchObject({ title: 'Shade card 2592', tag: 'Pending Approval', href: '/admin/shade-cards/s' });
    expect(orderItem({ id: 'l', sr_no: 'NOV26-55', party: 'UPL 03', po_no: '5', pm_code: null, material_name: null, quantity: 631010, jc_status: null, cancelled_at: 'x' }))
      .toMatchObject({ title: 'NOV26-55 · UPL 03', detail: 'PO 5 · 6,31,010 labels', tag: 'Cancelled' });
    expect(jobCardItem({ id: 'c', card_number: null, party: 'UPL', job_name: null, part: 1, part_name: null, issued_at: null, job_separations: { sr_no: 'NOV26-55' } }))
      .toMatchObject({ title: 'NOV26-55', tag: 'Draft', href: '/admin/job-cards/c' });
  });
});
