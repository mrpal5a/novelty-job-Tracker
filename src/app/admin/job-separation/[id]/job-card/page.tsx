// src/app/admin/job-separation/[id]/job-card/page.tsx
// The job card of one Job Separation line. Departments with job_card_edit make
// it; every other one sees issued cards, read-only. Only Admin deletes.
// Production accepts an issued card: locked until Admin cancels that.

import { notFound } from 'next/navigation';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptAcceptJobCards, canDeptEditJobCards, canDeptManageDiesPlates } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import JobCardForm from '@/components/admin/JobCardForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Job Card', robots: { index: false, follow: false } };

export default async function JobCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getClaimsUser(await createServerSupabaseClient());
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) notFound();
  return (
    <JobCardForm
      lineId={id}
      canManage={canDeptEditJobCards(perms)}
      canEditPlates={canDeptManageDiesPlates(perms)}
      canAccept={canDeptAcceptJobCards(perms)}
      canDelete={perms.isSuperAdmin}
    />
  );
}
