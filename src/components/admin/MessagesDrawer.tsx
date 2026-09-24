'use client';
// src/components/admin/MessagesDrawer.tsx
// ============================================================
// Slide-out panel from the header (AdminHeader → MessagesWidget). Two
// views: the conversation list, and a selected thread. Admin-initiated
// only — the "New chat" button (compose view) is hidden for anyone who
// isn't Admin, but every participant can reply once a thread exists.
//
// Realtime nudges live at the widget level (one shared subscription,
// see MessagesWidget) and invalidate the ['messages', ...] query keys
// used here — this component just reacts to whatever React Query hands
// it, the same "on-change nudge, not a poll loop" shape as PrepressTodoPanel.
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Send, X, Tag, SquarePen, Check } from 'lucide-react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';
import type { ConversationDetail, ConversationSummary, Member } from '@/lib/types';

type Props = {
  userEmail:    string;
  isSuperAdmin: boolean;
  onClose:      () => void;
};

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  try {
    return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
  } catch {
    return '';
  }
}

/** Everyone in the thread except me — what a list row/thread header shows. */
function otherParticipants(c: { participants: { member_email: string }[] }, userEmail: string) {
  return c.participants.filter((p) => p.member_email !== userEmail).map((p) => p.member_email);
}

export default function MessagesDrawer({ userEmail, isSuperAdmin, onClose }: Props) {
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft,       setDraft]     = useState('');
  const [sending,     setSending]   = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ── New-chat view: opened from the header's "New chat" button. Pick
  // people from the list (or type to filter), then type the message in the
  // bottom composer — same place the reply box sits in a thread. Reuses an
  // existing thread with that exact recipient set if one exists, otherwise
  // starts a new one.
  const [composing,    setComposing]    = useState(false);
  const [recipients,   setRecipients]   = useState<Member[]>([]);
  const [toValue,      setToValue]      = useState('');
  const [activeIndex,  setActiveIndex]  = useState(0);
  const [messageText,  setMessageText]  = useState('');
  const [sendingNew,   setSendingNew]   = useState(false);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const toRef = useRef<HTMLInputElement>(null);

  const { data: members = [] } = useQuery({
    queryKey: ['team', 'members'],
    queryFn: async () => {
      const res = await fetch('/api/team');
      if (!res.ok) throw new Error('Failed to load team');
      const data = await res.json();
      return (data.members ?? []) as Member[];
    },
    enabled: isSuperAdmin,
    staleTime: 5 * 60 * 1000,
  });

  const { data: conversations = [], isLoading: listLoading } = useQuery({
    queryKey: ['messages', 'conversations'],
    queryFn: async () => {
      const res = await fetch('/api/messages/conversations', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load conversations');
      const data = await res.json();
      return data.conversations as ConversationSummary[];
    },
    refetchOnWindowFocus: true,
  });

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ['messages', 'conversation', selectedId],
    queryFn: async () => {
      const res = await fetch(`/api/messages/conversations/${selectedId}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load conversation');
      const data = await res.json();
      return data.conversation as ConversationDetail;
    },
    enabled: !!selectedId,
  });

  // Opening a thread marks it read — the server only ever touches the
  // caller's own participant row (RLS), so this can't affect anyone else.
  useEffect(() => {
    if (!selectedId) return;
    fetch(`/api/messages/conversations/${selectedId}/read`, { method: 'POST' })
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['messages', 'unread-count'] });
        queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] });
      })
      .catch(() => { /* best-effort — the badge just stays stale until the next nudge */ });
  }, [selectedId, queryClient]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ block: 'end' });
  }, [thread?.messages.length]);

  // Close on Escape / outside click — same transient-overlay behaviour as
  // NotesFeed and PrepressTodoPanel.
  useEffect(() => {
    // Escape backs out of the new-chat view first, then closes the drawer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (composing) closeCompose(); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, composing]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  async function sendReply() {
    const text = draft.trim();
    if (!text || !selectedId || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/messages/conversations/${selectedId}/messages`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ body: text }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send');
        return;
      }
      setDraft('');
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversation', selectedId] });
      queryClient.invalidateQueries({ queryKey: ['messages', 'conversations'] });
    } catch {
      toast.error('Network error');
    } finally {
      setSending(false);
    }
  }

  // Filter text for the people list — a leading "@" is tolerated so the
  // old muscle memory still works.
  const memberQuery = toValue.replace(/^@/, '').trim().toLowerCase();

  const filteredMembers = useMemo(() => {
    if (!composing) return [];
    return members
      .filter((m) => m.email !== userEmail)
      .filter((m) => memberQuery === '' || m.email.toLowerCase().includes(memberQuery) || (m.department ?? '').toLowerCase().includes(memberQuery));
  }, [composing, members, memberQuery, userEmail]);

  useEffect(() => { setActiveIndex(0); }, [memberQuery]);

  useEffect(() => {
    if (composing) toRef.current?.focus();
  }, [composing]);

  function openCompose() {
    setSelectedId(null);
    setComposing(true);
  }

  function closeCompose() {
    setComposing(false);
    setRecipients([]);
    setToValue('');
    setMessageText('');
  }

  // Tapping a person toggles them in/out of the recipient set.
  function selectMember(m: Member) {
    setRecipients((prev) => (prev.some((r) => r.id === m.id) ? prev.filter((r) => r.id !== m.id) : [...prev, m]));
    setToValue('');
  }

  function removeRecipient(id: string) {
    setRecipients((prev) => prev.filter((r) => r.id !== id));
  }

  function onToKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && toValue === '' && recipients.length > 0) {
      setRecipients((prev) => prev.slice(0, -1));
      return;
    }
    if (filteredMembers.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex((i) => (i + 1) % filteredMembers.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex((i) => (i - 1 + filteredMembers.length) % filteredMembers.length); }
    else if (e.key === 'Enter') { e.preventDefault(); selectMember(filteredMembers[activeIndex] ?? filteredMembers[0]); }
  }

  function onMessageKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendNew(); }
  }

  // Reuses the existing thread if its participant set (minus me) matches
  // the tagged recipients exactly; otherwise starts a new one. Same two
  // endpoints the drawer already uses for replying / the old compose modal.
  async function sendNew() {
    const text = messageText.trim();
    if (!text || recipients.length === 0 || sendingNew) return;

    setSendingNew(true);
    try {
      const targetEmails = new Set(recipients.map((r) => r.email));
      const existing = conversations.find((c) => {
        const others = otherParticipants(c, userEmail);
        return others.length === targetEmails.size && others.every((e) => targetEmails.has(e));
      });

      const res = existing
        ? await fetch(`/api/messages/conversations/${existing.conversation_id}/messages`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ body: text }),
          })
        : await fetch('/api/messages/conversations', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ recipientIds: recipients.map((r) => r.id), body: text }),
          });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? 'Failed to send');
        return;
      }

      const targetId = existing ? existing.conversation_id : data.conversation.id;
      queryClient.invalidateQueries({ queryKey: ['messages'] });
      closeCompose();
      setSelectedId(targetId);
    } catch {
      toast.error('Network error');
    } finally {
      setSendingNew(false);
    }
  }

  const selectedSummary = conversations.find((c) => c.conversation_id === selectedId);

  return (
    <section
      ref={panelRef}
      aria-label="Team messages"
      className={cn(
        'fixed right-0 top-14 z-50 flex flex-col',
        'h-[calc(100vh-3.5rem)] w-full sm:w-[420px]',
        'bg-brand-surface border-l border-brand-border shadow-2xl shadow-black/20',
      )}
    >
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-4 h-12 bg-brand-header text-white shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          {(selectedId || composing) && (
            <button
              onClick={() => (composing ? closeCompose() : setSelectedId(null))}
              aria-label="Back to conversations"
              className="p-1.5 -ml-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <h2 className="text-sm font-semibold truncate">
            {composing
              ? 'New chat'
              : selectedId
                ? (selectedSummary ? otherParticipants(selectedSummary, userEmail).join(', ') || 'Conversation' : 'Conversation')
                : 'Messages'}
          </h2>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isSuperAdmin && !selectedId && !composing && (
            <button
              onClick={openCompose}
              className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg bg-white/10 text-white text-xs font-semibold hover:bg-white/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <SquarePen className="h-4 w-4" aria-hidden="true" />
              New chat
            </button>
          )}
          <button
            onClick={onClose}
            aria-label="Close messages"
            className="p-2 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* ── New-chat view ───────────────────────────────────────
          Opened from the header button. "To" field with chips on top,
          the people list in the middle (tap to add/remove), and the
          message box pinned to the bottom like a thread's reply box. */}
      {composing && (
        <>
          <div className="px-4 pt-3 pb-2 border-b border-brand-border shrink-0">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-brand-border bg-brand-bg px-2 py-1.5 focus-within:ring-2 focus-within:ring-brand-primary/40 transition-shadow">
              <span className="text-xs font-medium text-brand-muted pl-1">To:</span>
              {recipients.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-medium pl-2 pr-1 py-1"
                >
                  {r.email.split('@')[0]}
                  <button
                    type="button"
                    onClick={() => removeRecipient(r.id)}
                    aria-label={`Remove ${r.email}`}
                    className="rounded-full hover:bg-brand-primary/20 p-0.5"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
              <input
                ref={toRef}
                type="text"
                value={toValue}
                onChange={(e) => setToValue(e.target.value)}
                onKeyDown={onToKeyDown}
                placeholder={recipients.length === 0 ? 'Search name or department…' : 'Add another…'}
                aria-label="Search people"
                className="flex-1 min-w-[120px] bg-transparent text-sm text-brand-ink placeholder:text-brand-muted focus:outline-none py-1 min-h-[28px]"
              />
            </div>
          </div>

          <ul className="flex-1 overflow-y-auto divide-y divide-brand-border" aria-label="People">
            {filteredMembers.length === 0 && (
              <li className="px-4 py-8 text-center text-xs text-brand-muted">
                {members.length === 0 ? 'Loading…' : 'No one matches that search.'}
              </li>
            )}
            {filteredMembers.map((m, i) => {
              const picked = recipients.some((r) => r.id === m.id);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => selectMember(m)}
                    aria-pressed={picked}
                    className={cn(
                      'w-full min-h-11 text-left px-4 py-2.5 flex items-center justify-between gap-2 transition-colors focus:outline-none focus-visible:bg-brand-bg',
                      i === activeIndex && toValue !== '' ? 'bg-brand-bg' : 'hover:bg-brand-bg',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-brand-ink truncate">{m.email}</span>
                      {m.department && (
                        <span className="block text-[10px] font-mono text-brand-muted">{m.department}</span>
                      )}
                    </span>
                    <span
                      className={cn(
                        'h-5 w-5 shrink-0 rounded-full border flex items-center justify-center transition-colors',
                        picked ? 'bg-brand-primary border-brand-primary text-white' : 'border-brand-border',
                      )}
                      aria-hidden="true"
                    >
                      {picked && <Check className="h-3 w-3" />}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="border-t border-brand-border p-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                ref={messageRef}
                value={messageText}
                onChange={(e) => setMessageText(e.target.value)}
                onKeyDown={onMessageKeyDown}
                disabled={recipients.length === 0}
                placeholder={recipients.length === 0 ? 'Pick someone first…' : 'Type your message…'}
                rows={1}
                className="flex-1 resize-none max-h-28 rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40 disabled:opacity-60"
              />
              <button
                onClick={sendNew}
                disabled={!messageText.trim() || recipients.length === 0 || sendingNew}
                aria-label="Send message"
                className="min-h-11 min-w-11 rounded-lg bg-brand-primary text-white flex items-center justify-center hover:bg-brand-primary-hover disabled:opacity-40 transition-colors"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── Conversation list ────────────────────────────────── */}
      {!selectedId && !composing && (
        <ul className="flex-1 overflow-y-auto divide-y divide-brand-border">
          {listLoading && (
            <li className="px-4 py-8 text-center text-xs text-brand-muted">Loading…</li>
          )}

          {!listLoading && conversations.length === 0 && (
            <li className="px-4 py-8 text-center text-xs text-brand-muted">
              {isSuperAdmin
                ? 'No conversations yet — tap New chat to message someone.'
                : 'No conversations yet. Messages Admin sends you will show up here.'}
            </li>
          )}

          {conversations.map((c) => {
            const others = otherParticipants(c, userEmail);
            return (
              <li key={c.conversation_id}>
                <button
                  onClick={() => setSelectedId(c.conversation_id)}
                  className="w-full text-left px-4 py-3 hover:bg-brand-bg transition-colors focus:outline-none focus-visible:bg-brand-bg"
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-semibold text-brand-ink truncate">
                      {others.join(', ') || 'You'}
                    </span>
                    <time className="text-[10px] text-brand-muted shrink-0">
                      {relativeTime(c.last_message_at ?? c.created_at)}
                    </time>
                  </div>
                  {c.subject && (
                    <p className="mt-0.5 text-[11px] font-medium text-brand-muted truncate">{c.subject}</p>
                  )}
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <p className="text-xs text-brand-ink/80 truncate">
                      {c.last_message_sender_email === userEmail ? 'You: ' : ''}
                      {c.last_message_body ?? ''}
                    </p>
                    {c.unread_count > 0 && (
                      <span className="shrink-0 min-w-[18px] h-[18px] px-1 rounded-full bg-brand-danger text-white text-[10px] font-semibold leading-[18px] text-center">
                        {c.unread_count > 99 ? '99+' : c.unread_count}
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Thread ───────────────────────────────────────────── */}
      {selectedId && (
        <>
          <ul className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {threadLoading && (
              <li className="text-center text-xs text-brand-muted py-8">Loading…</li>
            )}
            {thread?.messages.map((m) => {
              const mine = m.sender_email === userEmail;
              return (
                <li key={m.id} className={cn('flex', mine ? 'justify-end' : 'justify-start')}>
                  <div className={cn('max-w-[85%] rounded-xl px-3 py-2', mine ? 'bg-brand-primary text-white' : 'bg-brand-bg border border-brand-border text-brand-ink')}>
                    {!mine && (
                      <p className="text-[10px] font-semibold text-brand-muted mb-0.5">{m.sender_email}</p>
                    )}
                    <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>
                    {m.job && (
                      <Link
                        href={`/admin/jobs/${m.job.id}`}
                        onClick={onClose}
                        className={cn(
                          'mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-mono',
                          mine ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-white border border-brand-border text-brand-primary hover:bg-brand-bg',
                        )}
                      >
                        <Tag className="h-3 w-3" aria-hidden="true" />
                        {m.job.job_card_number ?? m.job.po_number}
                      </Link>
                    )}
                    <time className={cn('block mt-1 text-[10px]', mine ? 'text-white/70' : 'text-brand-muted')}>
                      {relativeTime(m.created_at)}
                    </time>
                  </div>
                </li>
              );
            })}
            <div ref={threadEndRef} />
          </ul>

          <div className="border-t border-brand-border p-3 shrink-0">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendReply();
                  }
                }}
                placeholder="Reply…"
                rows={1}
                className="flex-1 resize-none max-h-28 rounded-lg border border-brand-border bg-brand-bg px-3 py-2 text-sm text-brand-ink placeholder:text-brand-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40"
              />
              <button
                onClick={sendReply}
                disabled={!draft.trim() || sending}
                aria-label="Send reply"
                className="min-h-11 min-w-11 rounded-lg bg-brand-primary text-white flex items-center justify-center hover:bg-brand-primary-hover disabled:opacity-40 transition-colors"
              >
                <Send className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
