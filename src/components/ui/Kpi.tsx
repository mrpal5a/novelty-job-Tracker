// src/components/ui/Kpi.tsx
// One figure in a summary strip ("optional summary strip" in DESIGN.md §4):
// label, mono number, and a one-line note under it that turns green or amber
// when it says something good or bad. Put several in one white card; each
// after the first draws its own divider.
//
// Pass onClick and the figure becomes a filter button: `active` marks the
// one applied (a Press Green bar along the bottom, aria-pressed).
//
// Used by: ReportsView (Month at a glance), ShadeCardsManager (filters).

import { cn } from '@/lib/utils';

export type KpiDelta = { text: string; tone: 'good' | 'bad' | 'muted' };

type Props = {
  label:    string;
  value:    string;
  delta:    KpiDelta | null | undefined;
  loading:  boolean;
  active?:  boolean;
  onClick?: () => void;
};

export function Kpi({ label, value, delta, loading, active, onClick }: Props) {
  const body = (
    <>
      <span className={cn('text-[13px]', active ? 'font-semibold text-brand-ink' : 'text-brand-muted')}>{label}</span>
      <span className="font-mono text-[22px] font-semibold leading-7 tracking-[-0.02em] text-brand-ink sm:text-[26px] sm:leading-8">{loading ? '—' : value}</span>
      <span className={cn('text-xs', delta?.tone === 'good' ? 'text-brand-success' : delta?.tone === 'bad' ? 'text-brand-warning' : 'text-brand-muted')}>
        {loading ? ' ' : delta?.text}
      </span>
    </>
  );
  // Two to a row on a phone (lines between them, the last row's bottom line
  // tucked under the card's border); one row from sm.
  const base = cn(
    'flex min-w-0 basis-1/2 grow flex-col gap-0.5 border-brand-line-soft px-3 py-3 max-sm:-mb-px max-sm:border-b max-sm:odd:border-r',
    'sm:min-w-[180px] sm:flex-1 sm:gap-1 sm:px-5 sm:py-4 sm:[&+&]:border-l',
  );

  if (!onClick) return <div className={base}>{body}</div>;
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        base,
        'text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-[rgba(16,85,63,0.18)]',
        active ? 'bg-brand-surface-hover shadow-[inset_0_-3px_0_#10553F]' : 'hover:bg-[#F5F9F7]',
      )}
    >
      {body}
    </button>
  );
}
