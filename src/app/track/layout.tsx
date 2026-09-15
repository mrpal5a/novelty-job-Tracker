// src/app/track/layout.tsx
import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '@/components/brand/Logo';
import { GradientMesh } from '@/components/motion/GradientMesh';
import { DeliveryScene } from '@/components/track/DeliveryScene';
import { DeliverySceneProvider } from '@/components/track/DeliverySceneContext';

export const metadata: Metadata = {
  title: 'Order Tracking | Novelty Labels',
  description: 'Track your label printing order status with Novelty Labels & Supplies.',
  robots: { index: true, follow: false },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <DeliverySceneProvider>
      <div className="min-h-screen flex flex-col text-[var(--glass-ink)]">
        <GradientMesh />
        {/* Minimal branded header */}
        <header className="bg-brand-header border-b border-white/10">
          <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
            <Link href="/track" className="inline-flex h-8 items-center [&_img]:h-8 [&_img]:w-auto" aria-label="Novelty Labels — order tracking home">
              <Logo onDark width={132} height={34} priority />
            </Link>
            <span className="text-white/40 text-xs">Order Tracking</span>
          </div>
        </header>

        <main className="relative flex-1 w-full max-w-2xl mx-auto px-4 py-8">
          {children}
        </main>

        <footer className="mt-10">
          <DeliveryScene />
          <p className="text-center text-xs text-[var(--glass-muted)] py-4 bg-black/25">
            Novelty Labels &amp; Supplies · Ankleshwar GIDC, Gujarat
          </p>
        </footer>
      </div>
    </DeliverySceneProvider>
  );
}
