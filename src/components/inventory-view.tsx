/**
 * The one inventory — rendered by BOTH the owner ("All items") and the helper
 * ("Inventory") tabs. Everything anyone owns, in one browsable, searchable,
 * sortable list.
 *
 * Role differences (read from the store, not from props):
 *  - Deciders get multi-select bulk actions, the Archived shelf, and heir names.
 *  - Contributors get the "N of yours waiting" banner, and never see who an
 *    heir is unless the owner revealed it (a lock glyph only — an heir exists).
 *
 * Archived items are the gentle alternative to deleting: they stay in the
 * record but drop out of every filter except "Archived".
 *
 * Zustand v5: single-field selectors and the exported useShallow hooks only.
 */

import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ROOMS } from '@/components/child/shared';
import { ItemQuotaMeter } from '@/components/limit-banner';
import { DecisionPill, Heading, Label, Muted, PhotoBox, Screen, Title, useIsDesktop } from '@/components/ui';
import { Fonts, Radius, Spacing, T } from '@/constants/theme';
import {
  Decision,
  Item,
  useCanDecide,
  useDuplicateIds,
  useMessageCount,
  useStore,
} from '@/lib/store';

type Filter = 'all' | Decision | 'mine-waiting' | 'duplicates' | 'archived';
type Sort = 'newest' | 'name' | 'value' | 'room' | 'status';

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'undecided', label: 'Undecided' },
  { key: 'keep', label: 'Keep' },
  { key: 'donate', label: 'Donate' },
  { key: 'toss', label: 'Let go' },
];

const SORTS: { key: Sort; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'name', label: 'Name' },
  { key: 'value', label: 'Value' },
  { key: 'room', label: 'Room' },
  { key: 'status', label: 'Status' },
];

/** Sort order for "Status": what still needs attention comes first. */
const STATUS_RANK: Record<Decision, number> = {
  undecided: 0,
  keep: 1,
  donate: 2,
  toss: 3,
};

/** At-a-glance summary tile. Optionally a filter toggle when onPress is set. */
function StatTile({
  icon,
  label,
  value,
  sub,
  onPress,
  active,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  value: string;
  sub?: string;
  onPress?: () => void;
  active?: boolean;
}) {
  const body = (
    <>
      <View style={styles.tileTop}>
        <Ionicons name={icon} size={16} color={T.brassDeep} />
        <Text style={styles.tileLabel}>{label}</Text>
      </View>
      <Text style={styles.tileValue} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={styles.tileSub}>{sub}</Text> : null}
    </>
  );
  if (onPress) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={({ pressed }) => [styles.tile, active && styles.tileActive, pressed && styles.pressed]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={styles.tile}>{body}</View>;
}

/** Chat count on a row — its own component so the hook runs per item. */
function ChatBadge({ itemId }: { itemId: string }) {
  const count = useMessageCount(itemId);
  if (count === 0) return null;
  return (
    <View style={styles.chatBadge}>
      <Ionicons name="chatbubble-outline" size={11} color={T.inkSoft} />
      <Text style={styles.chatBadgeText}>{count}</Text>
    </View>
  );
}

export function InventoryView() {
  const router = useRouter();
  const { room: roomParam } = useLocalSearchParams<{ room?: string }>();

  const items = useStore((s) => s.items);
  const people = useStore((s) => s.people);
  const userName = useStore((s) => s.userName);
  const ownerName = useStore((s) => s.ownerName);
  const role = useStore((s) => s.role);
  const bulkDecide = useStore((s) => s.bulkDecide);
  const bulkSetRoom = useStore((s) => s.bulkSetRoom);
  const bulkArchive = useStore((s) => s.bulkArchive);
  const canDecide = useCanDecide();
  const isDesktop = useIsDesktop();
  const duplicateIds = useDuplicateIds();

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('newest');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [roomSheet, setRoomSheet] = useState(false);
  /** In-screen room filter, used when the user didn't arrive from Rooms. */
  const [roomPick, setRoomPick] = useState<string | undefined>(undefined);
  const [showRooms, setShowRooms] = useState(false);

  // A helper's own captures still waiting on the decider — the "did they get
  // to my stuff yet?" view.
  const mineWaiting = items.filter(
    (it) => !it.archived && it.addedBy === userName && it.decision === 'undecided'
  );

  // ?room= (from Rooms) wins; the in-screen picker is the fallback.
  const room = roomParam || roomPick || undefined;
  const dupSet = useMemo(() => new Set(duplicateIds), [duplicateIds]);

  /** Every room actually in use, plus the canonical capture rooms. */
  const allRooms = useMemo(() => {
    const set = new Set<string>(ROOMS);
    items.forEach((i) => i.room && set.add(i.room));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const archivedCount = items.filter((i) => i.archived).length;

  // At-a-glance summary tiles. Value is decider-only (matches the item screen),
  // so contributors get a "rooms" tile in its place rather than a total value.
  const stats = useMemo(() => {
    const live = items.filter((i) => !i.archived);
    const rooms = new Set(live.map((i) => i.room).filter(Boolean));
    return {
      total: live.length,
      rooms: rooms.size,
      toDecide: live.filter((i) => i.decision === 'undecided').length,
      kept: live.filter((i) => i.decision === 'keep').length,
      value: live.reduce((sum, i) => sum + (i.marketValue ?? 0), 0),
      valuedCount: live.filter((i) => i.marketValue != null).length,
    };
  }, [items]);

  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    const matches = items.filter((it) => {
      // Archived items live on their own shelf and nowhere else.
      if (filter === 'archived') {
        if (!it.archived) return false;
      } else if (it.archived) {
        return false;
      }

      if (filter === 'mine-waiting') {
        if (it.addedBy !== userName || it.decision !== 'undecided') return false;
      } else if (filter === 'duplicates') {
        if (!dupSet.has(it.id)) return false;
      } else if (filter !== 'all' && filter !== 'archived' && it.decision !== filter) {
        return false;
      }

      if (room && it.room !== room) return false;

      if (
        q &&
        !it.title.toLowerCase().includes(q) &&
        !it.room.toLowerCase().includes(q) &&
        !it.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });

    const by = (a: Item, b: Item) => {
      switch (sort) {
        case 'name':
          return a.title.localeCompare(b.title);
        case 'value':
          return (b.marketValue ?? -1) - (a.marketValue ?? -1);
        case 'room':
          return a.room.localeCompare(b.room) || a.title.localeCompare(b.title);
        case 'status':
          return (
            STATUS_RANK[a.decision] - STATUS_RANK[b.decision] ||
            a.title.localeCompare(b.title)
          );
        case 'newest':
        default:
          return (b.createdAt ?? '').localeCompare(a.createdAt ?? '');
      }
    };
    return [...matches].sort(by);
  }, [items, filter, room, q, sort, userName, dupSet]);

  const toggleSelected = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const endSelect = () => {
    setSelecting(false);
    setSelected([]);
    setRoomSheet(false);
  };

  const applyDecision = (decision: Decision) => {
    if (selected.length === 0) return;
    bulkDecide(selected, decision);
    endSelect();
  };

  const applyRoom = (r: string) => {
    if (selected.length === 0) return;
    bulkSetRoom(selected, r);
    endSelect();
  };

  const applyArchive = () => {
    if (selected.length === 0) return;
    // On the Archived shelf the same button restores instead.
    bulkArchive(selected, filter !== 'archived');
    endSelect();
  };

  const clearRoom = () => {
    setRoomPick(undefined);
    if (roomParam) router.setParams({ room: '' });
  };

  const emptyMessage = () => {
    if (items.length === 0) {
      return 'Nothing here yet. Snap a first photo and it will show up on this list.';
    }
    if (filter === 'archived') {
      return 'Nothing archived. Archiving tucks something away without losing it.';
    }
    if (q) return `No matches for “${query.trim()}”. Try a shorter word.`;
    return 'Nothing matches these filters. Try “All”, or clear the room.';
  };

  return (
    <Screen scroll={false}>
      <View style={styles.headRow}>
        <View style={styles.headMain}>
          <Label>
            {items.length} items{room ? ` · ${room}` : ''}
          </Label>
          <Title>Everything</Title>
        </View>
        {canDecide && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={selecting ? 'Stop selecting' : 'Select several items'}
            onPress={() => (selecting ? endSelect() : setSelecting(true))}
            style={({ pressed }) => [
              styles.selectBtn,
              selecting && styles.selectBtnOn,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons
              name={selecting ? 'close' : 'checkmark-circle-outline'}
              size={17}
              color={selecting ? T.surface : T.inkSoft}
            />
            <Text style={[styles.selectBtnText, selecting && styles.selectBtnTextOn]}>
              {selecting ? 'Done' : 'Select'}
            </Text>
          </Pressable>
        )}
      </View>

      {/* At-a-glance summary tiles */}
      <View style={styles.tiles}>
        <StatTile icon="cube-outline" label="Items" value={String(stats.total)} sub={`Across ${stats.rooms} room${stats.rooms === 1 ? '' : 's'}`} />
        <StatTile
          icon="help-circle-outline"
          label="To decide"
          value={String(stats.toDecide)}
          sub={stats.toDecide ? 'Needs a decision' : 'All settled'}
          onPress={() => setFilter(filter === 'undecided' ? 'all' : 'undecided')}
          active={filter === 'undecided'}
        />
        <StatTile icon="heart-outline" label="Kept" value={String(stats.kept)} sub="Staying in the family" />
        {canDecide ? (
          <StatTile
            icon="pricetag-outline"
            label="Documented value"
            value={`$${stats.value.toLocaleString()}`}
            sub={`${stats.valuedCount} valued`}
          />
        ) : (
          <StatTile icon="grid-outline" label="Rooms" value={String(stats.rooms)} sub="In this home" />
        )}
      </View>

      {/* free-plan usage; renders nothing on Pro */}
      <ItemQuotaMeter style={styles.quota} />

      {/* Helper's pending-review summary: your captures, awaiting the decider. */}
      {role === 'contributor' && mineWaiting.length > 0 && (
        <Pressable
          accessibilityRole="button"
          onPress={() => setFilter(filter === 'mine-waiting' ? 'all' : 'mine-waiting')}
          style={[styles.waitingCard, filter === 'mine-waiting' && styles.waitingCardOn]}
        >
          <Ionicons name="hourglass-outline" size={16} color={T.brassDeep} />
          <Text style={styles.waitingText}>
            {mineWaiting.length} of yours waiting for {ownerName} to decide
          </Text>
          <Text style={styles.waitingAction}>
            {filter === 'mine-waiting' ? 'Show all' : 'View'}
          </Text>
        </Pressable>
      )}

      {/* search well */}
      <View style={styles.search}>
        <Ionicons name="search-outline" size={16} color={T.inkFaint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Search items, tags, rooms…"
          placeholderTextColor={T.inkFaint}
          autoCorrect={false}
          accessibilityLabel="Search your inventory"
        />
        {query.length > 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery('')}
            style={styles.clearSearch}
          >
            <Ionicons name="close-circle" size={17} color={T.inkFaint} />
          </Pressable>
        )}
      </View>

      {/* filter chips */}
      <View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filters}>
            {FILTERS.map((f) => (
              <Pressable
                key={f.key}
                accessibilityRole="button"
                accessibilityState={{ selected: filter === f.key }}
                onPress={() => setFilter(f.key)}
                style={[styles.fchip, filter === f.key && styles.fchipOn]}
              >
                <Text style={[styles.fchipText, filter === f.key && styles.fchipTextOn]}>
                  {f.label}
                </Text>
              </Pressable>
            ))}
            {duplicateIds.length > 0 && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: filter === 'duplicates' }}
                onPress={() => setFilter(filter === 'duplicates' ? 'all' : 'duplicates')}
                style={[styles.fchip, styles.dupChipBtn, filter === 'duplicates' && styles.fchipOn]}
              >
                <Ionicons
                  name="copy-outline"
                  size={13}
                  color={filter === 'duplicates' ? T.surface : T.brassDeep}
                />
                <Text
                  style={[
                    styles.fchipText,
                    styles.dupChipBtnText,
                    filter === 'duplicates' && styles.fchipTextOn,
                  ]}
                >
                  Duplicates ({duplicateIds.length})
                </Text>
              </Pressable>
            )}
            {canDecide && (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: filter === 'archived' }}
                onPress={() => setFilter(filter === 'archived' ? 'all' : 'archived')}
                style={[styles.fchip, filter === 'archived' && styles.fchipOn]}
              >
                <Text
                  style={[styles.fchipText, filter === 'archived' && styles.fchipTextOn]}
                >
                  Archived{archivedCount > 0 ? ` (${archivedCount})` : ''}
                </Text>
              </Pressable>
            )}
            {room && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Clear the ${room} filter`}
                onPress={clearRoom}
                style={[styles.fchip, styles.roomChip]}
              >
                <Text style={styles.roomChipText}>{room}</Text>
                <Ionicons name="close" size={13} color={T.brassDeep} />
              </Pressable>
            )}
          </View>
        </ScrollView>
      </View>

      {/* sort + room picker toggle */}
      <View style={styles.toolRow}>
        <Text style={styles.toolLabel}>Sort</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.sorts}>
            {SORTS.map((s) => (
              <Pressable
                key={s.key}
                accessibilityRole="button"
                accessibilityState={{ selected: sort === s.key }}
                onPress={() => setSort(s.key)}
                style={[styles.schip, sort === s.key && styles.schipOn]}
              >
                <Text style={[styles.schipText, sort === s.key && styles.schipTextOn]}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <Pressable
        accessibilityRole="button"
        onPress={() => setShowRooms((v) => !v)}
        style={({ pressed }) => [styles.roomToggle, pressed && styles.pressed]}
      >
        <Ionicons name="grid-outline" size={15} color={T.inkSoft} />
        <Text style={styles.roomToggleText}>
          {room ? `Room: ${room}` : 'Browse by room'}
        </Text>
        <Ionicons
          name={showRooms ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={T.inkSoft}
        />
      </Pressable>
      {showRooms && (
        <View style={styles.roomGrid}>
          <Pressable
            accessibilityRole="button"
            onPress={clearRoom}
            style={[styles.rpick, !room && styles.rpickOn]}
          >
            <Text style={[styles.rpickText, !room && styles.rpickTextOn]}>All rooms</Text>
          </Pressable>
          {allRooms.map((r) => (
            <Pressable
              key={r}
              accessibilityRole="button"
              accessibilityState={{ selected: room === r }}
              onPress={() => {
                if (roomParam) router.setParams({ room: '' });
                setRoomPick(room === r ? undefined : r);
              }}
              style={[styles.rpick, room === r && styles.rpickOn]}
            >
              <Text style={[styles.rpickText, room === r && styles.rpickTextOn]}>{r}</Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* rows — a single column on phones, a wrapped 2-up grid on desktop so
          the wide content area doesn't leave items stranded in one thin column */}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={isDesktop ? styles.gridContent : undefined}
        showsVerticalScrollIndicator={false}
      >
        {shown.map((it) => {
          const heirPerson = it.heirPersonId
            ? people.find((p) => p.id === it.heirPersonId)
            : undefined;
          // Deciders always see the name; everyone else only when revealed.
          const shownHeir =
            heirPerson && (canDecide || it.heirVisibility === 'revealed')
              ? heirPerson
              : undefined;
          const hiddenHeir = !!it.heirPersonId && !shownHeir;
          const isSelected = selected.includes(it.id);
          const isDup = dupSet.has(it.id);
          return (
            <Pressable
              key={it.id}
              accessibilityRole="button"
              accessibilityState={selecting ? { selected: isSelected } : undefined}
              onPress={() =>
                selecting
                  ? toggleSelected(it.id)
                  : router.push({ pathname: '/item/[id]', params: { id: it.id } })
              }
              style={({ pressed }) => [
                styles.row,
                isDesktop && styles.rowGrid,
                isSelected && styles.rowSelected,
                pressed && styles.pressed,
              ]}
            >
              {selecting && (
                <Ionicons
                  name={isSelected ? 'checkbox' : 'square-outline'}
                  size={24}
                  color={isSelected ? T.brass : T.inkFaint}
                />
              )}
              <View style={styles.thumb}>
                <PhotoBox
                  title={it.title}
                  photoUri={it.photoUri}
                  remotePath={it.remotePhotoPath}
                  height={56}
                  radius={12}
                />
              </View>
              <View style={styles.main}>
                <Heading style={styles.rowTitle} numberOfLines={1}>
                  {it.title}
                </Heading>
                <View style={styles.subRow}>
                  <Muted style={styles.roomText}>{it.room}</Muted>
                  {it.tags.map((t) => (
                    <Text key={t} style={styles.tagText}>
                      #{t}
                    </Text>
                  ))}
                  <ChatBadge itemId={it.id} />
                  {/* Value is decider-only (matches the item screen); shown on
                      every row now, not just when sorting by value. */}
                  {it.marketValue != null && canDecide ? (
                    <Text style={styles.valueText}>${it.marketValue.toLocaleString()}</Text>
                  ) : null}
                  {it.decision === 'donate' && it.donateTo ? (
                    <View style={styles.donateChip}>
                      <Text style={styles.donateChipText}>→ {it.donateTo}</Text>
                    </View>
                  ) : null}
                </View>
                {isDup && (
                  <View style={styles.dupChip}>
                    <Ionicons name="copy-outline" size={10} color={T.brassDeep} />
                    <Text style={styles.dupChipText}>Possible duplicate</Text>
                  </View>
                )}
              </View>
              <View style={styles.end}>
                {it.archived ? (
                  <View style={styles.archChip}>
                    <Text style={styles.archChipText}>Archived</Text>
                  </View>
                ) : (
                  <DecisionPill decision={it.decision} />
                )}
                {shownHeir && <Text style={styles.heirText}>→ {shownHeir.displayName}</Text>}
                {hiddenHeir && (
                  <View style={styles.lock}>
                    <Ionicons name="lock-closed-outline" size={11} color={T.inkFaint} />
                    <Text style={styles.lockText}>heir set</Text>
                  </View>
                )}
              </View>
            </Pressable>
          );
        })}
        {shown.length === 0 && <Muted style={styles.empty}>{emptyMessage()}</Muted>}
        <View style={styles.bottomPad} />
      </ScrollView>

      {/* sticky bulk bar — deciders only */}
      {selecting && canDecide && (
        <View style={styles.bulkBar}>
          {roomSheet ? (
            <>
              <Text style={styles.bulkCount}>Move to which room?</Text>
              <View style={styles.roomGrid}>
                {allRooms.map((r) => (
                  <Pressable
                    key={r}
                    accessibilityRole="button"
                    onPress={() => applyRoom(r)}
                    style={styles.rpick}
                  >
                    <Text style={styles.rpickText}>{r}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setRoomSheet(false)}
                style={styles.bulkCancel}
              >
                <Text style={styles.bulkCancelText}>Back</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.bulkCount}>
                {selected.length === 0
                  ? 'Tap items to select them'
                  : `${selected.length} selected`}
              </Text>
              <View style={styles.bulkActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={selected.length === 0}
                  onPress={() => applyDecision('keep')}
                  style={[styles.bulkBtn, styles.keepBtn, selected.length === 0 && styles.bulkOff]}
                >
                  <Text style={[styles.bulkBtnText, styles.keepText]}>Keep</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={selected.length === 0}
                  onPress={() => applyDecision('donate')}
                  style={[styles.bulkBtn, styles.donateBtn, selected.length === 0 && styles.bulkOff]}
                >
                  <Text style={[styles.bulkBtnText, styles.donateText]}>Donate</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={selected.length === 0}
                  onPress={() => applyDecision('toss')}
                  style={[styles.bulkBtn, styles.tossBtn, selected.length === 0 && styles.bulkOff]}
                >
                  <Text style={[styles.bulkBtnText, styles.tossText]}>Let go</Text>
                </Pressable>
              </View>
              <View style={styles.bulkActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={selected.length === 0}
                  onPress={() => setRoomSheet(true)}
                  style={[styles.bulkBtn, styles.plainBtn, selected.length === 0 && styles.bulkOff]}
                >
                  <Text style={[styles.bulkBtnText, styles.plainText]}>Move to room…</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  disabled={selected.length === 0}
                  onPress={applyArchive}
                  style={[styles.bulkBtn, styles.plainBtn, selected.length === 0 && styles.bulkOff]}
                >
                  <Text style={[styles.bulkBtnText, styles.plainText]}>
                    {filter === 'archived' ? 'Restore' : 'Archive'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={endSelect}
                  style={[styles.bulkBtn, styles.plainBtn]}
                >
                  <Text style={[styles.bulkBtnText, styles.plainText]}>Cancel</Text>
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </Screen>
  );
}

export default InventoryView;

const styles = StyleSheet.create({
  flex: { flex: 1 },

  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two },
  headMain: { flex: 1, minWidth: 0 },
  selectBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: Spacing.three,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    marginTop: Spacing.two,
  },
  selectBtnOn: { backgroundColor: T.ink, borderColor: T.ink },
  selectBtnText: { fontSize: 15, fontWeight: '700', color: T.inkSoft },
  selectBtnTextOn: { color: T.surface },

  // Summary tiles: wrap 2-up on phones, sit 4-across on desktop.
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, marginTop: Spacing.two, marginBottom: Spacing.three },
  tile: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 130,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 14,
    backgroundColor: T.surface,
    paddingVertical: Spacing.three,
    paddingHorizontal: Spacing.three,
    gap: 4,
  },
  tileActive: { borderColor: T.brass, backgroundColor: T.brassTint },
  tileTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tileLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase', color: T.inkSoft },
  tileValue: { fontFamily: Fonts?.serif, fontSize: 26, fontWeight: '600', color: T.heading },
  tileSub: { fontSize: 11.5, color: T.inkFaint },

  quota: { marginTop: Spacing.one, marginBottom: Spacing.two },
  waitingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
    minHeight: 48,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.brass,
    backgroundColor: T.brassTint,
    paddingHorizontal: Spacing.three,
    marginBottom: Spacing.two,
  },
  waitingCardOn: { backgroundColor: T.brass, borderColor: T.brass },
  waitingText: { flex: 1, fontSize: 15, fontWeight: '600', color: T.ink },
  waitingAction: {
    fontSize: 15,
    fontWeight: '700',
    color: T.brassDeep,
    textDecorationLine: 'underline',
  },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    backgroundColor: T.sunken,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: Radius.control,
    paddingHorizontal: 13,
    marginTop: Spacing.one,
    marginBottom: Spacing.three,
  },
  searchInput: { flex: 1, paddingVertical: 12, fontSize: 15, color: T.ink },
  clearSearch: {
    minWidth: 32,
    minHeight: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  filters: { flexDirection: 'row', gap: 7, paddingBottom: Spacing.two },
  fchip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 40,
    borderWidth: 1,
    borderColor: T.line,
    backgroundColor: T.surface,
    borderRadius: Radius.pill,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  fchipOn: { backgroundColor: T.ink, borderColor: T.ink },
  fchipText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  fchipTextOn: { color: T.surface },
  dupChipBtn: { backgroundColor: T.brassTint, borderColor: T.brass },
  dupChipBtnText: { color: T.brassDeep },
  roomChip: { backgroundColor: T.brassTint, borderColor: 'transparent' },
  roomChipText: { fontSize: 15, fontWeight: '600', color: T.brassDeep },

  toolRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  toolLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: T.inkFaint,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sorts: { flexDirection: 'row', gap: 6, paddingVertical: 2 },
  schip: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    backgroundColor: T.sunken,
    paddingHorizontal: 12,
  },
  schipOn: { backgroundColor: T.brassTint },
  schipText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  schipTextOn: { color: T.brassDeep, fontWeight: '700' },

  roomToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 44,
    marginTop: Spacing.two,
  },
  roomToggleText: { flex: 1, fontSize: 15, fontWeight: '600', color: T.inkSoft },
  roomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    paddingBottom: Spacing.two,
  },
  rpick: {
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: T.line,
    paddingHorizontal: 14,
    backgroundColor: T.surface,
  },
  rpickOn: { backgroundColor: T.heading, borderColor: T.heading },
  rpickText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
  rpickTextOn: { color: '#FFFFFF' },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    paddingVertical: 12,
    minHeight: 76,
    borderBottomWidth: 1,
    borderBottomColor: T.lineSoft,
  },
  rowSelected: { backgroundColor: T.brassTint },
  pressed: { opacity: 0.7 },
  // Desktop grid: two cards per row with a hairline card frame instead of the
  // single-column list divider.
  gridContent: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two, paddingTop: Spacing.two },
  rowGrid: {
    width: '49%',
    borderBottomWidth: 0,
    borderWidth: 1,
    borderColor: T.line,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
  },
  thumb: { width: 56 },
  main: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 16 },
  subRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 3,
    flexWrap: 'wrap',
  },
  roomText: { fontSize: 13 },
  tagText: { fontSize: 13, color: T.brassDeep },
  valueText: { fontSize: 13, fontWeight: '700', color: T.ink },
  chatBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  chatBadgeText: { fontSize: 12, fontWeight: '600', color: T.inkSoft },
  donateChip: {
    backgroundColor: T.donateTint,
    borderRadius: Radius.pill,
    paddingVertical: 1,
    paddingHorizontal: 7,
  },
  donateChipText: { fontSize: 12, fontWeight: '700', color: T.donate },
  dupChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    marginTop: 4,
    borderRadius: Radius.pill,
    backgroundColor: T.brassTint,
    paddingVertical: 2,
    paddingHorizontal: 8,
  },
  dupChipText: { fontSize: 12, fontWeight: '700', color: T.brassDeep },
  end: { alignItems: 'flex-end', gap: 5 },
  archChip: {
    borderRadius: Radius.pill,
    backgroundColor: T.sunken,
    paddingVertical: 3,
    paddingHorizontal: 10,
  },
  archChipText: { fontSize: 12, fontWeight: '700', color: T.inkSoft },
  heirText: { fontSize: 12, fontWeight: '600', color: T.brassDeep },
  lock: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lockText: { fontSize: 11, fontWeight: '600', color: T.inkFaint },

  empty: {
    textAlign: 'center',
    marginTop: Spacing.five,
    fontSize: 15,
    lineHeight: 22,
  },
  bottomPad: { height: Spacing.six },

  bulkBar: {
    borderTopWidth: 1,
    borderTopColor: T.line,
    backgroundColor: T.surface,
    paddingTop: Spacing.two,
    paddingBottom: Spacing.two,
    gap: Spacing.two,
  },
  bulkCount: { fontSize: 15, fontWeight: '700', color: T.ink },
  bulkActions: { flexDirection: 'row', gap: 7, flexWrap: 'wrap' },
  bulkBtn: {
    flex: 1,
    minWidth: 92,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: Radius.control,
    borderWidth: 1,
    paddingHorizontal: 10,
  },
  bulkOff: { opacity: 0.4 },
  bulkBtnText: { fontSize: 15, fontWeight: '700' },
  keepBtn: { backgroundColor: T.keepTint, borderColor: T.keep },
  keepText: { color: T.keep },
  donateBtn: { backgroundColor: T.donateTint, borderColor: T.donate },
  donateText: { color: T.donate },
  tossBtn: { backgroundColor: T.tossTint, borderColor: T.toss },
  tossText: { color: T.toss },
  plainBtn: { backgroundColor: T.surface, borderColor: T.line },
  plainText: { color: T.inkSoft },
  bulkCancel: { minHeight: 44, justifyContent: 'center' },
  bulkCancelText: { fontSize: 15, fontWeight: '600', color: T.inkSoft },
});
