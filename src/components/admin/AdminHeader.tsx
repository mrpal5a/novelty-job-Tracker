'use client';
// src/components/admin/AdminHeader.tsx

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import type { Department } from '@/lib/constants/departments';
import { Logo } from '@/components/brand/Logo';

type Props = {
  dept:        Department;
  displayName: string;
};

export default function AdminHeader({ dept, displayName }: Props) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="bg-white/80 backdrop-blur-md sticky top-0 z-40 border-b border-brand-border shadow-[0_1px_0_rgba(22,160,106,0.25)]">
      <div className="max-w-screen-2xl mx-auto px-4 h-14 flex items-center justify-between">

        {/* Brand */}
        <div className="flex items-center gap-3">
          <Logo width={120} height={30} priority />
        </div>

        {/* Right side */}
        <div className="flex items-center gap-3">
          <span className="text-brand-muted text-xs font-mono bg-brand-surface-2 px-2.5 py-1 rounded-full border border-brand-border">
            {displayName}
          </span>
          <button
            onClick={handleLogout}
            className="text-brand-muted hover:text-brand-ink text-xs transition-colors px-2 py-1"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}
