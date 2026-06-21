// src/lib/constants/statusColors.ts
// ============================================================
// Status badge colors — exact map from the design spec.
// bg and text are Tailwind utility classes.
// ============================================================

import type { Stage } from './stages';

type ColorConfig = {
  bg: string;
  text: string;
  border?: string;
};

export const STATUS_COLORS: Record<Stage, ColorConfig> = {
  'PO Received':             { bg: 'bg-[#F0F3F0]',  text: 'text-[#5C6E65]' },
  'Artwork Received':        { bg: 'bg-[#F1ECFB]',  text: 'text-[#6B46C1]' },
  'Prepress / Design Check': { bg: 'bg-[#E8F1FB]',  text: 'text-[#1E6FB8]' },
  'Sample Printing':         { bg: 'bg-[#FBF1E0]',  text: 'text-[#9A6510]' },
  'Shade Card Sent':         { bg: 'bg-[#FBEFE2]',  text: 'text-[#B5651A]' },
  'Shade Card Approved':     { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
  'In Printing':             { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
  'Slitting':                { bg: 'bg-[#E8F1FB]',  text: 'text-[#1E6FB8]' },
  'Quality Check':           { bg: 'bg-[#E8F1FB]',  text: 'text-[#1E6FB8]' },
  'Packing':                 { bg: 'bg-[#F1ECFB]',  text: 'text-[#6B46C1]' },
  'Ready to Dispatch':       { bg: 'bg-[#FBF6DF]',  text: 'text-[#8A6D0B]' },
  'Partial Dispatch':        { bg: 'bg-[#FBF1E0]',  text: 'text-[#9A6510]' },
  'Dispatched':              { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
  'On Hold':                 { bg: 'bg-[#FBF1E0]',  text: 'text-[#9A6510]' },
  'PO Closed':               { bg: 'bg-[#E7F5EE]',  text: 'text-[#0B6B43]' },
};

// Row background tints for admin panel
// These override based on urgency / special status (On Hold > urgent)
export const ROW_URGENCY_STYLES = {
  onHold:   'border-l-4 border-l-amber-500/70  bg-amber-50/70',
  urgent1:  'border-l-4 border-l-red-500/70    bg-red-50/70',
  urgent2:  'border-l-4 border-l-orange-500/70 bg-orange-50/60',
  urgent3:  'border-l-4 border-l-yellow-500/60 bg-yellow-50/60',
  qc:       'border-l-4 border-l-sky-500/60    bg-sky-50/60',
  normal:   '',
} as const;

// Job-type badge
export const JOB_TYPE_BADGE: Record<'New' | 'Repeat' | 'Artwork Changed', string> = {
  'New':             'bg-[#E8F1FB] text-[#1E6FB8]',
  'Repeat':          'bg-[#F0F3F0] text-[#5C6E65]',
  'Artwork Changed': 'bg-[#F1ECFB] text-[#6B46C1]',
};

// Urgent priority badge — keyed by urgent_priority (1,2,else)
export function urgentBadgeClass(priority: number | null): string {
  if (priority === 1) return 'bg-red-100 text-red-700';
  if (priority === 2) return 'bg-orange-100 text-orange-700';
  return 'bg-yellow-100 text-yellow-700';
}
