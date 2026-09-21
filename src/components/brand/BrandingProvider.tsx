'use client';
// src/components/brand/BrandingProvider.tsx
// Makes the branding row fetched once in the root layout (a Server
// Component, via lib/branding.ts's getBranding()) available to every client
// component without prop-drilling or a second network round trip.

import { createContext, useContext } from 'react';
import type { Branding } from '@/lib/branding-utils';
import { DEFAULT_BRANDING } from '@/lib/branding-utils';

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function BrandingProvider({
  branding,
  children,
}: {
  branding: Branding;
  children: React.ReactNode;
}) {
  return <BrandingContext.Provider value={branding}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
