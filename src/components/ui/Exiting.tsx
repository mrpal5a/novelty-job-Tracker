'use client';
// src/components/ui/Exiting.tsx
// Wrap a block shown with `{open && …}` so it eases out on close as well as
// in (useExitGhost). `display: contents`: the wrapper draws no box, so the
// block lays out exactly as it did unwrapped. Its child carries the anim-*
// class that says how it moves.

import { useRef } from 'react';
import { useExitGhost } from '@/hooks/useExitGhost';

export function Exiting({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref);
  return <div ref={ref} className="contents">{children}</div>;
}
