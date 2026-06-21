// src/app/track/layout.tsx
import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';
import { Logo } from '@/components/brand/Logo';
import { GradientMesh } from '@/components/motion/GradientMesh';

export const metadata: Metadata = {
  title: 'Order Tracking | Novelty Labels',
  description: 'Track your label printing order status with Novelty Labels & Supplies.',
  robots: { index: true, follow: false },
};

export default function TrackLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen text-[var(--glass-ink)]">
      <GradientMesh />
      {/* Minimal branded header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-brand-border shadow-[0_1px_0_rgba(22,160,106,0.25)]">
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/track" className="flex items-center gap-2">
            <Logo width={132} height={34} priority />
          </Link>
          <span className="text-brand-subtle text-xs">Order Tracking</span>
        </div>
      </header>

      <main className="relative max-w-2xl mx-auto px-4 py-8">
        {children}
      </main>

      <footer className="mt-16 pb-8 text-center">
        <p className="text-xs text-[var(--glass-muted)]">
          Novelty Labels &amp; Supplies · Ankleshwar GIDC, Gujarat
        </p>
      </footer>
    </div>
  );
}
