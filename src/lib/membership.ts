/**
 * membership — who you are IN a household, read from the one place the
 * database enforces it.
 *
 * The app used to answer "may this person decide?" by matching display names:
 * the signed-in account was mapped to a roster name by a fuzzy lookup, and
 * that name was checked against `deciderNames` / `adminNames` lists that any
 * member could write. Every authorization bug of the last fortnight traced
 * back to that. `household_members` already held the real answer — role and
 * administrator standing, keyed by user id, guarded by RLS and triggers — so
 * this module reads it and nothing else.
 *
 * - Non-persisted and keyed to the signed-in user id: a membership cached for
 *   one account can never be read by the next one on the same device.
 * - Names (`displayName`) are a display cache on the membership row. They are
 *   never used to decide anything.
 * - Every write returns `{ ok, error }`. Nothing here swallows a refusal: if
 *   the server says no, the person who asked finds out.
 *
 * Two cases have no cloud membership and are answered locally:
 * - the demo, which is account-free and has a view toggle;
 * - a household that has never been backed up, which exists only on this
 *   device, so whoever is using the device runs it until it uploads.
 */

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import { awaitAuthReady, currentSession, subscribeSession, useSession } from '@/lib/auth';
import { linkedCloudId, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export type MemberRole = 'owner' | 'co_owner' | 'contributor' | 'executor';
export type MembershipStatus = 'invited' | 'active' | 'revoked';

/** The signed-in person's own standing in one household. */
export interface MyMembership {
  householdId: string;
  householdName: string;
  role: MemberRole;
  isAdmin: boolean;
  displayName: string | null;
}

/** One row of a household's membership, as the Family screen shows it. */
export interface HouseholdMember {
  id: string;
  userId: string | null;
  email: string | null;
  role: MemberRole;
  status: MembershipStatus;
  isAdmin: boolean;
  displayName: string | null;
  relationship: string | null;
  invitedAt: string;
  acceptedAt: string | null;
  declinedAt: string | null;
}

export type Result = { ok: true } | { ok: false; error: string; reason?: string };

const decides = (role: MemberRole) => role === 'owner' || role === 'co_owner';

/** How to name a member on screen. A label, never an identity. */
export function memberName(m: Pick<HouseholdMember, 'displayName' | 'email'>): string {
  return m.displayName?.trim() || m.email?.split('@')[0] || 'Family member';
}

/* ------------------------------------------------------------------ state */

interface MembershipState {
  /** The account these memberships belong to. */
  userId: string | null;
  /** household id → my standing there (active memberships only). */
  mine: Record<string, MyMembership>;
  /** True once `mine` has been loaded for `userId`. */
  mineLoaded: boolean;
  /** household id → every membership row the server shows me. */
  members: Record<string, HouseholdMember[]>;
  /** Last load failure, for a quiet "couldn't refresh" note. */
  error: string | null;
}

const EMPTY: MembershipState = { userId: null, mine: {}, mineLoaded: false, members: {}, error: null };

const useMembershipStore = create<MembershipState>(() => EMPTY);

/* ------------------------------------------------------------------ loading */

let started = false;

/**
 * Keep memberships in step with the session and the open household. Called
 * once from the root layout, next to startAuth().
 */
export function startMembership(): void {
  if (started) return;
  started = true;

  const onSession = (userId: string | null, status: string) => {
    if (status !== 'signed-in' || !userId) {
      if (useMembershipStore.getState().userId !== null) useMembershipStore.setState(EMPTY);
      return;
    }
    if (useMembershipStore.getState().userId !== userId) {
      // A different account: nothing of the previous one's may survive.
      useMembershipStore.setState({ ...EMPTY, userId });
      void refreshMembership();
    }
  };
  const s = currentSession();
  onSession(s.userId, s.status);
  subscribeSession((next) => onSession(next.userId, next.status));

  // The open household's member list follows the household.
  let lastHid: string | undefined = linkedCloudId(useStore.getState());
  useStore.subscribe((state) => {
    const hid = linkedCloudId(state);
    if (hid === lastHid) return;
    lastHid = hid;
    if (hid && currentSession().status === 'signed-in') void loadHouseholdMembers(hid);
  });
}

/** Reload my memberships and the open household's member list. */
export async function refreshMembership(): Promise<void> {
  await loadMyMemberships();
  const hid = linkedCloudId(useStore.getState());
  if (hid) await loadHouseholdMembers(hid);
}

export async function loadMyMemberships(): Promise<Result> {
  const session = await awaitAuthReady();
  if (session.status !== 'signed-in' || !session.userId) {
    return { ok: false, error: 'Not signed in.' };
  }
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id, role, is_admin, display_name, households(name)')
    .eq('user_id', session.userId)
    .eq('status', 'active');
  // A newer sign-in overtook this load: its answer belongs to someone else.
  if (useMembershipStore.getState().userId !== session.userId) {
    return { ok: false, error: 'Account changed.' };
  }
  if (error) {
    useMembershipStore.setState({ error: error.message, mineLoaded: true });
    return { ok: false, error: error.message };
  }
  const mine: Record<string, MyMembership> = {};
  for (const row of data ?? []) {
    const household = row.households as unknown as { name: string } | { name: string }[] | null;
    const name = Array.isArray(household) ? household[0]?.name : household?.name;
    mine[row.household_id] = {
      householdId: row.household_id,
      householdName: name ?? 'Household',
      role: row.role as MemberRole,
      isAdmin: Boolean(row.is_admin),
      displayName: row.display_name ?? null,
    };
  }
  useMembershipStore.setState({ mine, mineLoaded: true, error: null });
  return { ok: true };
}

export async function loadHouseholdMembers(householdId: string): Promise<Result> {
  const session = await awaitAuthReady();
  if (session.status !== 'signed-in') return { ok: false, error: 'Not signed in.' };
  const { data, error } = await supabase
    .from('household_members')
    .select(
      'id, user_id, invited_email, role, status, is_admin, display_name, relationship, invited_at, accepted_at, declined_at'
    )
    .eq('household_id', householdId)
    .order('invited_at', { ascending: true });
  if (useMembershipStore.getState().userId !== session.userId) {
    return { ok: false, error: 'Account changed.' };
  }
  if (error) {
    useMembershipStore.setState({ error: error.message });
    return { ok: false, error: error.message };
  }
  const rows: HouseholdMember[] = (data ?? []).map((r) => ({
    id: r.id,
    userId: r.user_id,
    email: r.invited_email,
    role: r.role as MemberRole,
    status: r.status as MembershipStatus,
    isAdmin: Boolean(r.is_admin),
    displayName: r.display_name,
    relationship: r.relationship,
    invitedAt: r.invited_at,
    acceptedAt: r.accepted_at,
    declinedAt: r.declined_at,
  }));
  useMembershipStore.setState((s) => ({ members: { ...s.members, [householdId]: rows }, error: null }));
  return { ok: true };
}

/* ------------------------------------------------------------------ reading */

/** Plain code: my active memberships as last loaded (no network). */
export function myMembershipsSnapshot(): Record<string, MyMembership> {
  return useMembershipStore.getState().mine;
}

/**
 * What kind of household is open, for the local-only answers. Primitive
 * selectors only (see the Zustand selector rule in AGENTS.md).
 */
function useOpenHouseholdKind(): 'demo' | 'local' | 'cloud' | 'none' {
  const isDemo = useStore((s) => s.isDemo);
  const onboarded = useStore((s) => s.onboarded);
  const hid = useStore(linkedCloudId);
  if (isDemo) return 'demo';
  if (!onboarded) return 'none';
  return hid ? 'cloud' : 'local';
}

/** All my active memberships, by household id (stable reference). */
export function useMyMemberships(): Record<string, MyMembership> {
  return useMembershipStore((s) => s.mine);
}

/** My standing in the open household, or undefined if not (yet) known. */
export function useMyMembership(): MyMembership | undefined {
  const hid = useStore(linkedCloudId);
  return useMembershipStore((s) => (hid ? s.mine[hid] : undefined));
}

/**
 * True once it is known what the signed-in person may do in the open
 * household. Screens that route or hide controls by authority should wait for
 * this instead of briefly treating everyone as a helper.
 */
export function useMembershipReady(): boolean {
  const kind = useOpenHouseholdKind();
  const { status } = useSession();
  const loaded = useMembershipStore((s) => s.mineLoaded);
  if (kind === 'demo' || kind === 'local' || kind === 'none') return true;
  if (status === 'signed-out') return true; // locked; nothing to wait for
  return status === 'signed-in' && loaded;
}

/** May the signed-in person keep / donate / let go, and assign heirs, here? */
export function useCanDecide(): boolean {
  const kind = useOpenHouseholdKind();
  const demoRole = useStore((s) => s.demoRole);
  const mine = useMyMembership();
  if (kind === 'demo') return demoRole === 'owner';
  if (kind === 'local') return true;
  return mine ? decides(mine.role) : false;
}

/** Does the signed-in person administer the open household? */
export function useIsAdmin(): boolean {
  const kind = useOpenHouseholdKind();
  const demoRole = useStore((s) => s.demoRole);
  const mine = useMyMembership();
  if (kind === 'demo') return demoRole === 'owner';
  if (kind === 'local') return true;
  return mine?.isAdmin ?? false;
}

const NO_MEMBERS: HouseholdMember[] = [];

/** Every membership row of the open household (stable reference). */
export function useHouseholdMembers(): HouseholdMember[] {
  const hid = useStore(linkedCloudId);
  return useMembershipStore((s) => (hid ? s.members[hid] ?? NO_MEMBERS : NO_MEMBERS));
}

export interface Decider {
  /** null while they haven't joined: they can't yet be an item's main decider. */
  userId: string | null;
  memberId: string;
  name: string;
  joined: boolean;
}

/**
 * The people with the final say in the open household — joined deciders
 * first, then invited ones. Derived with useMemo from the stable member list,
 * never inside a store selector (a selector that builds a new array loops).
 */
export function useDeciders(): Decider[] {
  const members = useHouseholdMembers();
  return useMemo(
    () =>
      members
        .filter((m) => decides(m.role) && m.status !== 'revoked')
        .map((m) => ({
          userId: m.userId,
          memberId: m.id,
          name: memberName(m),
          joined: m.status === 'active',
        }))
        .sort((a, b) => Number(b.joined) - Number(a.joined)),
    [members]
  );
}

/** Load the open household's members when a screen that shows them mounts. */
export function useLoadHouseholdMembers(): void {
  const hid = useStore(linkedCloudId);
  const { status } = useSession();
  useEffect(() => {
    if (hid && status === 'signed-in') void loadHouseholdMembers(hid);
  }, [hid, status]);
}

/* ------------------------------------------------------------------ acting */

function openCloudHousehold(): string | null {
  return linkedCloudId(useStore.getState()) ?? null;
}

type FunctionReply = { ok?: boolean; error?: string; reason?: string; [k: string]: unknown };

async function invokeFunction(name: string, body: Record<string, unknown>): Promise<FunctionReply | null> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return data as FunctionReply | null;
  // supabase-js hides a non-2xx body behind error.context; our functions put
  // the useful reason there.
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.json === 'function') {
    try {
      return (await ctx.json()) as FunctionReply;
    } catch {
      /* fall through */
    }
  }
  return { ok: false, error: error.message };
}

/**
 * Invite someone into the open household. Only owners and administrators may;
 * only an owner may give someone the final say. The server enforces both —
 * this just reports what it said.
 */
export async function inviteToHousehold(input: {
  email: string;
  name?: string;
  relationship?: string;
  role: 'contributor' | 'co_owner';
}): Promise<Result & { alreadyMember?: boolean; alreadyRegistered?: boolean }> {
  const householdId = openCloudHousehold();
  if (!householdId) return { ok: false, error: 'This home isn’t shared yet.' };
  const res = await invokeFunction('invite-member', { householdId, ...input });
  if (!res?.ok) {
    return { ok: false, error: res?.error ?? 'The invitation could not be sent.', reason: res?.reason };
  }
  await loadHouseholdMembers(householdId);
  const r = res as { alreadyMember?: boolean; alreadyRegistered?: boolean };
  return { ok: true, alreadyMember: r.alreadyMember, alreadyRegistered: r.alreadyRegistered };
}

async function updateMember(
  memberId: string,
  patch: Record<string, unknown>,
  refusal: string
): Promise<Result> {
  const householdId = openCloudHousehold();
  if (!householdId) return { ok: false, error: 'This home isn’t shared yet.' };
  const { data, error } = await supabase
    .from('household_members')
    .update(patch)
    .eq('id', memberId)
    .eq('household_id', householdId)
    .select('id');
  await loadHouseholdMembers(householdId);
  if (error) return { ok: false, error: friendly(error.message) };
  // RLS doesn't error on a row you may not touch — it matches nothing. Say so.
  if (!data?.length) return { ok: false, error: refusal };
  return { ok: true };
}

/** Withdraw an invitation, or remove someone who joined. Owners/administrators. */
export const removeFromHousehold = (memberId: string) =>
  updateMember(memberId, { status: 'revoked' }, 'Only an owner or administrator can remove people.');

/** Grant or withdraw administrator standing. Owners/administrators. */
export const setAdministrator = (memberId: string, isAdmin: boolean) =>
  updateMember(memberId, { is_admin: isAdmin }, 'Only an owner or administrator can change who administers this home.');

/** What the family calls someone, and how they're related. */
export const setMemberDetails = (memberId: string, details: { displayName?: string; relationship?: string }) =>
  updateMember(
    memberId,
    {
      ...(details.displayName !== undefined ? { display_name: details.displayName.trim() || null } : {}),
      ...(details.relationship !== undefined ? { relationship: details.relationship.trim() || null } : {}),
    },
    'You can change your own name; an owner or administrator can change anyone’s.'
  );

/** Give the final say to (or take it from) someone who has joined. Owner only. */
export const setMemberRole = (memberId: string, role: 'contributor' | 'co_owner') =>
  updateMember(memberId, { role }, 'Only an owner can change who has the final say.');

/** Turn a database refusal into a sentence a family member can act on. */
function friendly(message: string): string {
  if (/at least one active owner/i.test(message)) return 'A home needs at least one person with the final say.';
  if (/at least one administrator/i.test(message)) return 'A home needs at least one administrator.';
  if (/only the household owner may change roles/i.test(message)) return 'Only an owner can change who has the final say.';
  if (/administrator standing/i.test(message)) return 'Only an owner or administrator can change that.';
  return message;
}

/** Test/diagnostic seam: forget everything (used on account switch and erase). */
export function resetMembership(): void {
  useMembershipStore.setState(EMPTY);
}
