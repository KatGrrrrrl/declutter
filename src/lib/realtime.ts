/**
 * Realtime bridge — while signed in with a synced household, other family
 * members' chat messages and new items appear live. RLS applies to the
 * subscription, so devices only ever receive rows they're allowed to see.
 * Own writes echo back and are deduped by id in the store.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

let channel: RealtimeChannel | null = null;
let activeFor: string | null = null;

export function startRealtime(cloudHouseholdId: string) {
  if (activeFor === cloudHouseholdId && channel) return;
  stopRealtime();
  activeFor = cloudHouseholdId;

  channel = supabase
    .channel(`household-${cloudHouseholdId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'item_messages' },
      (payload) => {
        const r = payload.new as {
          id: string;
          item_id: string;
          author_name: string;
          body: string;
          created_at: string;
        };
        useStore.getState().applyRemoteMessage({
          id: r.id,
          itemId: r.item_id,
          author: r.author_name,
          text: r.body,
          createdAt: r.created_at,
        });
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'items',
        filter: `household_id=eq.${cloudHouseholdId}`,
      },
      (payload) => {
        const r = payload.new as {
          id: string;
          title: string | null;
          room: string | null;
          decision: 'undecided' | 'keep' | 'donate' | 'toss';
          decided_at: string | null;
          is_sentimental: boolean;
          market_value_cents: number | null;
          donate_to: string | null;
          donate_to_kind: 'charity' | 'person' | null;
          created_at: string;
        };
        useStore.getState().applyRemoteItem({
          id: r.id,
          title: r.title ?? 'New item',
          room: r.room ?? 'Elsewhere',
          decision: r.decision,
          decidedAt: r.decided_at ?? undefined,
          tags: [],
          addedBy: 'Family',
          isSentimental: r.is_sentimental,
          marketValue: r.market_value_cents != null ? r.market_value_cents / 100 : undefined,
          donateTo: r.donate_to ?? undefined,
          donateToKind: r.donate_to_kind ?? undefined,
          heirVisibility: 'owner_only',
          createdAt: r.created_at,
        });
      }
    )
    .subscribe();
}

export function stopRealtime() {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  activeFor = null;
}
