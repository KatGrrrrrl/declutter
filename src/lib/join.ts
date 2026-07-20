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
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';
import { pullHousehold } from '@/lib/sync';

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
  const user = auth?.user;
  if (!user) return { ok: false, error: 'Not signed in.' };

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

  const pulled = await pullHousehold(householdId);
  if (!pulled.ok || !pulled.snapshot) {
    return { ok: false, error: pulled.error ?? 'Joined, but the household could not be loaded.' };
  }

  const myEmail = (user.email ?? '').toLowerCase();
  const me = pulled.snapshot.members.find((m) => (m.email ?? '').toLowerCase() === myEmail);
  const userName = me?.name ?? user.email?.split('@')[0] ?? 'Me';
  const isDecider = pulled.snapshot.deciderNames.some(
    (d) => d.toLowerCase() === userName.toLowerCase()
  );

  useStore.getState().restoreSnapshot({
    ...pulled.snapshot,
    role: isDecider ? 'owner' : 'contributor',
    userName,
  });

  return { ok: true, householdName: pulled.snapshot.householdName };
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
  if (!s.cloudHouseholdId) {
    return { ok: false, error: 'Back up the household first (Settings → Account & sync).' };
  }
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return { ok: false, error: 'Sign in first (Settings → Account & sync).' };

  const email = member.email.toLowerCase();
  const { data: existing } = await supabase
    .from('household_members')
    .select('id, status')
    .eq('household_id', s.cloudHouseholdId)
    .eq('invited_email', email)
    .maybeSingle();
  if (existing) return { ok: true }; // already invited/joined

  const isDecider = (s.households.find((h) => h.id === s.activeHouseholdId)?.deciderNames ?? [])
    .some((d) => d.toLowerCase() === member.name.toLowerCase());

  const { error } = await supabase.from('household_members').insert({
    household_id: s.cloudHouseholdId,
    invited_email: email,
    role: isDecider ? 'co_owner' : 'contributor',
    status: 'invited',
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
