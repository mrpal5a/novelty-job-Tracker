// src/app/api/job-cards/[id]/route.ts
// ============================================================
// GET    /api/job-cards/[id] — the card and every record it can be filled from
//        (its line's, or its typed order's). Departments that only look get
//        issued cards, nothing else. /new is a manual card not saved yet;
//        ?pm= and ?plate= are what has been typed and picked so far.
// PATCH  /api/job-cards/[id] — save a draft's fields, or { action: 'issue' }
//        / 'reopen', or for a card made by hand 'link' { job_separation_id }
//        / 'unlink'. Issuing fills the card here, on the server,
//        from the records as they are now, and freezes it. { action: 'accept',
//        issued_at } accepts the issue that was looked at: nothing changes it
//        until Admin cancels that with { action: 'unaccept' }. { action: 'ask',
//        issued_at, note } sends it back to Prepress instead; issuing again
//        or accepting clears the note.
// DELETE /api/job-cards/[id] — remove a card, issued or not. Admin only; the
//        Activity Log keeps what it said, and its number is free again.
// PATCH needs job_card_edit, accepting job_card_accept. The rules themselves are the database's (107, 108, 113).
// ============================================================

import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { getClaimsUser } from '@/lib/supabase/claims';
import { getDeptPermissions, canDeptEditJobCards } from '@/lib/constants/departments';
import { deptKeyOf } from '@/lib/identity';
import { createAdminClient } from '@/lib/supabase/admin';
import { jobCardWriter, jobCardDbError, loadSourcesOfCard } from '@/lib/api/jobCardSources';
import { EDIT_NOTE_MAX, freezeCard, jobCardFrom, resolveJobCard, type JobCardRow } from '@/lib/jobCard';

type Params = { params: Promise<{ id: string }> };

const refuse = (error: string, status: number) => NextResponse.json({ error }, { status });

const UUID = /^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export async function GET(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const supabase = await createServerSupabaseClient();
  const user = await getClaimsUser(supabase);
  if (!user) return refuse('Unauthorized', 401);
  const perms = await getDeptPermissions(deptKeyOf(user));
  if (!perms) return refuse('Invalid department', 403);
  const edits = canDeptEditJobCards(perms);
  if (id === 'new' ? !edits : !UUID.test(id)) return refuse(id === 'new' ? 'Your department cannot make job cards' : 'Job card not found', id === 'new' ? 403 : 404);
  const query = new URL(request.url).searchParams;
  const plate = query.get('plate');
  try {
    const sources = await loadSourcesOfCard(edits ? createAdminClient() : supabase, id, {
      onlyIssued: !edits, pm: query.get('pm')?.trim().slice(0, 200), plate: plate && UUID.test(plate) ? plate : null,
    });
    if (!sources) return refuse('Job card not found', 404);
    return NextResponse.json({ sources });
  } catch (e) {
    console.error('[GET /api/job-cards/[id]]', e);
    return refuse('Failed to load the job card', 500);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const writer = body?.action === 'accept' || body?.action === 'ask' ? await jobCardWriter('accept')
    : body?.action === 'unaccept' ? await jobCardWriter('admin', 'Only Admin can cancel an acceptance') : await jobCardWriter();
  if ('denied' in writer) return writer.denied;

  const db = createAdminClient();
  const { data: card, error } = await db.from('job_cards').select('*').eq('id', id).maybeSingle<JobCardRow>();
  if (error) return jobCardDbError(error);
  if (!card) return refuse('Job card not found', 404);

  let updates: Record<string, unknown>;
  const action = body?.action;
  if (action === 'accept') {
    if (card.accepted_at) return refuse('This job card is already accepted', 409);
    // Not a card reopened, or issued again, since it was looked at.
    if (!card.issued_at || typeof body.issued_at !== 'string' || Date.parse(body.issued_at) !== Date.parse(card.issued_at)) {
      return refuse('This job card has changed since you opened it. Reload and check it again', 409);
    }
    updates = { accepted_at: new Date().toISOString(), accepted_by: writer.username, edit_request: null };
  } else if (action === 'ask') {
    const note = typeof body.note === 'string' ? body.note.trim() : '';
    if (!note) return refuse('Write what should be changed', 400);
    if (note.length > EDIT_NOTE_MAX) return refuse(`Keep the note under ${EDIT_NOTE_MAX} characters`, 400);
    if (card.accepted_at) return refuse('This job card is already accepted', 409);
    if (!card.issued_at || typeof body.issued_at !== 'string' || Date.parse(body.issued_at) !== Date.parse(card.issued_at)) {
      return refuse('This job card has changed since you opened it. Reload and check it again', 409);
    }
    if (card.job_separation_id) {
      const { data: line, error: lineError } = await db.from('job_separations').select('cancelled_at').eq('id', card.job_separation_id).maybeSingle();
      if (lineError) return jobCardDbError(lineError);
      if (line?.cancelled_at) return refuse('This line is cancelled', 409);
    }
    updates = { edit_request: { note, by: writer.username, at: new Date().toISOString() } };
  } else if (action === 'unaccept') {
    if (!card.accepted_at) return refuse('This job card is not accepted', 409);
    updates = { accepted_at: null, accepted_by: null };
  } else if (card.accepted_at && action !== 'link' && action !== 'unlink') {
    return refuse('Production has accepted this job card: it can no longer be changed', 409);
  } else if (action === 'issue') {
    if (card.issued_at) return refuse('This job card is already issued', 409);
    try {
      const sources = await loadSourcesOfCard(db, id);
      if (!sources) return refuse('Job card not found', 404);
      const frozen = freezeCard(resolveJobCard(sources, card, card.id), writer.username, card.card_number !== null, card.manual !== null);
      if ('error' in frozen) return refuse(frozen.error, 400);
      updates = { ...frozen.columns, details: frozen.details, issued_at: new Date().toISOString(), issued_by: writer.name, edit_request: null };
    } catch (e) {
      console.error('[PATCH /api/job-cards/[id]] issue', e);
      return refuse('Failed to load job card details', 500);
    }
  } else if (action === 'reopen') {
    if (!card.issued_at) return refuse('This job card is not issued', 409);
    updates = { details: null, issued_at: null, issued_by: null };
  } else if (action === 'link' || action === 'unlink') {
    const lineId = action === 'link' ? body.job_separation_id : null;
    if (!card.manual) return refuse('Only a job card made by hand can be linked', 409);
    if (action === 'link' && !(typeof lineId === 'string' && UUID.test(lineId))) return refuse('Choose the order to link', 400);
    updates = { job_separation_id: lineId };
  } else if (action !== undefined) {
    return refuse('Unknown action', 400);
  } else {
    if (card.issued_at) return refuse('This job card is issued: reopen it to change it', 409);
    const parsed = jobCardFrom(body);
    if ('error' in parsed) return refuse(parsed.error, 400);
    // A card stays as it was made: by hand, or from its line.
    if (!card.manual || !parsed.columns.manual) delete parsed.columns.manual;
    if (Object.keys(parsed.columns).length === 0) return refuse('No valid fields to update', 400);
    updates = parsed.columns;
  }

  // Only over the card as it was read: never over someone else's save or issue in between.
  const { data, error: saveError } = await db.from('job_cards').update(updates)
    .eq('id', id).eq('updated_at', card.updated_at).select().maybeSingle();
  if (saveError) return jobCardDbError(saveError);
  if (!data) return refuse('This job card was just changed by someone else. Reload and try again', 409);
  return NextResponse.json({ card: data });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params;
  const writer = await jobCardWriter('admin');
  if ('denied' in writer) return writer.denied;

  const { data, error } = await createAdminClient().from('job_cards').delete().eq('id', id).select('id').maybeSingle();
  if (error) return jobCardDbError(error);
  if (!data) return refuse('Job card not found', 404);
  return NextResponse.json({ ok: true });
}
