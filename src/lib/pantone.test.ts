import { describe, it, expect } from 'vitest';
import { inkColor } from './pantone';

const bg = (name: string | null) => inkColor(name)?.background ?? null;

describe('ink box colours', () => {
  it('finds a Pantone however it is written', () => {
    for (const name of ['355', '355C', '355 C', ' 355 c ', 'PANTONE 355 C', 'Pantone 355', 'PMS 355', 'PMS355C', 'P 355 C', 'P-355', 'P355', '355 U', '355 CVC']) {
      expect([name, bg(name)]).toEqual([name, '#009639']);
    }
    expect([bg('7477'), bg('7650 C')]).toEqual(['#244c5a', '#722257']);
  });
  it('knows the basic inks by number or name', () => {
    expect(['032', '032 C', 'RED 032', 'RED 032 C', 'RED032'].map(bg)).toEqual(Array(5).fill('#ef3340'));
    expect([bg('021'), bg('ORANGE 021'), bg('072'), bg('REFLEX BLUE'), bg('REFLEX BLUE C')]).toEqual(['#fe5000', '#fe5000', bg('BLUE 072'), '#001489', '#001489']);
    expect(bg('COOL GREY 8 C')).toBe(bg('COOL GRAY 8'));
    expect(bg('WARM RED')).not.toBeNull();
    expect(bg('PURPLE')).not.toBeNull();
    expect(bg('877 C')).not.toBeNull();
  });
  it('covers the spot colours on the plates', () => {
    const used = '032 347 2945 109 3272 REFLEX_BLUE 021 151 299 293 277 185 7650 305 300 382 199 376 286 281 355 7453 7477 254'.split(' ').map((n) => n.replace('_', ' '));
    expect(used.filter((n) => !bg(n))).toEqual([]);
  });
  it('keeps process inks, and leaves what is not a known colour white', () => {
    expect([bg('CYAN'), bg('magenta'), bg('YELLOW'), bg('BLACK')]).toEqual(['#00A3DA', '#C63A8A', '#FFF04D', '#1F2020']);
    for (const name of ['', null, 'WHITE', 'NVZ-GL', 'FULL-GL', 'GLOSS', 'RELEASE', 'TEXTURE', 'FOIL', 'EMBOSSED', 'PRIMER', 'LAMINATION', '8 C', '2291', '99999', 'C', 'P', '355 50%', '355+185']) {
      expect([name, bg(name)]).toEqual([name, null]);
    }
  });
  it('writes in black or white, whichever reads', () => {
    expect(inkColor('CYAN')?.text).toBe('#FFFFFF'); // as on the shop's card
    expect([inkColor('YELLOW')?.text, inkColor('REFLEX BLUE')?.text, inkColor('277')?.text, inkColor('281')?.text]).toEqual(['#000000', '#FFFFFF', '#000000', '#FFFFFF']);
  });
});
