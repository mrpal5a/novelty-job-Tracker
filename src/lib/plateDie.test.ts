import { describe, it, expect } from 'vitest';
import { dieUpsFor, commonValues, flatbedDiesFor } from './plateDie';
import type { Die, FlatbedDie } from '@/lib/types';

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
