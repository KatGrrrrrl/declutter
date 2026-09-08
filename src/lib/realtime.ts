/**
 * Realtime bridge — while signed in with a synced household, other family
 * members' chat messages and new items appear live. RLS applies to the
 * subscription, so devices only ever receive rows they're allowed to see.
 * Own writes echo back and are deduped by id in the store.
 */

import type { RealtimeChannel } from '@supabase/supabase-js';

import { usePresence } from '@/lib/presence';
import { selectViewerName, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import type { PresentPerson } from '@/lib/presence';

/** What each device announces on the household's presence channel. */
interface PresenceMeta {
  uid: string;
  name: string;
}

/** The `items` columns realtime replicates. */
interface ItemRow {
  id: string;
  title: string | null;
  room: string | null;
  decision: 'undecided' | 'keep' | 'donate' | 'toss';
  decided_at: string | null;
  is_sentimental: boolean;
  market_value_cents: number | null;
  donate_to: string | null;
  donate_to_kind: 'charity' | 'person' | null;
  archived: boolean | null;
  created_at: string;
}

let channel: RealtimeChannel | null = null;
let activeFor: string | null = null;

export function startRealtime(cloudHouseholdId: string) {
  if (activeFor === cloudHouseholdId && channel) return;
  stopRealtime();
  activeFor = cloudHouseholdId;
  // Presence needs to know who "me" is; the session is already resolved by
  // the time CloudBridge calls this, so the async hop is cheap. If the
  // household changed while we waited, the newer call wins.
  void supabase.auth.getSession().then(({ data }) => {
    if (activeFor !== cloudHouseholdId || channel) return;
    openChannel(cloudHouseholdId, data.session?.user.id);
  });
}

function openChannel(cloudHouseholdId: string, myUid: string | undefined) {
  const me: PresenceMeta = { uid: myUid ?? 'anon', name: selectViewerName(useStore.getState()) };

  channel = supabase
    .channel(`household-${cloudHouseholdId}`, { config: { presence: { key: me.uid } } })
    // Who else has this household open. Keyed by user id, so the same person
    // on a phone AND a laptop shows once — and never shows to themselves.
    .on('presence', { event: 'sync' }, () => {
      if (!channel) return;
      const seen = new Map<string, PresentPerson>();
      for (const metas of Object.values(channel.presenceState<PresenceMeta>())) {
        for (const p of metas) {
          if (p.uid && p.uid !== me.uid && !seen.has(p.uid)) {
            seen.set(p.uid, { uid: p.uid, name: p.name || 'Someone' });
          }
        }
      }
      usePresence.getState().setOthers([...seen.values()]);
    })
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
    // One listener for every item change. INSERT and UPDATE both merge (the
    // store upserts); DELETE removes it. `event: '*'` keeps the three in step
    // so an edit made on another device can't be missed.
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'items',
        filter: `household_id=eq.${cloudHouseholdId}`,
      },
      (payload) => {
        const store = useStore.getState();

        if (payload.eventType === 'DELETE') {
          // Deletes replicate the old row (items is REPLICA IDENTITY FULL, so
          // the household filter and RLS still apply).
          const gone = payload.old as { id?: string };
          if (gone?.id) store.applyRemoteItemDelete(gone.id);
          return;
        }

        const r = payload.new as ItemRow;
        store.applyRemoteItem({
          id: r.id,
          title: r.title ?? 'New item',
          room: r.room ?? 'Elsewhere',
          decision: r.decision,
          decidedAt: r.decided_at ?? undefined,
          isSentimental: r.is_sentimental,
          marketValue: r.market_value_cents != null ? r.market_value_cents / 100 : undefined,
          donateTo: r.donate_to ?? undefined,
          donateToKind: r.donate_to_kind ?? undefined,
          archived: r.archived ?? false,
          createdAt: r.created_at,
        });
      }
    )
    .subscribe((status) => {
      // Announce ourselves once the socket is up; re-announce on reconnect.
      if (status === 'SUBSCRIBED') void channel?.track(me);
    });
}

export function stopRealtime() {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
  activeFor = null;
  usePresence.getState().clear();
}
