/**
 * SplitReview — approval pass after a group photo is split by AI.
 *
 * The picture taker sees one row per proposed object (cropped photo + editable
 * name) and approves each individually or all at once; only approved rows
 * become items. Rooms come from the capture screen's current room chip. A
 * decider's additions auto-mark Keep, matching the capture flow.
 */

import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { notify } from '@/components/child/shared';
import { Btn, Heading, Label, Muted } from '@/components/ui';
import { Radius, Spacing, T } from '@/constants/theme';
import { pingItemAdded } from '@/lib/notifications';
import { uploadItemPhoto } from '@/lib/photo-sync';
import { pushItem } from '@/lib/sync';
import { linkedCloudId, useCanDecide, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import type { ProposedItem } from '@/lib/split-photo';

interface Row extends ProposedItem {
  approved: boolean;
}

export function SplitReview({
  proposals,
  room,
  onClose,
}: {
  proposals: ProposedItem[];
  room: string;
  /** Called when the review ends, with how many items were added (0 = cancelled). */
  onClose: (added: number) => void;
}) {
  const addItem = useStore((s) => s.addItem);
  const userName = useStore((s) => s.userName);
  const canDecide = useCanDecide();
  const [rows, setRows] = useState<Row[]>(() =>
    proposals.map((p) => ({ ...p, approved: false }))
  );

  const approvedCount = rows.filter((r) => r.approved).length;
  const allApproved = approvedCount === rows.length;

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const addApproved = () => {
    let added = 0;
    for (const r of rows) {
      if (!r.approved) continue;
      const res = addItem({
        title: r.name.trim() || 'New item',
        room,
        photoUri: r.photoUri,
        addedBy: userName,
        tags: [],
        ...(canDecide ? { decision: 'keep' as const, decidedAt: new Date().toISOString() } : null),
      });
      if (!res.ok) break;
      added += 1;
      // Same fire-and-forget cloud upload as capture, per item.
      const s = useStore.getState();
      const hid = linkedCloudId(s);
      if (hid) {
        const fresh = s.items[0];
        if (fresh && !fresh.localOnly) {
          // Item first, so the rest of the family sees it without a backup;
          // the instant-email ping follows only once it's really there.
          void pushItem(fresh, hid)
            .then((r) => {
              if (r.ok) pingItemAdded(fresh);
            })
            .catch(() => {});
          if (fresh.photoUri === r.photoUri) {
            supabase.auth
              .getSession()
              .then(({ data }) => {
                if (data.session) return uploadItemPhoto(fresh);
              })
              .catch(() => {});
          }
        }
      }
    }
    if (added > 0) {
      notify(
        'Added to the inventory',
        `${added} item${added === 1 ? '' : 's'} from one photo · in ${room}.`
      );
    }
    onClose(added);
  };

  return (
    <View>
      <Label>One photo · {rows.length} items found</Label>
      <Heading style={styles.heading}>Approve what should be catalogued</Heading>
      <Muted style={styles.sub}>
        Fix a name if it guessed wrong — only what you approve is added, filed
        under {room}.
      </Muted>

      <View style={styles.list}>
        {rows.map((r, i) => (
          <View key={i} style={[styles.row, r.approved && styles.rowOn]}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: r.approved }}
              accessibilityLabel={`Approve ${r.name}`}
              onPress={() => setRow(i, { approved: !r.approved })}
              style={styles.check}
              hitSlop={8}
            >
              <Ionicons
                name={r.approved ? 'checkbox' : 'square-outline'}
                size={24}
                color={r.approved ? T.brass : T.inkFaint}
              />
            </Pressable>
            <Image source={{ uri: r.photoUri }} style={styles.thumb} contentFit="cover" />
            <TextInput
              style={styles.name}
              value={r.name}
              onChangeText={(name) => setRow(i, { name })}
              aria-label={`Name for item ${i + 1}`}
              selectTextOnFocus
            />
          </View>
        ))}
      </View>

      <View style={styles.actions}>
        <Btn
          label={allApproved ? 'Unselect all' : 'Approve all'}
          kind="quiet"
          onPress={() => setRows((rs) => rs.map((r) => ({ ...r, approved: !allApproved })))}
        />
        <Btn
          label={approvedCount > 0 ? `Add ${approvedCount} item${approvedCount === 1 ? '' : 's'}` : 'Nothing approved yet'}
          big
          disabled={approvedCount === 0}
          onPress={addApproved}
        />
        <Pressable
          accessibilityRole="button"
          onPress={() => onClose(0)}
          style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
        >
          <Text style={styles.cancelText}>Cancel — keep the group photo instead</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: 4 },
  sub: { marginTop: 4, marginBottom: Spacing.three, fontSize: 14, lineHeight: 20 },
  list: { gap: Spacing.two },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.control,
    padding: Spacing.two,
    backgroundColor: T.surface,
  },
  rowOn: { borderColor: T.brass, backgroundColor: T.brassTint },
  check: { padding: 2 },
  thumb: { width: 52, height: 52, borderRadius: 10, backgroundColor: T.sunken },
  name: {
    flex: 1,
    fontSize: 15,
    color: T.ink,
    borderBottomWidth: 1,
    borderBottomColor: T.lineSoft,
    paddingVertical: 6,
  },
  actions: { gap: 10, marginTop: Spacing.three },
  cancel: { alignItems: 'center', paddingVertical: 10 },
  cancelText: { fontSize: 13.5, fontWeight: '600', color: T.inkSoft },
  pressed: { opacity: 0.7 },
});
