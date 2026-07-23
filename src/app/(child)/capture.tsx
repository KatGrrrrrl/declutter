/**
 * Child capture — batch camera. Native: expo-camera viewfinder with room
 * chips, shutter, session thumbnail strip, and a quick inline "name it" form
 * after each shot (defaults are fine — back to the viewfinder right away).
 * Web: cameras are unreliable in the browser, so a graceful fallback panel
 * offers a manual add-without-photo form to keep the flow demoable.
 */

import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { notify, ROOMS } from '@/components/child/shared';
import { ItemQuotaMeter, LimitReachedCard } from '@/components/limit-banner';
import {
  Body,
  Btn,
  Card,
  CONTENT_MAX,
  DecorativeIcon,
  Heading,
  Label,
  Muted,
  Screen,
  Title,
  Well,
} from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import { pingItemAdded } from '@/lib/notifications';
import { pickPhoto, uploadItemPhoto } from '@/lib/photo-sync';
import { useCanDecide, useEntitlement, useStore } from '@/lib/store';
import { supabase } from '@/lib/supabase';

export default function CaptureScreen() {
  if (Platform.OS === 'web') return <WebCapture />;
  return <NativeCapture />;
}

/* ================= native camera ================= */

function NativeCapture() {
  const [permission, requestPermission] = useCameraPermissions();
  const addItem = useStore((s) => s.addItem);
  const userName = useStore((s) => s.userName);
  const ent = useEntitlement();
  // A parent cataloguing their own things is deciding as they go: mark it Keep.
  const canDecide = useCanDecide();

  const cameraRef = useRef<CameraView>(null);
  const [room, setRoom] = useState<string>(ROOMS[0]);
  const [shots, setShots] = useState<string[]>([]); // session uris, newest first
  const [count, setCount] = useState(0);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [title, setTitle] = useState('New item');
  const [busy, setBusy] = useState(false);

  // Free plan is full: show the explainer instead of a viewfinder that can't
  // save anything (and don't prompt for camera permission we can't use).
  if (ent.atItemLimit) {
    return (
      <Screen>
        <Label>Batch capture</Label>
        <Title>Capture</Title>
        <LimitReachedCard />
      </Screen>
    );
  }

  if (!permission) {
    return (
      <Screen>
        <Muted>Checking camera…</Muted>
      </Screen>
    );
  }

  if (!permission.granted) {
    return (
      <Screen>
        <Title>Capture</Title>
        <Card style={styles.permCard}>
          <View style={styles.permGlyph}>
            <Ionicons name="camera-outline" size={30} color={T.brassDeep} />
          </View>
          <Heading style={styles.permHeading}>Point, shoot, done</Heading>
          <Body style={styles.permBody}>
            Walk a room and photograph everything — Inventory Our Home needs the camera to
            build the family inventory. Photos stay private to your household.
          </Body>
          <View style={styles.permCta}>
            <Btn label="Allow camera access" big onPress={requestPermission} />
          </View>
          {!permission.canAskAgain && (
            <Muted style={styles.permNote}>
              Camera access was declined — enable it for Inventory Our Home in your phone&apos;s
              Settings.
            </Muted>
          )}
        </Card>
      </Screen>
    );
  }

  const onShutter = async () => {
    const cam = cameraRef.current;
    if (!cam || busy || pendingUri) return;
    setBusy(true);
    try {
      const photo = await cam.takePictureAsync({ quality: 0.7 });
      setTitle('New item');
      setPendingUri(photo.uri);
    } finally {
      setBusy(false);
    }
  };

  const saveItem = () => {
    if (!pendingUri) return;
    const res = addItem({
      title: title.trim() || 'New item',
      room,
      photoUri: pendingUri,
      addedBy: userName,
      tags: [],
      ...(canDecide ? { decision: 'keep' as const, decidedAt: new Date().toISOString() } : null),
    });
    // Never fail silently: the shot they just took wasn't saved.
    if (!res.ok) {
      notify(
        'Free plan is full',
        `You've catalogued ${ent.itemLimit} items. Upgrade to Inventory Our Home Pro to keep adding — nothing already saved is affected.`
      );
      return;
    }
    setShots((s) => [pendingUri, ...s].slice(0, 5));
    setCount((n) => n + 1);
    setPendingUri(null);
    setTitle('New item');

    // Fire-and-forget cloud photo upload when this household is cloud-linked
    // and a session exists. Failures stay silent here — uploadPendingPhotos
    // retries anything that didn't make it.
    const s = useStore.getState();
    pingItemAdded(s.items[0]); // fire-and-forget instant-email ping (guards inside)
    if (s.cloudHouseholdId) {
      const added = s.items[0]; // addItem prepends, so newest is first
      if (added?.photoUri === pendingUri && !added.localOnly) {
        supabase.auth
          .getSession()
          .then(({ data }) => {
            if (data.session) return uploadItemPhoto(added);
          })
          .catch(() => {});
      }
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.camWrap}>
        <CameraView ref={cameraRef} style={styles.camera} facing="back" />

        {/* room chips */}
        <View style={styles.roomRow} pointerEvents="box-none">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.roomChips}>
              {ROOMS.map((r) => (
                <Pressable
                  key={r}
                  accessibilityRole="button"
                  onPress={() => setRoom(r)}
                  style={[styles.roomChip, r === room && styles.roomChipOn]}
                >
                  <Text style={[styles.roomChipText, r === room && styles.roomChipTextOn]}>
                    {r}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </View>

        {/* session count badge */}
        {count > 0 && (
          <View style={styles.countBadge}>
            <Ionicons name="images-outline" size={13} color="#F4ECDC" />
            <Text style={styles.countText}>{count}</Text>
          </View>
        )}
      </View>

      {pendingUri ? (
        /* -------- inline "name it" mini-form -------- */
        <Card style={styles.nameCard}>
          <View style={styles.nameRow}>
            <Image source={{ uri: pendingUri }} style={styles.namePreview} contentFit="cover" />
            <View style={styles.flex}>
              <Label style={styles.nameLabel}>Name it · {room}</Label>
              <TextInput
                style={styles.nameInput}
                value={title}
                onChangeText={setTitle}
                aria-label={`Name this item, in ${room}`}
                selectTextOnFocus
                autoFocus
                returnKeyType="done"
                onSubmitEditing={saveItem}
              />
            </View>
          </View>
          <View style={styles.nameBtns}>
            <View style={styles.flex}>
              <Btn label="Save & keep shooting" onPress={saveItem} />
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setPendingUri(null)}
              style={styles.discard}
            >
              <Text style={styles.discardText}>Discard</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        /* -------- shutter dock -------- */
        <View style={styles.dock}>
          <View style={styles.roll}>
            {shots.map((uri) => (
              <Image key={uri} source={{ uri }} style={styles.rollThumb} contentFit="cover" />
            ))}
            {shots.length === 0 && <Muted style={styles.rollHint}>Shots land here</Muted>}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Take photo"
            onPress={onShutter}
            style={({ pressed }) => [styles.shutter, pressed && styles.shutterPressed]}
          >
            <View style={styles.shutterInner} />
          </Pressable>
          <View style={styles.dockSpacer} />
        </View>
      )}

      {ent.nearItemLimit && <ItemQuotaMeter style={styles.quota} />}

      <Text style={styles.batchNote}>
        <Text style={styles.batchNoteStrong}>Batch mode</Text> ·{' '}
        {canDecide ? 'saved as keepsakes as you go.' : 'keep shooting, decide later.'}
      </Text>
    </SafeAreaView>
  );
}

/* ================= web fallback ================= */

function WebCapture() {
  const addItem = useStore((s) => s.addItem);
  const userName = useStore((s) => s.userName);
  const ent = useEntitlement();
  // A parent cataloguing their own things is deciding as they go: mark it Keep.
  const canDecide = useCanDecide();

  const [room, setRoom] = useState<string>(ROOMS[0]);
  const [title, setTitle] = useState('');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [noPhoto, setNoPhoto] = useState(false);
  const [added, setAdded] = useState(0);

  const choosePhoto = async () => {
    const uri = await pickPhoto();
    if (uri) setPhotoUri(uri);
  };

  /** Default path carries the photo; withoutPhoto is the demoted fallback. */
  const add = (withoutPhoto = false) => {
    const res = addItem({
      title: title.trim() || 'New item',
      room,
      photoUri: !withoutPhoto && photoUri ? photoUri : undefined,
      addedBy: userName,
      tags: [],
      ...(canDecide ? { decision: 'keep' as const, decidedAt: new Date().toISOString() } : null),
    });
    // Refused at the free cap — say so rather than clearing the field silently.
    if (!res.ok) {
      notify(
        'Free plan is full',
        `You've catalogued ${ent.itemLimit} items. Upgrade to Inventory Our Home Pro to keep adding — nothing already saved is affected.`
      );
      return;
    }
    pingItemAdded(useStore.getState().items[0]); // fire-and-forget instant-email ping (guards inside)
    // Same fire-and-forget upload as native capture, when cloud-linked.
    if (!withoutPhoto && photoUri) {
      void (async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session || !useStore.getState().cloudHouseholdId) return;
        const fresh = useStore.getState().items[0];
        if (fresh?.photoUri === photoUri) void uploadItemPhoto(fresh);
      })();
    }
    setTitle('');
    setPhotoUri(null);
    setNoPhoto(false); // photo-first again for the next item
    setAdded((n) => n + 1);
  };

  // At the cap the manual-add form is replaced by the explainer.
  if (ent.atItemLimit) {
    return (
      <Screen>
        <Label>Batch capture</Label>
        <Title>Capture</Title>
        <LimitReachedCard />
      </Screen>
    );
  }

  return (
    <Screen>
      <Label>Batch capture</Label>
      <Title>Capture</Title>

      {ent.nearItemLimit && <ItemQuotaMeter style={styles.webQuota} />}

      <Card style={styles.webCard}>
        <DecorativeIcon style={styles.permGlyph}>
          <Ionicons name="phone-portrait-outline" size={28} color={T.brassDeep} />
        </DecorativeIcon>
        <Heading style={styles.permHeading}>Every item starts with a photo</Heading>
        <Body style={styles.permBody}>
          Add one from your computer below — or open Inventory Our Home on your phone to
          batch-photograph a whole room in minutes.
        </Body>
      </Card>

      <Label asHeading>Add an item</Label>

      {/* Photo first — the default path; the checkbox opts a single item out. */}
      {!noPhoto && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={photoUri ? 'Change photo' : 'Choose a photo'}
          onPress={choosePhoto}
          style={[styles.dropZone, photoUri != null && styles.dropZoneFilled]}
        >
          {photoUri ? (
            <>
              <Image source={{ uri: photoUri }} style={styles.dropPreview} contentFit="cover" />
              <View style={styles.dropChange}>
                <Ionicons name="swap-horizontal-outline" size={14} color="#FFFFFF" />
                <Text style={styles.dropChangeText}>Change</Text>
              </View>
            </>
          ) : (
            <>
              <Ionicons name="camera-outline" size={30} color={T.brassDeep} />
              <Text style={styles.dropText}>Choose a photo</Text>
              <Muted style={styles.dropHint}>From your files — drag-worthy shots welcome</Muted>
            </>
          )}
        </Pressable>
      )}

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: noPhoto }}
        onPress={() => setNoPhoto((v) => !v)}
        style={styles.noPhotoRow}
      >
        <Ionicons
          name={noPhoto ? 'checkbox' : 'square-outline'}
          size={20}
          color={noPhoto ? T.brass : T.inkFaint}
        />
        <Text style={styles.noPhotoRowText}>This item has no photo</Text>
      </Pressable>
      <View style={styles.webChips}>
        {ROOMS.map((r) => (
          <Pressable
            key={r}
            accessibilityRole="button"
            onPress={() => setRoom(r)}
            style={[styles.webChip, r === room && styles.webChipOn]}
          >
            <Text style={[styles.webChipText, r === room && styles.webChipTextOn]}>{r}</Text>
          </Pressable>
        ))}
      </View>
      <Well style={styles.webWell}>
        <TextInput
          style={styles.webInput}
          value={title}
          onChangeText={setTitle}
          placeholder="What is it? e.g. Mantel clock"
          placeholderTextColor={T.inkFaint}
          aria-label="What is it?"
          returnKeyType="done"
          onSubmitEditing={() => add()}
        />
      </Well>
      <Btn
        label={noPhoto || photoUri ? 'Add to inventory' : 'Choose a photo first'}
        big
        onPress={noPhoto ? () => add(true) : photoUri ? () => add() : choosePhoto}
      />
      {added > 0 && (
        <Muted style={styles.webAdded}>
          {canDecide ? 'Kept ✓' : 'Added ✓'} · {added} this session · find{' '}
          {canDecide ? 'them in Keepsakes' : 'them in Inventory'}
        </Muted>
      )}
    </Screen>
  );
}

/* ================= styles ================= */

const styles = StyleSheet.create({
  quota: { marginHorizontal: Spacing.three, marginBottom: Spacing.two },
  // Capped + centered so the viewfinder stays phone-shaped on desktop.
  screen: {
    flex: 1,
    backgroundColor: T.ground,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
  },
  flex: { flex: 1 },

  /* permission */
  permCard: { marginTop: Spacing.three, alignItems: 'center' },
  permGlyph: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: T.brassTint,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  permHeading: { marginTop: Spacing.three, textAlign: 'center' },
  permBody: { color: T.inkSoft, textAlign: 'center', marginTop: Spacing.two },
  permCta: { alignSelf: 'stretch', marginTop: Spacing.four },
  permNote: { marginTop: Spacing.two, textAlign: 'center' },

  /* viewfinder */
  camWrap: {
    flex: 1,
    margin: Spacing.three,
    marginBottom: 0,
    borderRadius: Radius.card,
    overflow: 'hidden',
    backgroundColor: '#211C16',
  },
  camera: { flex: 1 },
  roomRow: { position: 'absolute', top: 12, left: 0, right: 0 },
  roomChips: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
  },
  roomChip: {
    backgroundColor: 'rgba(20,16,12,0.6)',
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  roomChipOn: { backgroundColor: T.brass },
  roomChipText: { color: '#F4ECDC', fontSize: 12.5, fontWeight: '600' },
  roomChipTextOn: { color: '#FFFFFF' },
  countBadge: {
    position: 'absolute',
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(20,16,12,0.6)',
    borderRadius: Radius.pill,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  countText: { color: '#F4ECDC', fontSize: 12, fontWeight: '700' },

  /* dock */
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.three,
  },
  roll: { flex: 1, flexDirection: 'row', gap: 6, alignItems: 'center' },
  rollThumb: {
    width: 36,
    height: 36,
    borderRadius: 9,
    backgroundColor: T.sunken,
    borderWidth: 1,
    borderColor: T.line,
  },
  rollHint: { fontSize: 11.5 },
  shutter: {
    width: 66,
    height: 66,
    borderRadius: 33,
    borderWidth: 4,
    borderColor: T.ink,
    backgroundColor: T.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { transform: [{ scale: 0.92 }] },
  shutterInner: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: T.ink,
  },
  dockSpacer: { flex: 1 },
  batchNote: {
    textAlign: 'center',
    fontSize: 11.5,
    fontWeight: '600',
    color: T.inkSoft,
    paddingBottom: Spacing.two,
  },
  batchNoteStrong: { color: T.brassDeep },

  /* name-it mini-form */
  nameCard: { margin: Spacing.three, marginBottom: Spacing.two },
  nameRow: { flexDirection: 'row', gap: Spacing.three, alignItems: 'center' },
  namePreview: {
    width: 56,
    height: 56,
    borderRadius: 12,
    backgroundColor: T.sunken,
  },
  nameLabel: { marginTop: 0, marginBottom: 4 },
  nameInput: {
    borderWidth: 1,
    borderColor: T.brass,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 12,
    fontFamily: Fonts?.serif,
    fontSize: 16,
    color: T.ink,
  },
  nameBtns: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    marginTop: Spacing.three,
  },
  discard: { paddingVertical: 8, paddingHorizontal: 4 },
  discardText: { fontSize: 13, fontWeight: '600', color: T.inkSoft },

  /* web fallback */
  webQuota: { marginTop: Spacing.two },
  webCard: { marginTop: Spacing.two, alignItems: 'center' },
  webChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: Spacing.three },
  webChip: {
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
    backgroundColor: T.surface,
  },
  webChipOn: { backgroundColor: T.ink, borderColor: T.ink },
  webChipText: { fontSize: 12.5, fontWeight: '600', color: T.inkSoft },
  webChipTextOn: { color: T.surface },
  webWell: { marginBottom: Spacing.three, paddingVertical: 4 },
  webInput: { fontSize: 15, color: T.ink, paddingVertical: 10 },
  webAdded: { marginTop: Spacing.three, textAlign: 'center' },
  dropZone: {
    minHeight: 170,
    borderRadius: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: T.line,
    backgroundColor: T.sunken,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginBottom: Spacing.three,
    overflow: 'hidden',
  },
  dropZoneFilled: { borderStyle: 'solid', borderColor: T.brass, padding: 0 },
  dropPreview: { width: '100%', height: 220 },
  dropChange: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(27,24,21,0.72)',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  dropChangeText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  dropText: { fontSize: 15, fontWeight: '700', color: T.brassDeep },
  dropHint: { fontSize: 12 },
  noPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 44,
    marginBottom: Spacing.two,
  },
  noPhotoRowText: { fontSize: 14, fontWeight: '600', color: T.inkSoft },
});
