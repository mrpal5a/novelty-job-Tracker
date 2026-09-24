'use client';
// src/hooks/usePaperStock.ts
// Live paper rolls (remaining > 0), shared by BOM → Inventory and the BOM
// costing sheet's Stock column. One query key, so a roll received or issued
// in either place updates both.

import { useQuery } from '@tanstack/react-query';
import type { PaperRoll } from '@/lib/types';

export function usePaperStock() {
  return useQuery({
    queryKey: ['paper-stock'],
    queryFn: async () => {
      const res  = await fetch('/api/paper-stock');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load paper stock');
      return (data.rolls ?? []) as PaperRoll[];
    },
    refetchInterval: 60_000,
  });
}
