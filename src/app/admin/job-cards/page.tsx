// src/app/admin/job-cards/page.tsx
// Every job card in one list, made from Job Separation or by hand. Everyone
// finds issued cards here; departments with job_card_edit also see drafts and
// make cards by hand.

import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import JobCardsManager from '@/components/admin/JobCardsManager';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job Cards', robots: { index: false, follow: false } };

export default async function JobCardsPage() {
  const user = await getClaimsUser(await createServerSupabaseClient());
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) notFound();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] leading-7 sm:text-[30px] sm:leading-9 font-semibold tracking-[-0.025em] text-brand-ink">Job Cards</h1>
        <p className="mt-1.5 hidden max-w-[72ch] text-sm text-brand-muted sm:block">
          Cards made from Job Separation and cards made by hand. Search by PM code, job name, party, PO or number.
        </p>
      </div>
      <JobCardsManager canManage={canDeptEditJobCards(perms)} />
    </div>
  );
}
