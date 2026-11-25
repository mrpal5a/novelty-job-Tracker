// src/lib/pantone.ts
// The colour a job card's ink box is filled with: process inks, and Pantone
// codes as the team writes them (355, 355C, 032, REFLEX BLUE, PANTONE 7477 C).
// The Pantone values are the unofficial screen approximations of the
// `pantoner` package (Solid Coated; not copied here, the repos are public):
// for recognising a colour, never for matching one. Imported by the job card
// only: the list is about 20 KB on the wire.

import coated from 'pantoner/json/pantone-coated.json';
import metallic from 'pantoner/json/pantone-metallic.json';

export type InkColor = { background: string; text: '#000000' | '#FFFFFF' };

const PROCESS: Record<string, string> = { CYAN: '#00A3DA', MAGENTA: '#C63A8A', YELLOW: '#FFF04D', BLACK: '#1F2020' };
// Pantone's basic inks, written by their number alone.
const BASIC: Record<string, string> = { '032': 'red-032', '021': 'orange-021', '072': 'blue-072', '012': 'yellow-012' };

const LIST = new Map<string, string>();
for (const { pantone, hex } of [...metallic, ...coated] as { pantone: string; hex: string }[]) LIST.set(pantone.replace(/-c$/, ''), hex);

/** "PANTONE 355 C", "PMS355c", "P-355" → "355"; "Cool Grey 8C" → "cool-gray-8". */
function key(name: string): string {
  const k = name.trim().toLowerCase()
    .replace(/^(pantone|pms|p)[\s.-]*(?=\d|[a-z]{3})/, (m, word: string, at: number, all: string) =>
      (word === 'p' && !/^p[\s.-]*\d/.test(all) ? m : '')) // "p 355", never the p of "purple"
    .replace(/(?<=\d|[\s-])(cvc|cv|c|u)$/, '').trim()
    .replace(/\bgrey\b/, 'gray').replace(/[\s_-]+/g, '-').replace(/-$/, '');
  return BASIC[k] ?? k.replace(/^(red|orange|blue|yellow)(\d{3})$/, '$1-$2');
}

/** Null: not a colour that's known (a varnish, WHITE, a newer Pantone), so the box stays white. */
export function inkColor(name: string | null | undefined): InkColor | null {
  const upper = name?.trim().toUpperCase();
  if (!upper) return null;
  const hex = PROCESS[upper] ?? LIST.get(key(upper));
  return hex ? { background: hex, text: upper === 'CYAN' ? '#FFFFFF' : readableOn(hex) } : null; // white on cyan, as on the shop's own card
}

/** Black or white, whichever reads better (WCAG contrast). */
function readableOn(hex: string): InkColor['text'] {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (l + 0.05) / 0.05 >= 1.05 / (l + 0.05) ? '#000000' : '#FFFFFF';
}
