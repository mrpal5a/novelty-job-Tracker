'use client';
// src/components/providers/QueryProvider.tsx
//
// One QueryClient per browser tab, created once and held for the life of the
// admin session — the in-memory cache in front of every /api/* read (jobs,
// machines, stock, dies, plates, job separations, BOM requests, notes).
//
// Deliberately NOT persisted to localStorage/IndexedDB: this is a shared
// shop-floor setup where different departments log into the same terminal
// through a shift, and cached job/material data surviving a sign-out would
// mean the next login could momentarily see the previous department's data.
// Closing the tab drops this cache automatically; AdminHeader's sign-out
// handler also calls queryClient.clear() so a same-tab re-login starts empty
// too, rather than relying on the tab close alone.

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export default function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Data is "fresh" for 30s, matching the polling cadence this app
            // already uses elsewhere — a page revisited inside that window
            // renders instantly from cache instead of re-fetching.
            staleTime: 30_000,
            // A list you've left stays in this tab's memory for 30 minutes
            // (it was 5), so coming back shows it at once and refreshes it
            // in the background — staleTime above still decides when to
            // re-ask. Memory only: gone when the tab closes, and cleared on
            // sign-out (AdminHeader), so nothing outlives the session.
            gcTime: 30 * 60_000,
            // This app already has its own visibility-aware polling per
            // feature; a second refetch-on-focus trigger on top of that
            // would just be redundant network traffic.
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
