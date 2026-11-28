'use client';
// src/components/admin/AdminHeader.tsx
// One 56px bar: the logo, the section groups (Jobs, Production, Stock,
// Dispatch, then BOM, Follow-ups and Reports), and on the right search,
// notes, the admin gear and the account menu.
//
// Groups with more than one page open a small menu under their tab; a group
// holding a single page is a plain link. Who sees which group is decided in
// lib/adminNav.ts, so the bar, the phone sheet, the phone tab bar and Ctrl+K
// always agree.
//
// Below lg the groups move into a sheet behind the hamburger, listed under
// their group names. On phones a tab bar at the bottom carries Jobs, Job
// Separation, a raised Search, Shade Cards and Job Cards.

import Link from 'next/link';
import { useEffect, useId, useRef, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { LIST_WARMUP } from '@/lib/listQueries';
import { ChevronDown, ClipboardList, LayoutDashboard, LogOut, Menu, MessageSquare, Palette, Search, Settings, SplitSquareHorizontal, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import {
  canDeptUseBOM,
  canDeptManageDispatchNotifications,
  canDeptExportData,
  canDeptPrintRollSlips,
  canDeptPrintBoxSlips,
  type DeptPermissions,
} from '@/lib/constants/departments';
import { NOTES_OPEN_EVENT, NOTES_UNREAD_EVENT } from '@/lib/constants/events';
import {
  buildAdminLinks, buildNavGroups, groupBadge, isActiveHref, isGroupActive,
  type NavGroup, type NavLink,
} from '@/lib/adminNav';
import { initials } from '@/lib/team';
import { useExitGhost } from '@/hooks/useExitGhost';
import { Exiting } from '@/components/ui/Exiting';
import { Logo } from '@/components/brand/Logo';
import ExportButton from './ExportButton';
import CommandPalette, { warmSearch } from './CommandPalette';
import { useBomPendingCount, useDispatchPendingCount } from '@/hooks/useBadgeCounts';

type Props = {
  dept:        DeptPermissions;
  /** Department name, e.g. "Admin". */
  displayName: string;
  /** The person signed in — their Team name, else the start of their email. */
  userName:    string;
};

const iconBtn =
  'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-white/[0.08] text-white transition-colors hover:bg-white/[0.16] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mint/70';

/** Amber count for unanswered work inside a group (BOM requests, unsent dispatch emails). */
function CountPill({ n, label, className }: { n: number; label?: string; className?: string }) {
  if (n <= 0) return null;
  return (
    <span
      aria-label={label}
      className={cn('inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-amber-300 px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-[#0A1F18]', className)}
    >
      {n}
    </span>
  );
}

// ── Dropdown ──────────────────────────────────────────────────
// Disclosure pattern: a button with aria-expanded and a list of links. It
// closes on Escape (focus back to the button), an outside click, or a
// navigation. Arrow keys move between the links once inside.

function useDismiss(open: boolean, close: () => void, rootRef: React.RefObject<HTMLElement | null>, btnRef: React.RefObject<HTMLButtonElement | null>) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); btnRef.current?.focus(); }
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close, rootRef, btnRef]);
}

/** Open/close state for one header dropdown, closed again on every navigation. */
function useDropdown(pathname: string) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef  = useRef<HTMLButtonElement>(null);
  const menuId  = useId();
  const close   = useRef(() => setOpen(false)).current;
  useDismiss(open, close, rootRef, btnRef);
  useEffect(() => { setOpen(false); }, [pathname]);
  return { open, setOpen, close, rootRef, btnRef, menuId };
}

function onMenuArrows(e: React.KeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
  e.preventDefault();
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('a, button:not([disabled])'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[next]?.focus();
}

/** A header dropdown's panel: eases in under its tab and back out on close. */
function MenuPanel({ id, className, children }: { id: string; className: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useExitGhost(ref);
  return <div ref={ref} id={id} className={cn(menuPanel, className)} onKeyDown={onMenuArrows}>{children}</div>;
}

const menuPanel =
  'anim-drop absolute top-[calc(100%+6px)] z-50 min-w-[200px] rounded-xl border border-brand-border bg-white p-1.5 text-brand-ink shadow-[0_12px_32px_rgba(12,42,32,0.18)]';

// Pointer or keyboard focus reaching a menu link starts loading that page's
// list (lib/listQueries), so it is usually in memory by the time the click
// lands. prefetchQuery never throws and does nothing while the cached copy
// is still fresh, so sweeping across the menu costs one request per page.
function useWarmList(href: string) {
  const queryClient = useQueryClient();
  const warm = LIST_WARMUP[href];
  return warm ? () => { void queryClient.prefetchQuery(warm()); } : undefined;
}

function MenuLink({ item, pathname, onPick }: { item: NavLink; pathname: string; onPick: () => void }) {
  const active = isActiveHref(pathname, item.href);
  const Icon = item.icon;
  const warm = useWarmList(item.href);
  return (
    <Link
      href={item.href}
      onClick={onPick}
      onPointerEnter={warm}
      onFocus={warm}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary/40',
        active ? 'bg-brand-surface-hover font-semibold text-brand-primary' : 'font-medium hover:bg-brand-surface-hover',
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-brand-muted" aria-hidden="true" />
      <span className="flex-1">{item.label}</span>
      <CountPill n={item.badge ?? 0} label={item.badgeLabel?.(item.badge ?? 0)} />
    </Link>
  );
}

const tabCls = (active: boolean) => cn(
  // 40px for a mouse, 44px on a touch screen (PRODUCT.md's tap target).
  'inline-flex h-10 [@media(pointer:coarse)]:h-11 shrink-0 items-center gap-1 whitespace-nowrap rounded-lg px-2.5 text-sm xl:px-3 transition-colors',
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mint/70',
  active ? 'bg-white/[0.16] font-semibold text-white' : 'font-medium text-white/80 hover:bg-white/10 hover:text-white',
);

function GroupTab({ group, pathname }: { group: NavGroup; pathname: string }) {
  const active = isGroupActive(pathname, group);
  const warm = useWarmList(group.items.length === 1 ? group.items[0].href : '');

  // One page in the group: no menu to open, just go there.
  if (group.items.length === 1) {
    const item = group.items[0];
    return (
      <Link href={item.href} aria-current={active ? 'page' : undefined} className={tabCls(active)} onPointerEnter={warm} onFocus={warm}>
        {group.label}
        <CountPill n={item.badge ?? 0} label={item.badgeLabel?.(item.badge ?? 0)} className="ml-1" />
      </Link>
    );
  }
  return <GroupMenu group={group} pathname={pathname} active={active} />;
}

function GroupMenu({ group, pathname, active }: { group: NavGroup; pathname: string; active: boolean }) {
  const { open, setOpen, close, rootRef, btnRef, menuId } = useDropdown(pathname);
  const badge = groupBadge(group);
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={active ? 'page' : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => document.getElementById(menuId)?.querySelector<HTMLElement>('a')?.focus());
          }
        }}
        className={tabCls(active)}
      >
        {group.label}
        <CountPill n={badge} label={`${badge} waiting in ${group.label}`} className="ml-1" />
        <ChevronDown
          className={cn('h-3 w-3 transition-transform motion-reduce:transition-none', open && 'rotate-180', !active && 'opacity-70')}
          strokeWidth={2.4}
          aria-hidden="true"
        />
      </button>
      {open && (
        <MenuPanel id={menuId} className={'left-0'}>
          {group.items.map((item) => (
            <MenuLink key={item.href} item={item} pathname={pathname} onPick={close} />
          ))}
        </MenuPanel>
      )}
    </div>
  );
}

// ── Header ────────────────────────────────────────────────────

export default function AdminHeader({ dept, displayName, userName }: Props) {
  const router      = useRouter();
  const pathname    = usePathname();
  const supabase    = createClient();
  const queryClient = useQueryClient();

  const [sheetOpen, setSheetOpen]     = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => { setSheetOpen(false); }, [pathname]);

  // Realtime-driven counts with a slow fallback poll — see useBadgeCounts.
  const bomPending      = useBomPendingCount(canDeptUseBOM(dept));
  const dispatchPending = useDispatchPendingCount(canDeptManageDispatchNotifications(dept));

  const groups     = buildNavGroups(dept, { bomPending, dispatchPending });
  const adminLinks = buildAdminLinks(dept);
  const allLinks   = [...groups.flatMap((g) => g.items), ...adminLinks];
  const sheetGroups: NavGroup[] = adminLinks.length
    ? [...groups, { key: 'admin', label: 'Admin', icon: Settings, items: adminLinks }]
    : groups;

  // NotesFeed (mounted in the layout) owns the notes; it reports its unread
  // count by event and opens when asked the same way.
  const [notesUnread, setNotesUnread] = useState(0);
  useEffect(() => {
    const onUnread = (e: Event) => setNotesUnread(Number((e as CustomEvent<number>).detail) || 0);
    window.addEventListener(NOTES_UNREAD_EVENT, onUnread);
    return () => window.removeEventListener(NOTES_UNREAD_EVENT, onUnread);
  }, []);
  const openNotes  = () => { setSheetOpen(false); window.dispatchEvent(new Event(NOTES_OPEN_EVENT)); };
  const notesLabel = notesUnread > 0 ? `Internal notes, ${notesUnread} unread` : 'Internal notes';

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // "/" focuses whatever search box is on the current page — every admin
      // page tags its own search input with data-global-search, so there is
      // at most one match. Only when not already typing somewhere.
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const t = e.target as HTMLElement | null;
        if (t?.closest('input, textarea, select, [contenteditable="true"]')) return;
        const search = document.querySelector<HTMLInputElement>('[data-global-search]');
        if (!search) return;
        e.preventDefault();
        search.focus();
        search.select();
        return;
      }
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      // Ctrl+K searches everything — jobs, plates, dies, stock, parties.
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    // Drop every cached response — this is a shared shop-floor terminal, and
    // whoever logs in next must not see a moment of the previous
    // department's job/stock/BOM data from the query cache.
    queryClient.clear();
    router.push('/login');
    router.refresh();
  }

  const adminActive = adminLinks.some((l) => isActiveHref(pathname, l.href)) || isActiveHref(pathname, '/admin/printing-units');

  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-brand-header">
      <div className="mx-auto flex h-14 max-w-screen-2xl items-center gap-3 px-4 lg:gap-5 3xl:max-w-[1800px] 4xl:max-w-[2200px]">
        <Link href="/admin" aria-label="Go to dashboard" title="Dashboard" className="shrink-0">
          <Logo onDark width={120} height={30} priority />
        </Link>

        <nav aria-label="Admin sections" className="hidden min-w-0 flex-1 items-center gap-0.5 lg:flex">
          {groups.map((g) => <GroupTab key={g.key} group={g} pathname={pathname} />)}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            onPointerEnter={warmSearch}
            aria-label="Search everything (Ctrl K)"
            title="Search everything (Ctrl K)"
            className={cn(iconBtn, 'hidden sm:inline-flex')}
          >
            <Search className="h-[19px] w-[19px]" aria-hidden="true" />
          </button>

          <button type="button" onClick={openNotes} aria-label={notesLabel} title={notesLabel} className={iconBtn}>
            <MessageSquare className="h-[19px] w-[19px]" aria-hidden="true" />
            {notesUnread > 0 && (
              <span aria-hidden="true" className="absolute right-1 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-mint px-1 font-mono text-[10px] font-semibold text-[#0A1F18]">
                {notesUnread > 99 ? '99+' : notesUnread}
              </span>
            )}
          </button>

          {adminLinks.length > 0 && <AdminGear links={adminLinks} pathname={pathname} active={adminActive} />}

          <AccountMenu
            userName={userName}
            displayName={displayName}
            canExport={canDeptExportData(dept)}
            onLogout={handleLogout}
            pathname={pathname}
          />

          {/* Below lg this is the only way to the sections, so a full 44px target. */}
          <button
            type="button"
            onClick={() => setSheetOpen((o) => !o)}
            aria-expanded={sheetOpen}
            aria-controls="admin-mobile-nav"
            aria-label={sheetOpen ? 'Close menu' : 'Open menu'}
            className="-mr-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white/85 transition-colors hover:bg-white/10 hover:text-white lg:hidden"
          >
            {sheetOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Section sheet — every group with its pages, full names, 44px rows. */}
      {sheetOpen && <Exiting>
        <nav
          id="admin-mobile-nav"
          aria-label="Admin sections (menu)"
          className="anim-drop max-h-[calc(100dvh_-_56px_-_var(--tabbar-h))] sm:max-h-[calc(100dvh-56px)] overflow-y-auto overscroll-contain border-t border-white/10 bg-brand-header px-4 pb-3 pt-1 lg:hidden"
        >
          {sheetGroups.map((g) => (
            <div key={g.key} className="border-b border-white/10 py-2">
              {/* A one-page group's heading would only repeat its link. */}
              {!(g.items.length === 1 && g.items[0].label === g.label) && (
                <p className="px-2 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white/60">{g.label}</p>
              )}
              {g.items.map((item) => {
                const active = isActiveHref(pathname, item.href);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-sm font-medium transition-colors',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mint/70',
                      active ? 'bg-white/15 text-white' : 'text-white/85 hover:bg-white/10 hover:text-white',
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                    <span className="flex-1">{item.label}</span>
                    <CountPill n={item.badge ?? 0} label={item.badgeLabel?.(item.badge ?? 0)} />
                  </Link>
                );
              })}
            </div>
          ))}
          <div className="flex items-center justify-between gap-3 pt-2">
            <span className="min-w-0 px-2">
              <span className="block truncate text-sm font-semibold text-white">{userName}</span>
              <span className="block font-mono text-[11px] uppercase text-white/70">{displayName}</span>
            </span>
            <button
              type="button"
              onClick={handleLogout}
              className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </nav>
      </Exiting>}

      {/* Phone tab bar — below sm. Jobs, Job Separation, Shade Cards and
          Job Cards either side of a raised Search in the middle;
          everything else is behind the hamburger. Notes sits in the bar up top. */}
      <nav
        aria-label="Quick sections"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-brand-border bg-white pb-[env(safe-area-inset-bottom)] sm:hidden"
      >
        {(() => {
          const tab = 'relative flex min-h-[60px] min-w-0 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium';
          const links = [
            { href: '/admin',                label: 'Jobs',        icon: LayoutDashboard },
            { href: '/admin/job-separation', label: 'Job Sep.',    icon: SplitSquareHorizontal, name: 'Job Separation' },
            null,
            { href: '/admin/shade-cards',    label: 'Shade Cards', icon: Palette },
            { href: '/admin/job-cards',      label: 'Job Cards',   icon: ClipboardList },
          ];
          return links.map((l) => {
            if (!l) return (
              <div key="search" className="flex flex-1 justify-center">
                <button
                  type="button"
                  onClick={() => setPaletteOpen(true)}
                  onPointerEnter={warmSearch}
                  aria-label="Search everything"
                  className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-brand-primary text-white shadow-[0_6px_16px_rgba(16,85,63,0.35)] ring-4 ring-white transition-transform active:scale-95 motion-reduce:transition-none focus-visible:outline-none focus-visible:ring-brand-mint"
                >
                  <Search className="h-6 w-6" aria-hidden="true" />
                </button>
              </div>
            );
            const on = !sheetOpen && (l.href === '/admin'
              ? pathname === '/admin' || pathname.startsWith('/admin/jobs/')
              : isActiveHref(pathname, l.href));
            const Icon = l.icon;
            return (
              <Link key={l.href} href={l.href} aria-current={on ? 'page' : undefined}
                    aria-label={'name' in l ? l.name : undefined}
                    className={cn(tab, on ? 'font-semibold text-brand-primary' : 'text-brand-muted')}>
                <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
                <span className="max-w-full truncate px-0.5">{l.label}</span>
              </Link>
            );
          });
        })()}
      </nav>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        sections={allLinks.map(({ href, label, icon }) => ({ href, label, icon }))}
        // The slip this department may print (roll first), or none: decides
        // whether the preview offers "Print slip". The Slips page checks again.
        slipKind={canDeptPrintRollSlips(dept) ? 'roll' : canDeptPrintBoxSlips(dept) ? 'box' : null}
      />
    </header>
  );
}

// ── Gear: Team, Departments, Settings ─────────────────────────

function AdminGear({ links, pathname, active }: { links: NavLink[]; pathname: string; active: boolean }) {
  const { open, setOpen, close, rootRef, btnRef, menuId } = useDropdown(pathname);
  return (
    <div ref={rootRef} className="relative hidden lg:block">
      <button
        ref={btnRef}
        type="button"
        aria-label="Admin settings"
        title="Team, departments and settings"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((o) => !o)}
        className={cn(iconBtn, active && 'bg-white/[0.2]')}
      >
        <Settings className="h-[19px] w-[19px]" aria-hidden="true" />
      </button>
      {open && (
        <MenuPanel id={menuId} className={'right-0'}>
          {links.map((l) => <MenuLink key={l.href} item={l} pathname={pathname} onPick={close} />)}
        </MenuPanel>
      )}
    </div>
  );
}

// ── Account: who is signed in, export, sign out ───────────────

function AccountMenu({ userName, displayName, canExport, onLogout, pathname }: {
  userName: string; displayName: string; canExport: boolean; onLogout: () => void; pathname: string;
}) {
  const { open, setOpen, rootRef, btnRef, menuId } = useDropdown(pathname);
  return (
    <div ref={rootRef} className="relative hidden sm:block">
      <button
        ref={btnRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Signed in as ${userName}, ${displayName}. Account menu`}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 flex min-h-11 items-center gap-2 rounded-[10px] px-1.5 text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-mint/70 xl:pl-2.5"
      >
        <span className="hidden flex-col items-end xl:flex">
          <span className="max-w-[160px] truncate text-[13px] font-semibold leading-tight">{userName}</span>
          <span className="font-mono text-[11px] uppercase leading-tight text-white/75">{displayName}</span>
        </span>
        <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-white/[0.14] font-mono text-[11px] font-semibold xl:hidden">
          {initials(userName)}
        </span>
      </button>
      {open && (
        <MenuPanel id={menuId} className={'right-0 w-[240px]'}>
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold">{userName}</p>
            <p className="font-mono text-[11px] uppercase text-brand-muted">{displayName}</p>
          </div>
          <div className="border-t border-brand-line-soft pt-1">
            {/* Full-database export — Admin only; GET /api/export is the real gate.
                The menu stays open while it runs so its progress stays visible. */}
            {canExport && <ExportButton variant="menu" />}
            <button
              type="button"
              onClick={onLogout}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-brand-ink transition-colors hover:bg-brand-surface-hover"
            >
              <LogOut className="h-4 w-4 text-brand-muted" aria-hidden="true" />
              Sign out
            </button>
          </div>
        </MenuPanel>
      )}
    </div>
  );
}
