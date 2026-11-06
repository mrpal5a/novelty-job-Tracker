// src/app/admin/activity/page.tsx
// Activity Log — who added, changed or deleted what across the app. Admin
// only, the same gate as Settings; GET /api/activity-log enforces it again.

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { loadDirectory } from '@/lib/teamDirectory';
import AdminSectionNav from '@/components/admin/AdminSectionNav';
import ActivityLogView from '@/components/admin/ActivityLogView';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Activity Log',
  robots: { index: false, follow: false },
};

export default async function ActivityLogPage() {
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms?.isSuperAdmin) redirect('/admin');

  const { people, departments } = await loadDirectory();

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionNav />
      <div>
        <h1 className="text-[30px] font-semibold leading-9 tracking-[-0.025em] text-brand-ink">Activity Log</h1>
        <p className="mt-1.5 max-w-[72ch] text-sm text-brand-muted">
          Every change to the app&apos;s data: who made it, when, and what changed. Team chat is not recorded. Entries are kept for 12 months.
        </p>
      </div>
      <ActivityLogView
        people={people.map((p) => ({ id: p.id, username: p.username })).sort((a, b) => a.username.localeCompare(b.username))}
        departments={Object.fromEntries(departments.map((d) => [d.key, d.display_name]))}
      />
    </div>
  );
}
