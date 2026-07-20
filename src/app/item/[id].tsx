/**
 * Item detail — role-aware.
 *
 * Owner sees everything: photo, decision, the story (play + re-record), the
 * heir picker with per-item visibility, and the value row. A contributor
 * sees the photo, story (read and record), and a "Request this item" button —
 * never heir information or value. Voice recording uses expo-audio
 * (degraded to a friendly note on web).
 */

import { Ionicons } from '@expo/vector-icons';
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DonateTo } from '@/components/donate-to';
import { ItemChat } from '@/components/item-chat';
import { ROOMS } from '@/components/child/shared';
import { Avatar, VISIBILITY_META, formatDuration } from '@/components/parent/bits';
import {
  Btn,
  DecisionPill,
  Label,
  Muted,
  PhotoBox,
  Row,
  Screen,
  Tag,
  Well,
} from '@/components/ui';
import { Fonts, Spacing, T } from '@/constants/theme';
import { pickPhoto, uploadItemPhoto } from '@/lib/photo-sync';
import { useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

import type { HeirVisibility } from '@/lib/store';

const VISIBILITY_ORDER: HeirVisibility[] = ['owner_only', 'after_death', 'revealed'];
const CAN_RECORD = Platform.OS !== 'web';

export default function ItemDetailScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const item = useStore((s) => s.items.find((i) => i.id === id));
  const role = useStore((s) => s.role);
  const people = useStore((s) => s.people);
  const userName = useStore((s) => s.userName);
  const ownerName = useStore((s) => s.ownerName);
  const setStory = useStore((s) => s.setStory);
  const assignHeir = useStore((s) => s.assignHeir);
  const updateItem = useStore((s) => s.updateItem);
  const removeItem = useStore((s) => s.removeItem);
  const requestItem = useStore((s) => s.requestItem);

  const isOwner = role === 'owner';
  const story = item?.story;

  /**
   * Who may edit/remove this record: deciders always; the capturer while the
   * item is still undecided (fixing their own batch mistakes). Matches the
   * cloud RLS exactly. Deciding itself stays owner-only.
   */
  const canManage = Boolean(
    item && (isOwner || (item.addedBy === userName && item.decision === 'undecided'))
  );

  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editRoom, setEditRoom] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const startEdit = () => {
    if (!item) return;
    setEditTitle(item.title);
    setEditRoom(item.room);
    setEditing(true);
  };

  const saveEdit = () => {
    if (!item) return;
    const title = editTitle.trim() || item.title;
    updateItem(item.id, { title, room: editRoom || item.room });
    setEditing(false);
    // Mirror the rename to the cloud so family devices catch up on next pull.
    const s = useStore.getState();
    if (s.cloudHouseholdId && !s.isDemo && !item.localOnly) {
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) {
          void supabase.from('items').update({ title, room: editRoom || item.room }).eq('id', item.id);
        }
      }).catch(() => {});
    }
  };

  const doRemove = () => {
    if (!item) return;
    removeItem(item.id);
    router.back();
  };

  /** Photo-first default: any photo-less item can gain one, from any role. */
  const addPhoto = async () => {
    if (!item) return;
    const uri = await pickPhoto();
    if (!uri) return;
    updateItem(item.id, { photoUri: uri });
    // Same fire-and-forget cloud upload as capture, when linked.
    const s = useStore.getState();
    if (s.cloudHouseholdId && !item.localOnly) {
      supabase.auth
        .getSession()
        .then(({ data }) => {
          if (data.session) {
            const fresh = useStore.getState().items.find((i) => i.id === item.id);
            if (fresh?.photoUri === uri) return uploadItemPhoto(fresh);
          }
        })
        .catch(() => {});
    }
  };

  /* ---- playback ---- */
  const player = useAudioPlayer(null);
  const playerStatus = useAudioPlayerStatus(player);
  useEffect(() => {
    if (story?.audioUri) {
      try {
        player.replace(story.audioUri);
      } catch {
        // playback unavailable on this platform — transcript still shows
      }
    }
  }, [story?.audioUri, player]);

  const togglePlay = () => {
    try {
      if (playerStatus.playing) {
        player.pause();
      } else {
        if (playerStatus.didJustFinish) player.seekTo(0);
        player.play();
      }
    } catch {
      // ignore — audio not available here
    }
  };

  /* ---- recording ---- */
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(recorder, 500);
  const [isRecording, setIsRecording] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  const startRecording = async () => {
    if (!CAN_RECORD || isRecording) return;
    setRecError(null);
    try {
      const perm = await AudioModule.requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setRecError(
          'Microphone permission is off. You can turn it on in Settings.'
        );
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setIsRecording(true);
      if (Platform.OS !== 'web') {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      }
    } catch {
      setRecError("Recording couldn't start. Please try again.");
      setIsRecording(false);
    }
  };

  const stopRecording = async () => {
    if (!item) return;
    const durationSec = Math.max(
      1,
      Math.round(recorderState.durationMillis / 1000)
    );
    try {
      await recorder.stop();
    } catch {
      // keep whatever was captured
    }
    setIsRecording(false);
    try {
      await setAudioModeAsync({ allowsRecording: false });
    } catch {
      // non-fatal
    }
    setStory(item.id, {
      transcript: '(Transcription coming soon — your voice is saved with this piece.)',
      audioUri: recorder.uri ?? undefined,
      durationSec,
      createdAt: new Date().toISOString(),
    });
  };

  /* ---- value ---- */
  const [valueText, setValueText] = useState(
    item?.marketValue != null ? String(item.marketValue) : ''
  );
  const onValueChange = (text: string) => {
    setValueText(text);
    if (!item) return;
    const n = parseFloat(text.replace(/[^0-9.]/g, ''));
    updateItem(item.id, { marketValue: Number.isFinite(n) ? n : undefined });
  };

  if (!item) {
    return (
      <Screen>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={20} color={T.inkSoft} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <Muted style={styles.missing}>
          This item isn&rsquo;t here anymore.
        </Muted>
      </Screen>
    );
  }

  const heir = people.find((p) => p.id === item.heirPersonId);
  const alreadyRequested = item.requestedBy === userName;

  return (
    <Screen>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={() => router.back()}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}
      >
        <Ionicons name="chevron-back" size={20} color={T.inkSoft} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>

      <PhotoBox
        title={item.title}
        photoUri={item.photoUri}
        remotePath={item.remotePhotoPath}
        height={210}
        radius={20}
      />
      {/* Items default to having a photo — offer the fix wherever one's missing. */}
      {!item.photoUri && !item.remotePhotoPath && (
        <Pressable
          accessibilityRole="button"
          onPress={addPhoto}
          style={({ pressed }) => [styles.addPhotoBtn, pressed && styles.pressed]}
        >
          <Ionicons name="camera-outline" size={17} color={T.brassDeep} />
          <Text style={styles.addPhotoText}>Add a photo</Text>
        </Pressable>
      )}

      <Row style={styles.stateRow}>
        <DecisionPill decision={item.decision} />
        <View style={styles.roomChip}>
          <Text style={styles.roomText}>{item.room}</Text>
        </View>
      </Row>
      {/* Donation destination — part of the decision, so only deciders edit. */}
      <DonateTo item={item} canEdit={isOwner} />
      {editing ? (
        <View style={styles.editBox}>
          <Label style={styles.editLabel}>Name</Label>
          <TextInput
            style={styles.editInput}
            value={editTitle}
            onChangeText={setEditTitle}
            selectTextOnFocus
            returnKeyType="done"
            onSubmitEditing={saveEdit}
          />
          <Label>Room</Label>
          <Row style={styles.editRooms}>
            {ROOMS.map((r) => (
              <Pressable
                key={r}
                accessibilityRole="button"
                onPress={() => setEditRoom(r)}
                style={[styles.editRoomChip, r === editRoom && styles.editRoomChipOn]}
              >
                <Text
                  style={[styles.editRoomText, r === editRoom && styles.editRoomTextOn]}
                >
                  {r}
                </Text>
              </Pressable>
            ))}
          </Row>
          <Row style={styles.editActions}>
            <View style={styles.flexOne}>
              <Btn label="Save changes" onPress={saveEdit} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setEditing(false)}
              style={styles.editCancel}
            >
              <Text style={styles.editCancelText}>Cancel</Text>
            </Pressable>
          </Row>
        </View>
      ) : (
        <Row style={styles.titleRow}>
          <Text style={[styles.itemTitle, styles.flexOne]}>{item.title}</Text>
          {canManage && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit name and room"
              onPress={startEdit}
              style={({ pressed }) => [styles.editBtn, pressed && styles.pressed]}
            >
              <Ionicons name="pencil-outline" size={17} color={T.inkSoft} />
            </Pressable>
          )}
        </Row>
      )}
      {item.tags.length > 0 ? (
        <Row style={styles.tagRow}>
          {item.tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </Row>
      ) : null}
      {isOwner && item.requestedBy ? (
        <Muted style={styles.requestedNote}>
          {item.requestedBy} has quietly asked about this one.
        </Muted>
      ) : null}

      {/* ---- The story ---- */}
      <Label>The story</Label>
      {story ? (
        <Well style={styles.storyWell}>
          <Row style={styles.playRow}>
            {story.audioUri ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={playerStatus.playing ? 'Pause story' : 'Play story'}
                onPress={togglePlay}
                style={({ pressed }) => [styles.playBtn, pressed && styles.pressed]}
              >
                <Ionicons
                  name={playerStatus.playing ? 'pause' : 'play'}
                  size={20}
                  color="#FFFFFF"
                />
              </Pressable>
            ) : (
              <View style={[styles.playBtn, styles.playBtnQuiet]}>
                <Ionicons name="chatbox-ellipses-outline" size={18} color={T.brassDeep} />
              </View>
            )}
            {story.durationSec ? (
              <Text style={styles.duration}>
                {formatDuration(story.durationSec)}
              </Text>
            ) : null}
          </Row>
          <Text style={styles.transcript}>&ldquo;{story.transcript}&rdquo;</Text>
          <Muted style={styles.storyMeta}>
            {story.audioUri
              ? 'Recorded in your family’s voice'
              : 'Saved with this piece'}
          </Muted>
        </Well>
      ) : (
        <Muted style={styles.noStory}>
          No story yet. It only takes a minute — and it&rsquo;s the part that
          lasts.
        </Muted>
      )}

      {isRecording ? (
        <Well style={styles.recWell}>
          <Row style={styles.recRow}>
            <View style={styles.recDot} />
            <Text style={styles.recTime}>
              {formatDuration(recorderState.durationMillis / 1000)}
            </Text>
            <Muted style={styles.recHint}>Listening… take your time.</Muted>
          </Row>
          <Btn label="Stop and save" kind="primary" big onPress={stopRecording} />
        </Well>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={story ? 'Record the story again' : 'Record a story'}
          disabled={!CAN_RECORD}
          onPress={startRecording}
          style={({ pressed }) => [
            styles.recordBtn,
            pressed && styles.pressed,
            !CAN_RECORD && styles.recordBtnDisabled,
          ]}
        >
          <Ionicons name="mic-outline" size={22} color="#FFFFFF" />
          <Text style={styles.recordBtnText}>
            {story ? 'Record it again' : 'Record a story'}
          </Text>
        </Pressable>
      )}
      {!CAN_RECORD ? (
        <Muted style={styles.webNote}>
          Recording works in the app on a phone or tablet — stories are
          listen-only on the web.
        </Muted>
      ) : null}
      {recError ? <Muted style={styles.recError}>{recError}</Muted> : null}

      {isOwner ? (
        <>
          {/* ---- Who gets this? ---- */}
          <Label>Who gets this?</Label>
          <View style={styles.peopleList}>
            {people.map((person) => {
              const selected = item.heirPersonId === person.id;
              return (
                <Pressable
                  key={person.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${person.displayName}, ${person.relationship}`}
                  accessibilityState={{ selected }}
                  onPress={() =>
                    selected
                      ? assignHeir(item.id, undefined, 'owner_only')
                      : assignHeir(item.id, person.id, item.heirVisibility)
                  }
                  style={({ pressed }) => [
                    styles.personRow,
                    selected && styles.personRowSelected,
                    pressed && styles.pressed,
                  ]}
                >
                  <Avatar name={person.displayName} size={40} />
                  <View style={styles.personMain}>
                    <Text style={styles.personName}>{person.displayName}</Text>
                    <Muted style={styles.personRel}>{person.relationship}</Muted>
                  </View>
                  <Ionicons
                    name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                    size={26}
                    color={selected ? T.brass : T.line}
                  />
                </Pressable>
              );
            })}
          </View>

          {heir ? (
            <View style={styles.visList}>
              {VISIBILITY_ORDER.map((vis) => {
                const meta = VISIBILITY_META[vis];
                const checked = item.heirVisibility === vis;
                const label =
                  vis === 'revealed' ? `Reveal to ${heir.displayName} now` : meta.label;
                return (
                  <Pressable
                    key={vis}
                    accessibilityRole="radio"
                    accessibilityState={{ checked }}
                    onPress={() => assignHeir(item.id, heir.id, vis)}
                    style={({ pressed }) => [
                      styles.visOpt,
                      checked && styles.visOptChecked,
                      pressed && styles.pressed,
                    ]}
                  >
                    <View style={[styles.radio, checked && styles.radioChecked]}>
                      {checked ? <View style={styles.radioDot} /> : null}
                    </View>
                    <View style={styles.visMain}>
                      <Text style={styles.visLabel}>{label}</Text>
                      <Muted style={styles.visHint}>{meta.hint}</Muted>
                    </View>
                    <Ionicons name={meta.icon} size={18} color={T.inkFaint} />
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Muted style={styles.visNote}>
              Choose someone above — it stays private to you until you say
              otherwise.
            </Muted>
          )}

          {/* ---- Value ---- */}
          <Label>Value</Label>
          <Row style={styles.valueRow}>
            <View style={styles.valueInputWrap}>
              <Text style={styles.dollar}>$</Text>
              <TextInput
                value={valueText}
                onChangeText={onValueChange}
                placeholder="Market value"
                placeholderTextColor={T.inkFaint}
                keyboardType="decimal-pad"
                style={styles.valueInput}
                accessibilityLabel="Market value in dollars"
              />
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sentimental"
              accessibilityState={{ selected: item.isSentimental }}
              onPress={() =>
                updateItem(item.id, { isSentimental: !item.isSentimental })
              }
              style={({ pressed }) => [
                styles.heartBtn,
                item.isSentimental && styles.heartBtnOn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons
                name={item.isSentimental ? 'heart' : 'heart-outline'}
                size={22}
                color={T.toss}
              />
              <Text style={styles.heartLbl}>Sentimental</Text>
            </Pressable>
          </Row>
        </>
      ) : null}

      {/* ---- Family chat — the whole household sees this thread ---- */}
      <View style={styles.chatBlock}>
        <ItemChat itemId={item.id} />
      </View>

      {!isOwner ? (
        <>
          {/* ---- Contributor: request ---- */}
          <View style={styles.requestBlock}>
            {alreadyRequested ? (
              <View style={styles.requestedChip}>
                <Ionicons name="checkmark-circle" size={20} color={T.keep} />
                <Text style={styles.requestedText}>
                  Requested — {ownerName} will see this quietly.
                </Text>
              </View>
            ) : (
              <Btn
                label="Request this item"
                kind="primary"
                big
                onPress={() => requestItem(item.id, userName)}
              />
            )}
            <Muted style={styles.requestNote}>
              Only {ownerName} sees requests — never your siblings.
            </Muted>
          </View>
        </>
      ) : null}

      {/* ---- Remove — deciders always; the capturer while undecided ---- */}
      {canManage && (
        <View style={styles.removeBlock}>
          {confirmRemove ? (
            <>
              <Btn label="Yes — remove this item" kind="brass" onPress={doRemove} />
              <Pressable
                accessibilityRole="button"
                onPress={() => setConfirmRemove(false)}
                style={styles.removeCancel}
              >
                <Text style={styles.removeCancelText}>Keep it</Text>
              </Pressable>
            </>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={() => setConfirmRemove(true)}
              style={({ pressed }) => [styles.removeLink, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={15} color={T.toss} />
              <Text style={styles.removeText}>Remove this item</Text>
            </Pressable>
          )}
          {confirmRemove && (
            <Muted style={styles.removeNote}>
              This removes the item, its photo, and its chat for the whole
              household.
            </Muted>
          )}
        </View>
      )}

      <View style={styles.bottomSpace} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  back: {
    marginTop: Spacing.two,
    marginBottom: Spacing.two,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingRight: Spacing.three,
  },
  backText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  missing: { marginTop: Spacing.four, fontSize: 15, textAlign: 'center' },

  stateRow: { marginTop: Spacing.three, gap: Spacing.two },
  roomChip: {
    backgroundColor: T.sunken,
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 12,
  },
  roomText: { fontSize: 12, fontWeight: '700', color: T.inkSoft },
  itemTitle: {
    fontFamily: Fonts?.serif,
    fontSize: 26,
    fontWeight: '600',
    color: T.heading,
    marginTop: Spacing.two,
  },
  tagRow: { marginTop: Spacing.two, flexWrap: 'wrap', gap: Spacing.two },
  requestedNote: {
    marginTop: Spacing.two,
    fontSize: 14,
    fontStyle: 'italic',
    color: T.brassDeep,
  },

  storyWell: { gap: 2 },
  playRow: { gap: 12 },
  playBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: T.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBtnQuiet: {
    backgroundColor: T.brassTint,
    borderWidth: 1,
    borderColor: T.brass,
  },
  duration: {
    fontSize: 15,
    fontWeight: '600',
    color: T.inkSoft,
    fontVariant: ['tabular-nums'],
  },
  transcript: {
    fontFamily: Fonts?.serif,
    fontStyle: 'italic',
    fontSize: 16,
    lineHeight: 24,
    color: T.ink,
    marginTop: 12,
  },
  storyMeta: { fontSize: 12.5, marginTop: 8 },
  noStory: { fontSize: 15, lineHeight: 22, fontStyle: 'italic' },

  recWell: { marginTop: Spacing.three, gap: Spacing.three },
  recRow: { gap: 10 },
  recDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: T.toss,
  },
  recTime: {
    fontSize: 18,
    fontWeight: '700',
    color: T.ink,
    fontVariant: ['tabular-nums'],
  },
  recHint: { fontSize: 14 },

  recordBtn: {
    marginTop: Spacing.three,
    minHeight: 58,
    borderRadius: 18,
    backgroundColor: T.brass,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  recordBtnDisabled: { opacity: 0.4 },
  recordBtnText: { fontSize: 17, fontWeight: '600', color: '#FFFFFF' },
  webNote: { marginTop: Spacing.two, fontSize: 13, textAlign: 'center' },
  recError: { marginTop: Spacing.two, fontSize: 14, color: T.toss },

  peopleList: { gap: Spacing.two },
  personRow: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 14,
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
    backgroundColor: T.surface,
  },
  personRowSelected: { borderColor: T.brass, backgroundColor: T.brassTint },
  personMain: { flex: 1, minWidth: 0 },
  personName: { fontSize: 16, fontWeight: '700', color: T.ink },
  personRel: { fontSize: 13, marginTop: 1, textTransform: 'capitalize' },

  visList: { marginTop: Spacing.two, gap: 4 },
  visOpt: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: Spacing.three,
  },
  visOptChecked: { backgroundColor: T.brassTint, borderColor: T.brass },
  radio: {
    width: 21,
    height: 21,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: T.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioChecked: { borderColor: T.brass },
  radioDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    backgroundColor: T.brass,
  },
  visMain: { flex: 1, minWidth: 0 },
  visLabel: { fontSize: 15, fontWeight: '600', color: T.ink },
  visHint: { fontSize: 12.5, marginTop: 1 },
  visNote: { fontSize: 14, lineHeight: 20, fontStyle: 'italic' },

  valueRow: { gap: Spacing.two, alignItems: 'stretch' },
  valueInputWrap: {
    flex: 1,
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: T.sunken,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
  },
  dollar: {
    fontFamily: Fonts?.serif,
    fontSize: 19,
    color: T.inkSoft,
  },
  valueInput: {
    flex: 1,
    fontSize: 17,
    color: T.ink,
    paddingVertical: 10,
  },
  heartBtn: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
  },
  heartBtnOn: { borderColor: T.toss, backgroundColor: T.tossTint },
  heartLbl: { fontSize: 14, fontWeight: '600', color: T.ink },

  chatBlock: { marginBottom: Spacing.two },

  requestBlock: { marginTop: Spacing.four, gap: Spacing.two },
  requestedChip: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    backgroundColor: T.keepTint,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
  },
  requestedText: { fontSize: 15, fontWeight: '600', color: T.keep },
  requestNote: { fontSize: 13, textAlign: 'center' },

  bottomSpace: { height: Spacing.five },
  pressed: { opacity: 0.7 },
  addPhotoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
    marginTop: Spacing.two,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: T.brass,
    backgroundColor: T.brassTint,
  },
  addPhotoText: { fontSize: 14, fontWeight: '700', color: T.brassDeep },
  flexOne: { flex: 1 },
  titleRow: { alignItems: 'flex-start', gap: Spacing.two },
  editBtn: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  editBox: { marginTop: Spacing.two },
  editLabel: { marginTop: Spacing.two },
  editInput: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    paddingHorizontal: Spacing.three,
    fontSize: 17,
    fontFamily: Fonts?.serif,
    color: T.heading,
  },
  editRooms: { flexWrap: 'wrap', gap: Spacing.two },
  editRoomChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.line,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  editRoomChipOn: { backgroundColor: T.heading, borderColor: T.heading },
  editRoomText: { fontSize: 13, fontWeight: '600', color: T.inkSoft },
  editRoomTextOn: { color: '#FFFFFF' },
  editActions: { marginTop: Spacing.three, gap: Spacing.two },
  editCancel: { minHeight: 48, justifyContent: 'center', paddingHorizontal: Spacing.three },
  editCancelText: { fontSize: 14, fontWeight: '600', color: T.inkSoft },
  removeBlock: { marginTop: Spacing.five },
  removeLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 44,
  },
  removeText: { fontSize: 14, fontWeight: '600', color: T.toss },
  removeCancel: { minHeight: 44, alignItems: 'center', justifyContent: 'center', marginTop: Spacing.two },
  removeCancelText: { fontSize: 13, fontWeight: '600', color: T.inkSoft, textDecorationLine: 'underline' },
  removeNote: { marginTop: Spacing.two, fontSize: 12.5, textAlign: 'center' },
});
