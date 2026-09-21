// src/app/admin/settings/page.tsx
// Company details — name, address, support email, logo — editable here
// instead of an env var or a call to whoever set the app up. Super-admin
// only, same gate as /admin/departments. See src/lib/branding.ts.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import { getBranding } from '@/lib/branding';
import BrandingSettingsForm from '@/components/admin/BrandingSettingsForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default async function SettingsPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(user?.user_metadata?.department);

  if (!perms?.isSuperAdmin) {
    redirect('/admin');
  }

  const branding = await getBranding();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-[var(--glass-ink)]">Settings</h1>
        <p className="text-sm text-[var(--glass-muted)] mt-0.5">
          Company name, address, support email, and logo — shown across the admin panel,
          the client tracking portal, printed labels, and outgoing emails. Changes apply
          within a minute everywhere in the app.
        </p>
      </div>

      <BrandingSettingsForm initial={branding} />
    </div>
  );
}
