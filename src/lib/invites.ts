/**
 * Invitation email delivery. Called after a decider approves a member whose
 * roster entry has an email. Requires a signed-in session (the edge function
 * verifies the JWT) — without one we return a clear explanation instead of
 * failing silently.
 */

import type { Member } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export async function sendInviteEmail(
  member: Member,
  householdName: string,
  invitedBy: string
): Promise<{ ok: boolean; error?: string; alreadyRegistered?: boolean }> {
  if (!member.email) {
    return { ok: false, error: 'No email on this invitation.' };
  }
  const { data: auth } = await supabase.auth.getSession();
  if (!auth.session) {
    return {
      ok: false,
      error: 'Sign in under Settings → Account & sync first — invitation emails are sent from your account.',
    };
  }
  try {
    const { data, error } = await supabase.functions.invoke('invite-member', {
      body: {
        email: member.email,
        name: member.name,
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
