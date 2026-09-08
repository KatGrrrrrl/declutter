/**
 * Household joining — the invited person's side of the invitation flow.
 *
 * Discovery: my_pending_invites() (SECURITY DEFINER) lists households whose
 * invitation email matches the signed-in user's verified JWT email.
 * Acceptance: the 0001 accept_invite() RPC flips their membership to active
 * (server-validated against the same email), after which normal RLS opens the
 * household and we pull it into local state as a contributor.
 *
 * The other side: createCloudInvite() is called when a decider approves a
 * member locally — it creates the cloud membership row the invitee will find.
 */

import type { Member } from '@/lib/store';
import { linkedCloudId, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { listMyHouseholds, pullHousehold } from '@/lib/sync';

import type { User } from '@supabase/supabase-js';
import type { CloudHouseholdSummary, PullResult } from '@/lib/sync';

/**
 * Put a pulled household into local state as THIS user. Their display name
 * is whatever the roster calls the person with their email (that's who the
 * family invited or backed up), falling back to the email's local part; they
 * decide if that name is one of the household's deciders.
 */
function adoptSnapshot(snapshot: NonNullable<PullResult['snapshot']>, user: User) {
  const myEmail = (user.email ?? '').toLowerCase();
  const me = snapshot.members.find((m) => (m.email ?? '').toLowerCase() === myEmail);
  const userName = me?.name ?? user.email?.split('@')[0] ?? 'Me';
  const isDecider = snapshot.deciderNames.some(
    (d) => d.toLowerCase() === userName.toLowerCase()
  );
  useStore.getState().restoreSnapshot({
    ...snapshot,
    role: isDecider ? 'owner' : 'contributor',
    userName,
  });
}

/**
 * Which cloud household to bring onto this device when the account belongs
 * to several: the one already open here, if the account is a member of it —
 * a device restoring after its duplicate was merged away, or a desktop that
 * is already linked. Otherwise ask. Never the oldest: that guess put a member
 * of two homes in the wrong house.
 */
export async function pickMyHousehold(): Promise<{
  id?: string;
  choices?: CloudHouseholdSummary[];
  /** The account has no backup at all. */
  none?: boolean;
  error?: string;
}> {
  const mine = await listMyHouseholds();
  if (!mine.ok) return { error: mine.error };
  if (!mine.households.length) return { none: true };
  if (mine.households.length === 1) return { id: mine.households[0].id };
  const open = useStore.getState().activeHouseholdId;
  if (mine.households.some((h) => h.id === open)) return { id: open };
  return { choices: mine.households };
}

/** Bring one specific cloud household onto this device, as this user. */
export async function loadHouseholdById(
  householdId: string
): Promise<{ ok: boolean; householdName?: string; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  const user = auth?.user;
  if (!user) return { ok: false, error: 'Not signed in.' };

  const pulled = await pullHousehold(householdId);
  if (!pulled.ok || !pulled.snapshot) {
    return { ok: false, error: pulled.error ?? 'The household could not be loaded.' };
  }
  adoptSnapshot(pulled.snapshot, user);
  return { ok: true, householdName: pulled.snapshot.householdName };
}

/**
 * Sign-in on a device with no home yet (or only the demo): bring the
 * account's household down so "Already set up a home? Sign in" actually
 * lands in it. ok:false with neither error nor choices means the account has
 * no backup yet — offer onboarding. `choices` means it has several homes:
 * show them and call loadHouseholdById with the pick.
 */
export async function loadMyHousehold(): Promise<{
  ok: boolean;
  householdName?: string;
  choices?: CloudHouseholdSummary[];
  error?: string;
}> {
  const picked = await pickMyHousehold();
  if (picked.error) return { ok: false, error: picked.error };
  if (picked.none) return { ok: false };
  if (picked.choices) return { ok: false, choices: picked.choices };
  return loadHouseholdById(picked.id!);
}

export interface PendingInvite {
  householdId: string;
  householdName: string;
  invitedAt: string;
}

export async function listPendingInvites(): Promise<PendingInvite[]> {
  const { data, error } = await supabase.rpc('my_pending_invites');
  if (error || !data) return [];
  return (data as { household_id: string; household_name: string; invited_at: string }[]).map(
    (r) => ({
      householdId: r.household_id,
      householdName: r.household_name,
      invitedAt: r.invited_at,
    })
  );
}

/**
 * Accept an invitation and load the household onto this device as a helper.
 * The joiner's display name comes from the roster entry that carries their
 * email (that's who the family invited), falling back to their email name.
 */
export async function acceptInvite(
  householdId: string
): Promise<{ ok: boolean; householdName?: string; error?: string }> {
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'Not signed in.' };

  const { error: rpcErr } = await supabase.rpc('accept_invite', {
    p_household_id: householdId,
  });
  if (rpcErr) {
    // Older deployments may name the arg differently; try the bare form.
    const { error: retryErr } = await supabase.rpc('accept_invite', {
      household_id: householdId,
    });
    if (retryErr) return { ok: false, error: rpcErr.message };
  }

  const loaded = await loadHouseholdById(householdId);
  return loaded.ok
    ? loaded
    : { ok: false, error: `Joined, but ${loaded.error ?? 'the household could not be loaded.'}` };
}

/**
 * Decider side: mirror an approved local member into a cloud membership
 * invitation, so the person can actually join when they sign in.
 * Requires the caller to be signed in and the household backed up.
 */
export async function createCloudInvite(
  member: Member
): Promise<{ ok: boolean; error?: string }> {
  const s = useStore.getState();
  if (!member.email) return { ok: false, error: 'No email on the invitation.' };
  const cloudHouseholdId = linkedCloudId(s);
  if (!cloudHouseholdId) {
    return { ok: false, error: 'Back up the household first (Settings → Account & sync).' };
  }
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'Sign in first (Settings → Account & sync).' };

  const email = member.email.toLowerCase();
  const { data: existing } = await supabase
    .from('household_members')
    .select('id, status')
    .eq('household_id', cloudHouseholdId)
    .eq('invited_email', email)
    .maybeSingle();
  if (existing) return { ok: true }; // already invited/joined

  const isDecider = (s.households.find((h) => h.id === s.activeHouseholdId)?.deciderNames ?? [])
    .some((d) => d.toLowerCase() === member.name.toLowerCase());

  const { error } = await supabase.from('household_members').insert({
    household_id: cloudHouseholdId,
    invited_email: email,
    role: isDecider ? 'co_owner' : 'contributor',
    status: 'invited',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
