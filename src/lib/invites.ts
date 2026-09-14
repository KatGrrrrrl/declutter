/**
 * Invitation email delivery. Called after a decider approves a member whose
 * roster entry has an email. Requires a signed-in session (the edge function
 * verifies the JWT) — without one we return a clear explanation instead of
 * failing silently.
 */

import { awaitAuthReady } from '@/lib/auth';
import type { Member } from '@/lib/store';
import { linkedCloudId, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export async function sendInviteEmail(
  member: Member,
  householdName: string,
  invitedBy: string
): Promise<{ ok: boolean; error?: string; alreadyRegistered?: boolean }> {
  if (!member.email) {
    return { ok: false, error: 'No email on this invitation.' };
  }
  if ((await awaitAuthReady()).status !== 'signed-in') {
    return {
      ok: false,
      error: 'Sign in under Settings → Account & sync first — invitation emails are sent from your account.',
    };
  }
  // The server now creates the invitation itself and checks the caller may
  // invite into THIS household, so it needs to know which one — and whether
  // the person is being given the final say, which only an owner may grant.
  const s = useStore.getState();
  const householdId = linkedCloudId(s);
  if (!householdId) {
    return { ok: false, error: 'Back up the household first (Settings → Account & sync).' };
  }
  const deciders = s.households.find((h) => h.id === s.activeHouseholdId)?.deciderNames ?? [];
  const isDecider = deciders.some((d) => d.toLowerCase() === member.name.toLowerCase());
  try {
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        householdId,
        email: member.email,
        name: member.name,
        relationship: member.relationship,
        role: isDecider ? 'co_owner' : 'contributor',
        // Kept for older deployments of the function during the rollout.
        householdName,
        invitedBy,
      },
    });
    if (error) return { ok: false, error: error.message };
    if (!data?.ok) return { ok: false, error: data?.error ?? 'The invitation could not be sent.' };
    return { ok: true, alreadyRegistered: data.alreadyRegistered };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
