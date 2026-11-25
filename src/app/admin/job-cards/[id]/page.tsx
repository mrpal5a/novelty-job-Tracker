// src/app/admin/job-cards/[id]/page.tsx
// One job card, whichever way it was made. Departments with job_card_edit
// edit it; every other one sees it once issued, read-only. Only Admin deletes.

import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards, canDeptManageDiesPlates } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import JobCardForm from '@/components/admin/JobCardForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job Card', robots: { index: false, follow: false } };

export default async function JobCardByIdPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getClaimsUser(await createServerSupabaseClient());
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) notFound();
  return (
    <JobCardForm
      cardId={id}
      canManage={canDeptEditJobCards(perms)}
      canEditPlates={canDeptManageDiesPlates(perms)}
      canDelete={perms.isSuperAdmin}
    />
  );
}
