import { describe, it, expect } from 'vitest';
import { dieUpsFor, commonValues, flatbedDiesFor, layoutFrom, widthGapMm, labelsPerRound, metresFromPlates, colorBoxes, colorsFrom } from './plateDie';
import type { Die, FlatbedDie, Plate } from '@/lib/types';

const die = (length: string, width: string, cylinder: number, ups: number | null, status = 'IN USE') =>
  ({ id: `${length}x${width}-${cylinder}-${ups}-${status}`, length, width, cylinder, ups, status }) as unknown as Die;

describe('label per round from the die', () => {
  const dies = [
    die('165', '48', 110, 8),
    die('48.6', '165', 110, 8, 'DAMAGE'),  // other way round, decimal: same die size
    die('165', '48', 115, 6),              // other cylinder
    die('1650', '48', 110, 2),             // not 165
  ];

  it('matches on cylinder and whole-mm size either way round', () => {
    const r = dieUpsFor(dies, '48', '165', '110');
    expect(r.ups).toBe(8);
    expect(r.dies).toHaveLength(2);
    expect(r.dies[0].status).toBe('IN USE'); // in-use die named first
  });

  it('puts the plate’s material first, however it is spaced, and drops no die', () => {
    const m = (id: string, material: string | null, status = 'IN USE') =>
      ({ id, length: '165', width: '48', cylinder: 110, ups: 8, status, material }) as unknown as Die;
    const all = [m('none', null), m('lam', '80GSM CHROMO + LAMINATION'), m('damaged', '80GSM CHROMO', 'DAMAGE'), m('same', '80GSM CHROMO')];
    const ids = (material: string) => dieUpsFor(all, '165', '48', '110', material).dies.map((d) => d.id);
    expect(ids(' 80 gsm chromo')).toEqual(['same', 'none', 'lam', 'damaged']);
    expect(ids('')).toEqual(['none', 'lam', 'same', 'damaged']); // as listed, damaged last
    expect(ids('PP WHITE')).toEqual(['none', 'lam', 'same', 'damaged']);
  });

  it('leaves it blank when dies disagree or none match', () => {
    expect(dieUpsFor([...dies, die('165', '48', 110, 4)], '165', '48', '110')).toMatchObject({ ups: null, options: [8, 4] });
    expect(dieUpsFor(dies, '165', '48', '97').dies).toHaveLength(0);
    expect(dieUpsFor(dies, '', '48', '110').dies).toHaveLength(0);
  });
});

describe('die pick-lists', () => {
  it('offers repeated spellings, most common first, never one-offs', () => {
    const d = (corner: string | null) => ({ corner }) as unknown as Die;
    const dies = [d('SPECIAL'), d('SQUARE'), d('SQUARE '), d('SQUARE'), d('SPECIAL'), d('SQAURE'), d(null), d('')];
    expect(commonValues(dies, 'corner')).toEqual(['SQUARE', 'SPECIAL']);
  });
});

describe('flatbed dies for a plate', () => {
  it('match on whole-mm size either way round, no cylinder', () => {
    const fb = (id: string, length: string, width: string) => ({ id, length, width }) as unknown as FlatbedDie;
    const dies = [fb('a', '60', '146'), fb('b', '146.4', '60'), fb('c', '60', '1460'), fb('d', '61', '146')];
    expect(flatbedDiesFor(dies, '60', '146').map((d) => d.id)).toEqual(['a', 'b']);
    expect(flatbedDiesFor(dies, '', '146')).toEqual([]);
  });
});

describe('layout fields from a request body', () => {
  it('reads only the keys sent: whole ups, decimal gaps, blank as null', () => {
    expect(layoutFrom({ around_ups: '4.7', around_gap: '3.5', across_ups: '', other: 1 }))
      .toEqual({ around_ups: 4, around_gap: 3.5, across_ups: null });
    expect(layoutFrom({ across_gap: 'abc' })).toEqual({ across_gap: null });
    expect(layoutFrom({})).toEqual({});
  });
});

describe('width gap from the cylinder', () => {
  it('is cylinder × 3.175 ÷ width ups − width size, to two decimals', () => {
    expect(widthGapMm('95', '2', '146')).toBe(4.81);    // 301.625 / 2 − 146
    expect(widthGapMm('70', '1', '210.84')).toBe(11.41); // 222.25 − 210.84
  });
  it('waits for all three numbers and refuses labels that overflow the repeat', () => {
    expect(widthGapMm('', '2', '146')).toBeNull();
    expect(widthGapMm('95', '0', '146')).toBeNull();
    expect(widthGapMm('95', '3', '146')).toBeNull();    // 100.5 − 146 < 0
  });
});

describe('label per round from the layout', () => {
  it('is height ups × width ups, once both are whole numbers', () => {
    expect(labelsPerRound('3', '4')).toBe(12);
    expect(labelsPerRound('', '4')).toBeNull();
    expect(labelsPerRound('0', '4')).toBeNull();
    expect(labelsPerRound('2.5', '4')).toBeNull();
  });
});

describe('metres for a Job Separation line, from its plates', () => {
  const plate = (pm_code: string | null, cylinder: number | null, label_per_round: number | null) =>
    ({ id: `${pm_code}-${cylinder}-${label_per_round}-${Math.random()}`, pm_code, cylinder, label_per_round }) as unknown as Plate;

  it('is the meter calculator sum with the plate label per round as ups, rounded up', () => {
    const r = metresFromPlates([plate('025050100666', 95, 4), plate('OTHER', 110, 2)], ' 025050100666 ', 10000);
    expect(r.found).toBe(1);
    expect(r.options).toHaveLength(1);
    expect(r.options[0]).toMatchObject({ cylinder: 95, ups: 4, metres: 755 }); // 754.06 → 755
  });
  it('matches the whole code only, any case, and groups plates that agree', () => {
    const r = metresFromPlates([plate('pm-45', 95, 4), plate('PM-45', 95, 4), plate('PM-450', 80, 1)], 'PM-45', 1000);
    expect(r.found).toBe(2);
    expect(r.options).toHaveLength(1);
    expect(r.options[0].plates).toHaveLength(2);
  });
  it('lists every cylinder/ups pair when the plates disagree, most plates first', () => {
    const r = metresFromPlates([plate('001', 80, 2), plate('001', 95, 4), plate('001', 95, 4)], '001', 1000);
    expect(r.options.map((o) => `${o.cylinder}/${o.ups}`)).toEqual(['95/4', '80/2']);
  });
  it('counts a plate missing its cylinder or label per round as found, but gives no metres', () => {
    expect(metresFromPlates([plate('X1', null, 4), plate('X1', 95, null)], 'X1', 1000)).toEqual({ found: 2, options: [] });
    expect(metresFromPlates([plate('X1', 95, 4)], '', 1000)).toEqual({ found: 0, options: [] });
    expect(metresFromPlates([plate('N/A', 95, 4)], 'n/a', 1000)).toEqual({ found: 0, options: [] });
  });
});

describe('plate colours', () => {
  it('starts a new list as CYAN, MAGENTA, YELLOW, BLACK, the rest blank, 12 boxes', () => {
    const boxes = colorBoxes(null);
    expect(boxes).toHaveLength(12);
    expect(boxes.slice(0, 5)).toEqual(['CYAN', 'MAGENTA', 'YELLOW', 'BLACK', '']);
  });
  it('keeps a saved list as saved, blanks included, without adding defaults', () => {
    expect(colorBoxes(['WHITE', null, 'PANTONE 485']).slice(0, 4)).toEqual(['WHITE', '', 'PANTONE 485', '']);
  });
  it('stores trimmed names, blanks as null, at most 12; anything else is null', () => {
    expect(colorsFrom([' CYAN ', '', 'RED', 7])).toEqual(['CYAN', null, 'RED', null]);
    expect(colorsFrom(Array(20).fill('X'))).toHaveLength(12);
    expect(colorsFrom([])).toBeNull();
    expect(colorsFrom('CYAN')).toBeNull();
  });
});
