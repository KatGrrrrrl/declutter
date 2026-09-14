/**
 * Local-first app state. Mirrors the Phase-1 Supabase schema
 * (supabase/migrations/20260717000001_phase1_core_loop.sql) so the storage
 * layer can swap to Supabase without touching screens: every entity and field
 * name here maps 1:1 to a table/column there.
 *
 * Persisted to AsyncStorage. No backend required to run the app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';

import type { NewOp } from '@/lib/outbox';
import type { ItemParts } from '@/lib/cloud';

export type Role = 'owner' | 'contributor';
export type Decision = 'undecided' | 'keep' | 'donate' | 'toss';
export type HeirVisibility = 'owner_only' | 'after_death' | 'revealed';

export interface Person {
  id: string;
  displayName: string;
  relationship: string;
}

export interface Story {
  transcript: string;
  audioUri?: string;
  durationSec?: number;
  createdAt: string;
}

/**
 * A named set of items that belong together — a coin collection, the wine
 * cellar, Grandad's fishing gear. Organizational only: items keep their own
 * decisions, heirs, and stories; deleting a collection un-groups its items,
 * never deletes them. Any household member may create one (like rooms).
 */
export interface Collection {
  id: string;
  name: string;
  note?: string;
  createdBy: string; // display name
  createdAt: string;
}

/**
 * A room in the house, with enough of a "map" to find it: which floor it is
 * on and a plain-language hint ("end of the hall, on the left").
 *
 * Rooms are keyed by NAME, not id: `Item.room` is a text column locally and in
 * the cloud, so a Room row is metadata ABOUT a room name rather than a
 * reference target. That keeps custom rooms working on devices that have never
 * seen the room record, and it is why `updateRoom` rewrites the items when the
 * name changes. Any household member may add one (like collections); removing
 * one is an administrator action, and only ever when the room is empty.
 */
export interface Room {
  id: string;
  name: string;
  /** Which level of the house — one of FLOORS, or anything the family types. */
  floor?: string;
  /** How to find it: "end of the hall, left", "behind the kitchen". */
  locationNote?: string;
  createdBy: string; // display name
  createdAt: string;
}

/** The rooms a brand-new household starts with; families add their own. */
export const DEFAULT_ROOMS = [
  'Kitchen',
  'Living room',
  'Bedroom',
  'Study',
  'Garage',
] as const;

/**
 * Suggested levels, in the order they are shown and grouped. Free text
 * underneath — a family with a "Boathouse" can just type it.
 */
export const FLOORS = [
  'Basement',
  'Main floor',
  'Upstairs',
  'Attic',
  'Outside',
] as const;

export interface Item {
  id: string;
  title: string;
  room: string;
  decision: Decision;
  decidedAt?: string;
  decidedBy?: string; // display name of the decider who made the call (a cache)
  /** auth user id of whoever made the decision (items.decided_by). */
  decidedById?: string;
  /** auth user id of whoever captured the item (items.created_by). */
  createdById?: string;
  /** auth user id of this item's main decider (items.main_decider). */
  mainDeciderId?: string;
  /**
   * Optional "main decider" for this item — one of the household's deciders.
   * Every decider still sees and can decide the item (a backup if the main one
   * doesn't act); this just flags whose call it primarily is. Undefined = all.
   */
  mainDeciderName?: string;
  tags: string[];
  photoUri?: string; // local uri from camera; placeholder rendered when absent
  /** Cloud storage path (private bucket) once the photo is uploaded/synced. */
  remotePhotoPath?: string;
  addedBy: string; // display name of the contributor/owner who captured it
  marketValue?: number; // dollars
  isSentimental: boolean;
  story?: Story;
  heirPersonId?: string;
  heirVisibility: HeirVisibility;
  requestedBy?: string; // contributor interest signal (owner-visible only)
  /**
   * Where a donated item should go — a charity ("Goodwill") or a person
   * ("cousin Jane"). Only meaningful when decision === 'donate'.
   */
  donateTo?: string;
  donateToKind?: 'charity' | 'person';
  /**
   * High-ticket privacy tier: when true, this item must NEVER leave the
   * device — excluded from any future Supabase sync/upload and from shared
   * family views. Kept in the model now so the sync layer honors it later.
   */
  localOnly?: boolean;
  /**
   * Archived items stay in the record (and in exports/history) but drop out
   * of the working inventory — the gentle alternative to deleting something
   * a family may want back.
   */
  archived?: boolean;
  /** The collection this item belongs to, if any (one collection per item). */
  collectionId?: string;
  createdAt: string;
}

/**
 * The slice of an item the CLOUD row owns. Realtime carries exactly these
 * fields, so merging one can never overwrite device-local state (tags,
 * addedBy, photoUri, story, heirs, main decider) — including when our own
 * write echoes straight back to us.
 */
export interface RemoteItemFields {
  id: string;
  title: string;
  room: string;
  decision: Decision;
  decidedAt?: string;
  decidedBy?: string;
  marketValue?: number;
  isSentimental: boolean;
  donateTo?: string;
  donateToKind?: 'charity' | 'person';
  archived?: boolean;
  collectionId?: string;
  /** Whose call this item primarily is (owner-set; every member may see it). */
  mainDeciderName?: string;
  mainDeciderId?: string;
  decidedById?: string;
  createdById?: string;
  createdAt: string;
}

/**
 * Item fields the cloud carries — an edit to anything else stays local.
 * Heir fields ride on their own row (heir_assignments), so a change to them
 * must push too; they are simply mirrored by a different write.
 */
const CLOUD_ITEM_KEYS = new Set<keyof Item>([
  'title',
  'room',
  'decision',
  'decidedAt',
  'decidedBy',
  'marketValue',
  'isSentimental',
  'donateTo',
  'donateToKind',
  'archived',
  'collectionId',
  'mainDeciderName',
  'mainDeciderId',
  'heirPersonId',
  'heirVisibility',
  'tags',
]);

/** A family-chat message about one item. Visible to the whole household. */
export interface ItemMessage {
  id: string;
  itemId: string;
  author: string; // display name
  text: string;
  createdAt: string;
}


/**
 * Pricing model: the inventory is free and UNLIMITED everywhere — on the
 * device, backed up, and shared across the family (free since 2026-09-07).
 * The only paid layer is AI: value estimates and group-photo splitting,
 * gated server-side on household_plans.plan = 'pro'. See docs/PRICING.md.
 *
 * These constants are kept (Infinity) only so existing call sites that guard
 * on them never refuse a local action.
 */
export const FREE_ITEM_LIMIT = Infinity;
export const FREE_HOUSEHOLD_LIMIT = Infinity;

export type Plan = 'free' | 'pro';

export interface Household {
  id: string;
  name: string;
  createdAt: string;
  /**
   * When this household first reached the cloud from this device — first
   * backup, restore, or adoption on connect. It lives ON the household so it
   * travels with it: switching, adding, removing or re-onboarding needs no
   * cleanup, and a link can never point at a different home than the one
   * open. Undefined = never backed up. It also outlives switching, which is
   * what lets pushHousehold tell "never backed up" from "was backed up and
   * the cloud copy is gone".
   */
  cloudLinkedAt?: string;
  /** Last full backup of THIS household from this device. */
  lastBackupAt?: string;
}

/** One household's data while it isn't the open one (the open one is the top-level working copy). */
export interface HouseholdSlice {
  items: Item[];
  people: Person[];
  collections: Collection[];
  rooms: Room[];
  messages: ItemMessage[];
}

/** A household member chosen as a default or main decider: id for authority, name for display. */
export interface DeciderRef {
  userId: string;
  name: string;
}

interface AppState {
  // profile / onboarding
  onboarded: boolean;
  /**
   * DEMO ONLY: which view of the sample household is showing — Rose, who has
   * the final say, or Sam, who helps. Real households never read this: who may
   * decide comes from the database membership (src/lib/membership.ts). It used
   * to be the app-wide `role` that anyone could flip, and routing trusted it.
   */
  demoRole: Role;
  /** What this device calls its person. A display cache — never an identity or an authority check. */
  userName: string;
  householdName: string;

  /** Households on this device. Their data lives in the working copy (open one) or `householdData`. */
  households: Household[];
  /** Which household the app is currently showing. */
  activeHouseholdId: string;
  /** Subscription state, mirrored from household_plans by billing.refreshPlan(). */
  plan: Plan;
  /** True while the seeded sample household is loaded. */
  isDemo: boolean;

  // ---- the OPEN household's working copy
  people: Person[];
  items: Item[];
  /** Named item sets (coin collection, wine cellar, …) for this household. */
  collections: Collection[];
  /** The rooms of the open household, with floor + "how to find it" notes. */
  rooms: Room[];
  /** Per-item family chat threads. */
  messages: ItemMessage[];

  /**
   * Every OTHER household on this device, by id. Switching homes swaps the
   * working copy in and out of here. Before this, all homes shared one items
   * array, so a newly added home showed the previous home's contents (QA A4).
   */
  householdData: Record<string, HouseholdSlice>;

  /**
   * This person's default decider per household — new captures are flagged as
   * that decider's call first. A device preference, never synced. Keyed by
   * user id now; it used to be a name, which silently stopped matching the
   * moment anyone renamed themselves.
   */
  defaultDeciders: Record<string, DeciderRef>;

  /**
   * Set when the user logs out of their account: the app locks (data stays on
   * device, but re-entry requires signing back in — an inventory of valuables
   * must not stay browsable on a logged-out phone). lastAccountEmail is who
   * may unlock.
   */
  lockedOut?: boolean;
  lastAccountEmail?: string;
  /**
   * Which signed-in account this device's data BELONGS to — as opposed to
   * lastAccountEmail, which only records who last logged out. Checked on every
   * sign-in (src/lib/account-switch.ts).
   */
  accountEmail?: string;
  /** The same account's user id, for "is this mine?" checks. Set by auth. */
  accountUserId?: string;
  /** True immediately after logging out, so the login screen can confirm it
   *  even though the lock redirect drops any URL params. Consumed once. */
  pendingLogoutNotice?: boolean;
  lockOut: (accountEmail: string) => void;
  /** Record that this device's data belongs to `email` (and, when known, that user id). */
  bindAccount: (email: string, userId?: string) => void;
  unlock: () => void;
  clearLogoutNotice: () => void;
  /**
   * Lock without the "you logged out" notice — for when a session lapses or
   * is missing on load rather than the user tapping Log out.
   */
  requireSignIn: () => void;
  /** Record that a household is in the cloud. Keeps the original link time. */
  markCloudLinked: (householdId: string, backedUpAt?: string) => void;
  /** The cloud copy is gone (deleted everywhere): the household is local-only again. */
  unlinkHousehold: (householdId: string) => void;

  /** A household's data wherever it currently lives on this device. */
  householdDataFor: (householdId: string) => HouseholdSlice | undefined;
  /**
   * Put a household's data on the device (src/lib/household.ts calls this after
   * pulling the cloud copy and laying unsent local changes over it). `open`
   * makes it the working copy; otherwise it is stored alongside.
   */
  setHouseholdData: (
    householdId: string,
    name: string,
    data: HouseholdSlice,
    opts?: { open?: boolean; linkedAt?: string }
  ) => void;
  /** The rooms a brand-new household starts with. */
  startingRoomsFor: (createdBy: string, now: string) => Room[];
  setUserName: (name: string) => void;

  /** Merge one realtime row from another family member's device. */
  applyRemoteMessage: (m: ItemMessage) => void;
  /** Apply an item INSERT/UPDATE arriving from another device. */
  applyRemoteItem: (f: RemoteItemFields) => void;
  /** Apply an item DELETE arriving from another device. */
  applyRemoteItemDelete: (id: string) => void;

  /** Wipe everything and return to the sample household (used by account swaps and erase). */
  signOut: () => void;
  /** Open the sample household as the demo (account-free). */
  enterDemo: () => void;
  switchHousehold: (id: string) => void;
  /** Rename a household; mirrors to the cloud when it's shared (owner-only there). */
  renameHousehold: (id: string, name: string) => void;
  /**
   * Remove a household from THIS DEVICE. Never touches the cloud — a shared
   * copy stays in the account. Refuses to remove the last one.
   */
  removeHousehold: (id: string) => { ok: boolean; reason?: 'last' };
  /** Post a chat message on an item, authored by the current user. */
  addMessage: (itemId: string, text: string) => void;
  setPlan: (plan: Plan) => void;
  /** Demo only: switch the sample household between Rose's and Sam's view. */
  setDemoRole: (role: Role) => void;
  decide: (id: string, decision: Decision) => void;
  undoDecision: (id: string) => void;
  /** Flag one of the household's deciders as this item's primary decider (or clear). */
  setMainDecider: (id: string, decider: DeciderRef | undefined) => void;
  /** This user's default decider for a household — applied to items they add (undefined = anyone). */
  setDefaultDecider: (householdId: string, decider: DeciderRef | undefined) => void;
  /** Returns the new item's id. */
  addItem: (
    item: Omit<Item, 'id' | 'createdAt' | 'decision' | 'heirVisibility' | 'isSentimental' | 'tags'> &
      Partial<Item>
  ) => { ok: boolean; reason?: 'limit'; id?: string };
  updateItem: (id: string, patch: Partial<Item>) => void;
  /**
   * Remove an item (and its chat). UI gates this to: deciders and
   * administrators always; the capturer while the item is still undecided.
   * The database enforces the same rule.
   */
  removeItem: (id: string) => void;
  /** Archive/restore — reversible, unlike removeItem. */
  setArchived: (id: string, archived: boolean) => void;
  /** Bulk helpers for the inventory's multi-select mode. */
  bulkDecide: (
    ids: string[],
    decision: Decision,
    donate?: { donateTo: string; donateToKind: 'charity' | 'person' }
  ) => void;
  bulkSetRoom: (ids: string[], room: string) => void;
  bulkArchive: (ids: string[], archived: boolean) => void;
  /**
   * Add a room. Returns ok:false when the name is blank or already taken
   * (rooms are name-keyed, so duplicates would fight over the same items).
   */
  addRoom: (
    name: string,
    opts?: { floor?: string; locationNote?: string }
  ) => { ok: boolean; reason?: 'blank' | 'duplicate'; id?: string };
  /**
   * Edit a room. Renaming rewrites `room` on every item in it — the name IS
   * the link between item and room.
   */
  updateRoom: (
    id: string,
    patch: { name?: string; floor?: string; locationNote?: string }
  ) => { ok: boolean; reason?: 'blank' | 'duplicate' };
  /** Delete a room — refused while items are still in it. */
  removeRoom: (id: string) => { ok: boolean; reason?: 'not-empty'; count?: number };
  /** Create a collection and return its id (for making it sticky in capture). */
  addCollection: (name: string, note?: string) => string;
  updateCollection: (id: string, patch: { name?: string; note?: string }) => void;
  /** Delete a collection; its items stay, un-grouped (cloud FK is SET NULL). */
  removeCollection: (id: string) => void;
  /** Assign one item to a collection (undefined = remove from collection). */
  setItemCollection: (itemId: string, collectionId: string | undefined) => void;
  /** Assign many items at once — the inventory multi-select action. */
  bulkSetCollection: (ids: string[], collectionId: string | undefined) => void;
  setStory: (id: string, story: Story) => void;
  assignHeir: (id: string, personId: string | undefined, visibility: HeirVisibility) => void;
  /** Realtime: an heir_assignments row arrived or went away (undefined = unassigned). */
  applyRemoteHeir: (itemId: string, personId: string | undefined, visibility: HeirVisibility) => void;
  requestItem: (id: string, byName: string) => void;
  addPerson: (p: Omit<Person, 'id'>) => void;
  resetAll: () => void;
}

/**
 * ids are UUIDs so local rows and cloud rows are the SAME row — sync upserts
 * by id instead of wipe-and-rewrite, which is what lets several family
 * members' devices merge without clobbering each other.
 */
export const uid = (): string => {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (g.crypto?.randomUUID) return g.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

/** True for ids minted before the UUID switch (and demo seed ids). */
const isLegacyId = (id: string) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);

const seedPeople: Person[] = [
  { id: '00000000-0000-4000-8000-0000000000a1', displayName: 'Maya', relationship: 'daughter' },
  { id: '00000000-0000-4000-8000-0000000000a2', displayName: 'Sam', relationship: 'son' },
  { id: '00000000-0000-4000-8000-0000000000a3', displayName: 'Noor', relationship: 'granddaughter' },
];

const seedItems: Item[] = [
  {
    id: '00000000-0000-4000-8000-0000000000b1', title: 'Blue china teapot', room: 'Kitchen', decision: 'undecided',
    tags: ['china'], addedBy: 'Sam', isSentimental: true, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b2', title: 'Mantel clock', room: 'Living room', decision: 'undecided',
    tags: ['heirloom'], addedBy: 'Sam', isSentimental: true, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:05:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b3', title: 'Cordless drill', room: 'Garage', decision: 'undecided',
    tags: ['tools'], addedBy: 'Maya', isSentimental: false, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:10:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b4', title: 'World atlas, 1968', room: 'Study', decision: 'undecided',
    tags: ['books'], addedBy: 'Maya', isSentimental: false, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:15:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b5', title: 'Opal ring', room: 'Bedroom', decision: 'keep',
    decidedAt: '2026-06-28T15:00:00Z', tags: ['jewelry'], addedBy: 'Sam',
    marketValue: 1400, isSentimental: true, heirPersonId: '00000000-0000-4000-8000-0000000000a2',
    heirVisibility: 'owner_only',
    story: {
      transcript: 'Your father gave me this the year we opened the shop. I wore it every market day for luck.',
      durationSec: 34, createdAt: '2026-06-28T15:04:00Z',
    },
    createdAt: '2026-06-27T09:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b6', title: 'Wedding quilt', room: 'Bedroom', decision: 'keep',
    decidedAt: '2026-06-28T15:10:00Z', tags: ['textiles'], addedBy: 'Maya',
    isSentimental: true, heirPersonId: '00000000-0000-4000-8000-0000000000a1', heirVisibility: 'revealed',
    story: {
      transcript: 'My mother and her sisters made this in the winter of 1949. Every square is a dress one of them wore.',
      durationSec: 51, createdAt: '2026-06-28T15:12:00Z',
    },
    createdAt: '2026-06-27T09:05:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b7', title: 'Delft dinner service', room: 'Kitchen', decision: 'keep',
    decidedAt: '2026-06-28T15:20:00Z', tags: ['china'], addedBy: 'Sam',
    marketValue: 120, isSentimental: true, heirVisibility: 'owner_only',
    createdAt: '2026-06-27T09:10:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000b8', title: 'Push mower', room: 'Garage', decision: 'donate',
    decidedAt: '2026-06-28T15:30:00Z', tags: ['tools'], addedBy: 'Maya',
    isSentimental: false, heirVisibility: 'owner_only',
    donateTo: 'Habitat ReStore', donateToKind: 'charity',
    createdAt: '2026-06-27T09:15:00Z',
  },
];

const DEMO_HOUSEHOLD_ID = '00000000-0000-4000-8000-0000000000e1';

const seedMessages: ItemMessage[] = [
  {
    id: '00000000-0000-4000-8000-0000000000d1', itemId: '00000000-0000-4000-8000-0000000000b1', author: 'Sam',
    text: 'Is this the one you brought back from Delft? The glaze looks right.',
    createdAt: '2026-07-01T18:20:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000d2', itemId: '00000000-0000-4000-8000-0000000000b1', author: 'Rose',
    text: 'It is — from our honeymoon. Your father haggled terribly for it.',
    createdAt: '2026-07-01T19:02:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000d3', itemId: '00000000-0000-4000-8000-0000000000b6', author: 'Maya',
    text: 'Noor asked about this quilt last Christmas — she loved the stories in the squares.',
    createdAt: '2026-06-29T10:15:00Z',
  },
];

/**
 * Sample rooms for the demo house — floors and location hints filled in so the
 * "where is it?" map reads as a real home on the first run.
 */
const seedRooms: Room[] = [
  { id: '00000000-0000-4000-8000-0000000000e1', name: 'Kitchen', floor: 'Main floor', locationNote: 'Back of the house, off the hall', createdBy: 'Sam', createdAt: '2026-06-27T09:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000000e2', name: 'Living room', floor: 'Main floor', locationNote: 'Front room, by the porch', createdBy: 'Sam', createdAt: '2026-06-27T09:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000000e3', name: 'Bedroom', floor: 'Upstairs', locationNote: 'End of the landing, on the left', createdBy: 'Sam', createdAt: '2026-06-27T09:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000000e4', name: 'Study', floor: 'Upstairs', locationNote: 'First door at the top of the stairs', createdBy: 'Sam', createdAt: '2026-06-27T09:00:00Z' },
  { id: '00000000-0000-4000-8000-0000000000e5', name: 'Garage', floor: 'Outside', locationNote: 'Detached, past the side gate', createdBy: 'Sam', createdAt: '2026-06-27T09:00:00Z' },
];

/** A fresh household's rooms — the default names, no map filled in yet. */
export const startingRooms = (createdBy: string, now: string): Room[] =>
  DEFAULT_ROOMS.map((name) => ({ id: uid(), name, createdBy, createdAt: now }));

/**
 * Room records inferred from the rooms items already name, plus the defaults.
 * The backfill for anything that predates room records — a store persisted
 * before this feature, or a cloud copy restored without room rows.
 */
export const roomsFromItems = (items: Item[], createdBy: string, now: string): Room[] => {
  const names: string[] = [...DEFAULT_ROOMS];
  const seen = new Set(names.map((n) => n.toLowerCase()));
  items.forEach((i) => {
    const n = i.room?.trim();
    if (!n || seen.has(n.toLowerCase())) return;
    seen.add(n.toLowerCase());
    names.push(n);
  });
  return names.map((name) => ({ id: uid(), name, createdBy, createdAt: now }));
};

/** Pristine app state — the seeded sample household, pre-onboarding. */
const initial = {
  onboarded: false,
  demoRole: 'owner' as Role,
  userName: 'Rose',
  householdName: 'The Lakehouse',
  households: [
    {
      id: DEMO_HOUSEHOLD_ID,
      name: 'The Lakehouse',
      createdAt: '2026-06-27T09:00:00Z',
    },
  ] as Household[],
  activeHouseholdId: DEMO_HOUSEHOLD_ID,
  plan: 'free' as Plan,
  isDemo: true,
  people: seedPeople,
  items: seedItems,
  collections: [] as Collection[],
  rooms: seedRooms,
  messages: seedMessages,
  householdData: {} as Record<string, HouseholdSlice>,
  defaultDeciders: {} as Record<string, DeciderRef>,
};

/**
 * The cloud household this device may write to right now: the OPEN household,
 * if it has ever reached the cloud. Local household ids double as cloud ids.
 *
 * Derived from the household record, not a separate field, so there is no
 * stale link to clear when the open household changes — the old design kept
 * one and had to remember to reset it in six places. Undefined = don't write.
 */
export const linkedCloudId = (s: AppState): string | undefined =>
  !s.isDemo && s.households.find((h) => h.id === s.activeHouseholdId)?.cloudLinkedAt
    ? s.activeHouseholdId
    : undefined;

/**
 * Where store actions send changes bound for the family's shared copy.
 *
 * The outbox (src/lib/outbox.ts) registers itself here at start-up. The store
 * never imports it at runtime — it would be an import cycle, and an action
 * doesn't need to know how a change travels, only that it was handed off.
 * With no sink registered (tests, the static web build) changes stay local.
 */
export type CloudSink = (op: NewOp) => boolean;
let cloudSink: CloudSink | null = null;
export function setCloudSink(sink: CloudSink | null): void {
  cloudSink = sink;
}
const send = (op: NewOp) => cloudSink?.(op) ?? false;

/** The household changes may be sent to right now, if any. */
const shareTarget = (s: AppState) => linkedCloudId(s);

/**
 * Before an item that sits in a collection reaches the cloud, its collection
 * must (items.collection_id is a foreign key). Only ever for collections a
 * SHARED item uses — a collection holding nothing but localOnly items never
 * leaves the device, not even its name.
 */
function sendCollectionFor(s: AppState, hid: string, collectionId: string | undefined) {
  if (!collectionId) return;
  const c = s.collections.find((x) => x.id === collectionId);
  if (c) send({ kind: 'collection.upsert', householdId: hid, key: c.id, payload: { collection: c } });
}

/** Queue edits to items for the family. Call AFTER set(), with the ids that changed. */
function sendItemUpdates(s: AppState, parts: ItemParts, ids: string[]) {
  const hid = shareTarget(s);
  if (!hid) return;
  for (const id of ids) {
    const item = s.items.find((i) => i.id === id);
    if (!item || item.localOnly) continue;
    sendCollectionFor(s, hid, item.collectionId);
    send({ kind: 'item.update', householdId: hid, key: item.id, payload: { item, parts } });
  }
}

/** Queue a room add/edit. Rooms go up eagerly: the family map includes empty rooms. */
function sendRoom(s: AppState, room: Room, previousName?: string) {
  const hid = shareTarget(s);
  if (!hid) return;
  send({ kind: 'room.upsert', householdId: hid, key: room.name, payload: { room, previousName } });
}

const emptySlice = (createdBy: string, now: string): HouseholdSlice => ({
  items: [],
  people: [],
  collections: [],
  rooms: startingRooms(createdBy, now),
  messages: [],
});

const workingCopy = (s: AppState): HouseholdSlice => ({
  items: s.items,
  people: s.people,
  collections: s.collections,
  rooms: s.rooms,
  messages: s.messages,
});

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial,

      householdDataFor: (householdId) => {
        const s = get();
        if (householdId === s.activeHouseholdId && !s.isDemo) return workingCopy(s);
        return s.householdData[householdId];
      },

      setHouseholdData: (householdId, name, data, opts) =>
        set((s) => {
          const now = new Date().toISOString();
          const prev = s.households.find((h) => h.id === householdId);
          const meta: Household = {
            id: householdId,
            name,
            createdAt: prev?.createdAt ?? now,
            // Data that came from (or went to) the cloud is linked from the first moment.
            cloudLinkedAt: prev?.cloudLinkedAt ?? opts?.linkedAt ?? now,
            lastBackupAt: prev?.lastBackupAt,
          };
          // The demo is dropped the moment a real home arrives.
          const baseHouseholds = s.isDemo ? [] : s.households;
          const households = baseHouseholds.some((h) => h.id === householdId)
            ? baseHouseholds.map((h) => (h.id === householdId ? meta : h))
            : [...baseHouseholds, meta];

          const opening = opts?.open || householdId === s.activeHouseholdId;
          if (!opening) {
            return { households, householdData: { ...s.householdData, [householdId]: data } };
          }
          // Park whatever was open (unless it is this household, or the demo).
          const householdData = { ...s.householdData };
          if (!s.isDemo && s.activeHouseholdId !== householdId && s.households.some((h) => h.id === s.activeHouseholdId)) {
            householdData[s.activeHouseholdId] = workingCopy(s);
          }
          delete householdData[householdId];
          return {
            onboarded: true,
            isDemo: false,
            households,
            householdData,
            activeHouseholdId: householdId,
            householdName: name,
            ...data,
          };
        }),

      startingRoomsFor: (createdBy, now) => startingRooms(createdBy, now),

      setUserName: (name) => {
        const trimmed = name.trim();
        if (trimmed) set({ userName: trimmed });
      },

      signOut: () => set({ ...initial }),

      enterDemo: () => set({ ...initial, onboarded: true }),

      addMessage: (itemId, text) => {
        const s = get();
        const trimmed = text.trim();
        if (!trimmed) return;
        const message: ItemMessage = {
          id: uid(),
          itemId,
          author: s.userName,
          text: trimmed,
          createdAt: new Date().toISOString(),
        };
        set({ messages: [...s.messages, message] });
        const hid = shareTarget(s);
        const item = s.items.find((i) => i.id === itemId);
        if (hid && item && !item.localOnly) {
          send({ kind: 'message.create', householdId: hid, key: itemId, payload: { message } });
        }
      },

      switchHousehold: (id) =>
        set((s) => {
          if (id === s.activeHouseholdId) return {};
          const target = s.households.find((h) => h.id === id);
          if (!target) return {};
          const householdData = { ...s.householdData };
          if (!s.isDemo) householdData[s.activeHouseholdId] = workingCopy(s);
          const next = householdData[id] ?? emptySlice(s.userName, new Date().toISOString());
          delete householdData[id];
          return { activeHouseholdId: id, householdName: target.name, householdData, ...next };
        }),

      renameHousehold: (id, name) => {
        const s = get();
        const trimmed = name.trim();
        const h = s.households.find((x) => x.id === id);
        if (!trimmed || !h) return;
        set({
          households: s.households.map((x) => (x.id === id ? { ...x, name: trimmed } : x)),
          ...(s.activeHouseholdId === id ? { householdName: trimmed } : {}),
        });
        if (h.cloudLinkedAt && !s.isDemo) {
          send({ kind: 'household.rename', householdId: id, key: id, payload: { name: trimmed } });
        }
      },

      removeHousehold: (id) => {
        const s = get();
        if (!s.households.some((h) => h.id === id)) return { ok: true };
        if (s.households.length <= 1) return { ok: false, reason: 'last' as const };
        const remaining = s.households.filter((h) => h.id !== id);
        const householdData = { ...s.householdData };
        delete householdData[id];
        if (s.activeHouseholdId !== id) {
          set({ households: remaining, householdData });
          return { ok: true };
        }
        const next = remaining[0];
        const slice = householdData[next.id] ?? emptySlice(s.userName, new Date().toISOString());
        delete householdData[next.id];
        set({
          households: remaining,
          householdData,
          activeHouseholdId: next.id,
          householdName: next.name,
          ...slice,
        });
        return { ok: true };
      },

      setPlan: (plan) => set({ plan }),

      setDemoRole: (role) =>
        set((s) => (s.isDemo ? { demoRole: role, userName: role === 'owner' ? 'Rose' : 'Sam' } : {})),

      decide: (id, decision) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id
              ? {
                  ...it,
                  decision,
                  decidedAt: new Date().toISOString(),
                  decidedBy: s.userName,
                  decidedById: s.isDemo ? undefined : s.accountUserId,
                }
              : it
          ),
        }));
        sendItemUpdates(get(), { decision: true }, [id]);
      },

      setMainDecider: (id, decider) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, mainDeciderId: decider?.userId, mainDeciderName: decider?.name } : it
          ),
        }));
        sendItemUpdates(get(), { decision: true }, [id]);
      },

      setDefaultDecider: (householdId, decider) =>
        set((s) => {
          const next = { ...s.defaultDeciders };
          if (decider) next[householdId] = decider;
          else delete next[householdId];
          return { defaultDeciders: next };
        }),

      undoDecision: (id) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id
              ? { ...it, decision: 'undecided', decidedAt: undefined, decidedBy: undefined, decidedById: undefined }
              : it
          ),
        }));
        sendItemUpdates(get(), { decision: true }, [id]);
      },

      addItem: (item) => {
        const s = get();
        if (s.plan === 'free' && s.items.length >= FREE_ITEM_LIMIT) {
          return { ok: false, reason: 'limit' as const };
        }
        // Route it to this person's default decider unless the caller said otherwise.
        const fallback = s.defaultDeciders[s.activeHouseholdId];
        const created: Item = {
          decision: 'undecided',
          heirVisibility: 'owner_only',
          isSentimental: false,
          tags: [],
          ...item,
          addedBy: item.addedBy || s.userName,
          mainDeciderId: item.mainDeciderId ?? (item.mainDeciderName ? undefined : fallback?.userId),
          mainDeciderName: item.mainDeciderName ?? fallback?.name,
          createdById: s.isDemo ? undefined : s.accountUserId,
          id: uid(),
          createdAt: new Date().toISOString(),
        } as Item;
        set({ items: [created, ...s.items] });

        const hid = shareTarget(s);
        if (hid && !created.localOnly) {
          sendCollectionFor(s, hid, created.collectionId);
          send({ kind: 'item.create', householdId: hid, key: created.id, payload: { item: created } });
          if (created.photoUri) {
            send({ kind: 'photo.upload', householdId: hid, key: created.id, payload: { item: created } });
          }
        }
        return { ok: true, id: created.id };
      },

      updateItem: (id, patch) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        }));
        const s = get();
        const keys = Object.keys(patch) as (keyof Item)[];
        if (keys.some((k) => CLOUD_ITEM_KEYS.has(k)) || 'story' in patch) {
          sendItemUpdates(s, {
            tags: 'tags' in patch,
            story: 'story' in patch,
            heir: 'heirPersonId' in patch || 'heirVisibility' in patch,
            decision: 'decision' in patch || 'mainDeciderId' in patch || 'mainDeciderName' in patch,
          }, [id]);
        }
        const hid = shareTarget(s);
        const item = s.items.find((i) => i.id === id);
        if (hid && item && !item.localOnly && patch.photoUri) {
          send({ kind: 'photo.upload', householdId: hid, key: id, payload: { item } });
        }
      },

      setArchived: (id, archived) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, archived } : it)),
        }));
        sendItemUpdates(get(), {}, [id]);
      },

      bulkDecide: (ids, decision, donate) => {
        set((s) => {
          const at = new Date().toISOString();
          const undecided = decision === 'undecided';
          const chosen = new Set(ids);
          return {
            items: s.items.map((it) =>
              chosen.has(it.id)
                ? {
                    ...it,
                    decision,
                    decidedAt: undecided ? undefined : at,
                    decidedBy: undecided ? undefined : s.userName,
                    decidedById: undecided || s.isDemo ? undefined : s.accountUserId,
                    ...(donate && decision === 'donate'
                      ? { donateTo: donate.donateTo, donateToKind: donate.donateToKind }
                      : {}),
                  }
                : it
            ),
          };
        });
        sendItemUpdates(get(), { decision: true }, ids);
      },

      bulkSetRoom: (ids, room) => {
        set((s) => {
          const chosen = new Set(ids);
          return { items: s.items.map((it) => (chosen.has(it.id) ? { ...it, room } : it)) };
        });
        sendItemUpdates(get(), {}, ids);
      },

      bulkArchive: (ids, archived) => {
        set((s) => {
          const chosen = new Set(ids);
          return { items: s.items.map((it) => (chosen.has(it.id) ? { ...it, archived } : it)) };
        });
        sendItemUpdates(get(), {}, ids);
      },

      addRoom: (name, opts) => {
        const s = get();
        const trimmed = name.trim();
        if (!trimmed) return { ok: false, reason: 'blank' as const };
        if (s.rooms.some((r) => r.name.toLowerCase() === trimmed.toLowerCase())) {
          return { ok: false, reason: 'duplicate' as const };
        }
        const room: Room = {
          id: uid(),
          name: trimmed,
          floor: opts?.floor?.trim() || undefined,
          locationNote: opts?.locationNote?.trim() || undefined,
          createdBy: s.userName,
          createdAt: new Date().toISOString(),
        };
        set({ rooms: [...s.rooms, room] });
        sendRoom(get(), room);
        return { ok: true, id: room.id };
      },

      updateRoom: (id, patch) => {
        const s = get();
        const room = s.rooms.find((r) => r.id === id);
        if (!room) return { ok: false };
        const name = patch.name?.trim();
        if (patch.name !== undefined && !name) return { ok: false, reason: 'blank' as const };
        const renamed = Boolean(name && name.toLowerCase() !== room.name.toLowerCase());
        if (name && s.rooms.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())) {
          return { ok: false, reason: 'duplicate' as const };
        }
        const next: Room = {
          ...room,
          ...(name ? { name } : {}),
          ...(patch.floor !== undefined ? { floor: patch.floor.trim() || undefined } : {}),
          ...(patch.locationNote !== undefined ? { locationNote: patch.locationNote.trim() || undefined } : {}),
        };
        // The room's NAME is what items point at, so a rename carries the items with it.
        const movedIds = renamed ? s.items.filter((i) => i.room === room.name).map((i) => i.id) : [];
        set({
          rooms: s.rooms.map((r) => (r.id === id ? next : r)),
          ...(renamed ? { items: s.items.map((i) => (i.room === room.name ? { ...i, room: next.name } : i)) } : {}),
        });
        sendRoom(get(), next, renamed ? room.name : undefined);
        if (movedIds.length) sendItemUpdates(get(), {}, movedIds);
        return { ok: true };
      },

      removeRoom: (id) => {
        const s = get();
        const room = s.rooms.find((r) => r.id === id);
        if (!room) return { ok: true };
        const count = s.items.filter((i) => i.room === room.name).length;
        if (count > 0) return { ok: false, reason: 'not-empty' as const, count };
        set({ rooms: s.rooms.filter((r) => r.id !== id) });
        const hid = shareTarget(s);
        // By NAME: whichever device synced the room first minted the cloud row's id.
        if (hid) send({ kind: 'room.delete', householdId: hid, key: room.name, payload: { name: room.name } });
        return { ok: true };
      },

      addCollection: (name, note) => {
        const s = get();
        const trimmed = name.trim();
        const existing = s.collections.find((c) => c.name.toLowerCase() === trimmed.toLowerCase());
        if (existing) return existing.id; // creating "Coins" twice just reuses it
        const col: Collection = {
          id: uid(),
          name: trimmed,
          note: note?.trim() || undefined,
          createdBy: s.userName,
          createdAt: new Date().toISOString(),
        };
        set({ collections: [col, ...s.collections] });
        // Uploaded lazily, with the first shared item that uses it (sendCollectionFor).
        return col.id;
      },

      updateCollection: (id, patch) => {
        const s = get();
        const name = patch.name?.trim();
        set({
          collections: s.collections.map((c) =>
            c.id === id ? { ...c, ...(name ? { name } : {}), note: patch.note ?? c.note } : c
          ),
        });
        const hid = shareTarget(s);
        // Only a collection a shared item uses has a cloud row to rename.
        if (hid && s.items.some((i) => i.collectionId === id && !i.localOnly)) sendCollectionFor(get(), hid, id);
      },

      removeCollection: (id) => {
        const s = get();
        set({
          collections: s.collections.filter((c) => c.id !== id),
          items: s.items.map((it) => (it.collectionId === id ? { ...it, collectionId: undefined } : it)),
        });
        const hid = shareTarget(s);
        // The cloud FK is ON DELETE SET NULL, so this one delete un-groups the cloud rows too.
        if (hid) send({ kind: 'collection.delete', householdId: hid, key: id, payload: { id } });
      },

      setItemCollection: (itemId, collectionId) => {
        get().updateItem(itemId, { collectionId });
      },

      bulkSetCollection: (ids, collectionId) => {
        set((s) => {
          const chosen = new Set(ids);
          return { items: s.items.map((it) => (chosen.has(it.id) ? { ...it, collectionId } : it)) };
        });
        sendItemUpdates(get(), {}, ids);
      },

      removeItem: (id) => {
        const s = get();
        const item = s.items.find((it) => it.id === id);
        set({
          items: s.items.filter((it) => it.id !== id),
          messages: s.messages.filter((m) => m.itemId !== id),
        });
        const hid = shareTarget(s);
        if (hid && item && !item.localOnly) {
          send({ kind: 'item.delete', householdId: hid, key: id, payload: { itemId: id } });
        }
      },

      setStory: (id, story) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, story } : it)),
        }));
        sendItemUpdates(get(), { story: true }, [id]);
      },

      assignHeir: (id, personId, visibility) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, heirPersonId: personId, heirVisibility: visibility } : it
          ),
        }));
        // Heir rows are owner-only in the database; a non-owner's device only ever
        // receives the ones marked 'revealed'. See 0014.
        sendItemUpdates(get(), { heir: true }, [id]);
      },

      applyRemoteHeir: (itemId, personId, visibility) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.id === itemId ? { ...it, heirPersonId: personId, heirVisibility: visibility } : it
          ),
        })),

      requestItem: (id, byName) =>
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, requestedBy: byName } : it)),
        })),

      addPerson: (p) => {
        const person = { ...p, id: uid() };
        set((s) => ({ people: [...s.people, person] }));
        const hid = shareTarget(get());
        if (hid) send({ kind: 'person.upsert', householdId: hid, key: person.id, payload: { person } });
      },

      markCloudLinked: (householdId, backedUpAt) =>
        set((s) => ({
          households: s.households.map((h) =>
            h.id === householdId
              ? {
                  ...h,
                  cloudLinkedAt: h.cloudLinkedAt ?? backedUpAt ?? new Date().toISOString(),
                  ...(backedUpAt ? { lastBackupAt: backedUpAt } : {}),
                }
              : h
          ),
        })),

      unlinkHousehold: (householdId) =>
        set((s) => ({
          households: s.households.map((h) =>
            h.id === householdId ? { ...h, cloudLinkedAt: undefined, lastBackupAt: undefined } : h
          ),
        })),

      lockOut: (accountEmail) =>
        set({
          lockedOut: true,
          lastAccountEmail: accountEmail.toLowerCase(),
          pendingLogoutNotice: true,
        }),

      bindAccount: (email, userId) =>
        set((s) => ({
          accountEmail: email.toLowerCase(),
          // A different account's id must never linger next to a new email.
          accountUserId: userId ?? (s.accountEmail === email.toLowerCase() ? s.accountUserId : undefined),
        })),

      unlock: () => set({ lockedOut: false, pendingLogoutNotice: false }),

      clearLogoutNotice: () => set({ pendingLogoutNotice: false }),

      requireSignIn: () => set({ lockedOut: true, pendingLogoutNotice: false }),

      applyRemoteMessage: (m) =>
        set((s) => (s.messages.some((x) => x.id === m.id) ? {} : { messages: [...s.messages, m] })),

      // `f` carries only cloud-owned fields, so merging can never clobber
      // device-local state (photo file, story audio, localOnly) — including
      // when our own write echoes back to us over realtime.
      applyRemoteItem: (f) =>
        set((s) =>
          s.items.some((x) => x.id === f.id)
            ? { items: s.items.map((x) => (x.id === f.id ? { ...x, ...f } : x)) }
            : {
                items: [
                  { tags: [], addedBy: 'Family', heirVisibility: 'owner_only', ...f } as Item,
                  ...s.items,
                ],
              }
        ),

      applyRemoteItemDelete: (id) =>
        set((s) => ({
          items: s.items.filter((i) => i.id !== id),
          messages: s.messages.filter((m) => m.itemId !== id),
        })),

      resetAll: () => set({ ...initial, onboarded: false }),
    }),
    {
      name: 'declutter-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 9,
      /**
       * v1 → v2: chat messages + per-household deciders/creator.
       * v2 → v3: member roster (backfilled from deciders + current user).
       * v3 → v4: ALL ids become UUIDs (and cross-references are remapped) so
       *          local rows and cloud rows share identity — the basis of
       *          multi-device upsert sync.
       * v4 → v5: collections (named item sets); defaults to none.
       * v5 → v6: the cloud link moves from a top-level cloudHouseholdId /
       *          lastBackupAt pair onto the household it describes
       *          (Household.cloudLinkedAt / lastBackupAt).
       * v6 → v7: room records (name + floor + location note), backfilled from
       *          the rooms items already name; and Household.adminNames,
       *          seeded with whoever created the home.
       * v7 → v8: accountEmail — which account this device's data belongs to.
       *          Seeded from lastAccountEmail where the device has one; left
       *          undefined otherwise, which sign-in treats as "unknown" and
       *          resolves against the cloud rather than assuming.
       * v8 → v9: identity core. Authority stops living on the device: the
       *          app-wide `role` becomes the demo-only `demoRole`; `ownerName`,
       *          the roster (`members`) and each household's `deciderNames` /
       *          `adminNames` / `createdBy` are dropped (membership in the
       *          database is the answer now). Default deciders were names and
       *          can't be mapped to user ids safely, so they reset. Other homes'
       *          data gets its own slot (`householdData`). A copy of the
       *          pre-v9 blob is written to `declutter-store-v1:backup-v8`
       *          first, so nothing this migration drops is unrecoverable.
       */
      migrate: (persisted, version) => {
        // Keep the untouched pre-v9 blob before changing anything. Best-effort:
        // a device that can't write it still migrates.
        if (version < 9) {
          try {
            void AsyncStorage.setItem(
              'declutter-store-v1:backup-v8',
              JSON.stringify({ state: persisted, version })
            ).catch(() => {});
          } catch {
            /* storage unavailable */
          }
        }

        type Legacy = Partial<AppState> & {
          cloudHouseholdId?: string;
          lastBackupAt?: string;
          role?: Role;
          ownerName?: string;
          members?: unknown;
        };
        const {
          cloudHouseholdId: legacyLinkId,
          lastBackupAt: legacyBackupAt,
          role: legacyRole,
          ownerName: _ownerName,
          members: _members,
          defaultDeciders: _defaultDeciders,
          ...s
        } = (persisted ?? {}) as Legacy;
        const now = new Date().toISOString();

        // v4: remap legacy short ids → UUIDs, preserving references.
        const idMap = new Map<string, string>();
        const remap = (id: string) => {
          if (!isLegacyId(id)) return id;
          if (!idMap.has(id)) idMap.set(id, uid());
          return idMap.get(id)!;
        };
        const people = (s.people ?? []).map((p) => ({ ...p, id: remap(p.id) }));
        const items = (s.items ?? []).map((i) => ({
          ...i,
          id: remap(i.id),
          heirPersonId: i.heirPersonId ? remap(i.heirPersonId) : undefined,
        }));
        const messages = (s.messages ?? []).map((m) => ({ ...m, id: remap(m.id), itemId: remap(m.itemId) }));

        // v9: households keep identity and cloud link only.
        const linkId = legacyLinkId ? remap(legacyLinkId) : undefined;
        const households: Household[] = (s.households ?? []).map((h) => {
          const { id, name, createdAt, cloudLinkedAt, lastBackupAt } = h as Household;
          const hid = remap(id);
          return {
            id: hid,
            name,
            createdAt: createdAt ?? now,
            // v6: the old top-level link lands on the household it pointed at.
            cloudLinkedAt: cloudLinkedAt ?? (hid === linkId ? (legacyBackupAt ?? now) : undefined),
            lastBackupAt: lastBackupAt ?? (hid === linkId ? legacyBackupAt : undefined),
          };
        });
        const activeHouseholdId = s.activeHouseholdId ? remap(s.activeHouseholdId) : households[0]?.id;

        return {
          ...s,
          demoRole: legacyRole === 'contributor' ? 'contributor' : 'owner',
          userName: s.userName ?? 'Rose',
          messages,
          people,
          items,
          households,
          activeHouseholdId,
          householdData: s.householdData ?? {},
          defaultDeciders: {},
          // v5: collections arrive empty for stores persisted before them.
          collections: s.collections ?? [],
          // v7: back-fill room records so nothing an item names disappears.
          rooms: s.rooms?.length ? s.rooms : roomsFromItems(items, s.userName ?? 'Family', now),
          // v8: the only account we can name for an existing device is the one
          // it last locked against.
          accountEmail: s.accountEmail ?? s.lastAccountEmail,
        } as AppState;
      },
    }
  )
);

/**
 * Undecided queue for the parent's Decide deck (oldest first).
 *
 * NOTE: these array selectors build a NEW array every call. Consume them ONLY
 * through the useShallow-wrapped hooks below — a raw useStore(selectQueue)
 * trips Zustand v5's "getSnapshot should be cached" infinite loop (fatal on
 * React web, silently tolerated by Hermes on device).
 */
/** A decision counts as "recently decided" (flagged) for this long, then it
 *  just lives in its Keep/Donate/Let-go list. */
export const RECENTLY_DECIDED_MS = 24 * 60 * 60 * 1000;

/** True while a decided item is still inside its ~1-day flagged window. */
export const isRecentlyDecided = (i: Item): boolean =>
  i.decision !== 'undecided' &&
  !!i.decidedAt &&
  Date.now() - new Date(i.decidedAt).getTime() < RECENTLY_DECIDED_MS;

/**
 * Did the person using this device capture this item? By user id. Only the
 * demo, and items saved before ids were recorded, fall back to comparing the
 * display name — which is exactly the comparison that used to be trusted for
 * edit and delete rights everywhere.
 */
export const isMine = (
  item: Pick<Item, 'createdById' | 'addedBy'>,
  s: { accountUserId?: string; userName: string; isDemo: boolean }
): boolean =>
  !s.isDemo && item.createdById ? item.createdById === s.accountUserId : item.addedBy === s.userName;

/** The current viewer's display name — a label, never an identity. */
export const selectViewerName = (s: AppState) => s.userName;

/** Undecided items, with the viewer's own flagged items surfaced first. */
export const selectQueue = (s: AppState) => {
  // "Mine first" by user id. The demo has no accounts, so it compares names.
  const mine = (i: Item) =>
    s.isDemo ? i.mainDeciderName === s.userName : Boolean(i.mainDeciderId && i.mainDeciderId === s.accountUserId);
  const rank = (i: Item) => (i.mainDeciderId || i.mainDeciderName ? (mine(i) ? 0 : 2) : 1);
  return s.items
    .filter((i) => i.decision === 'undecided')
    .sort((a, b) => rank(a) - rank(b));
};

/** Items decided within the last day — the "recently decided" review list. */
export const selectRecentlyDecided = (s: AppState) =>
  s.items
    .filter(isRecentlyDecided)
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));

export const useRecentlyDecided = () => useStore(useShallow(selectRecentlyDecided));

/** Kept items for the Keepsakes shelf (newest decision first). */
export const selectKeepsakes = (s: AppState) =>
  s.items
    .filter((i) => i.decision === 'keep')
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));

/** Stable-reference hooks — always use these in components. */
export const useQueue = () => useStore(useShallow(selectQueue));
export const useKeepsakes = () => useStore(useShallow(selectKeepsakes));

/** Chat thread for one item, oldest first. */
export const useItemMessages = (itemId: string) =>
  useStore(useShallow((s: AppState) => s.messages.filter((m) => m.itemId === itemId)));

/** Message count per item id — for chat badges on lists. */
export const useMessageCount = (itemId: string) =>
  useStore((s) => s.messages.reduce((n, m) => (m.itemId === itemId ? n + 1 : n), 0));

/** The household currently open (undefined only if state is corrupt). */
export const selectActiveHousehold = (s: AppState) =>
  s.households.find((h) => h.id === s.activeHouseholdId);

export const useActiveHousehold = () => useStore(useShallow(selectActiveHousehold));

/*
 * Who may decide or administer is NOT answered here any more. It comes from
 * the database membership: see useCanDecide / useIsAdmin in
 * src/lib/membership.ts. These selectors used to match display names against
 * device-held lists that any member could write.
 */

/**
 * Every room of the open household, ordered by floor (FLOORS order first,
 * then anything the family typed, then rooms with no floor set).
 *
 * Includes a stand-in for any room an item names that has no record yet — a
 * room can arrive on an item from another device before its record does, and
 * a room must never be a place where things silently disappear.
 */
export const selectRooms = (s: AppState): Room[] => {
  const known = new Set(s.rooms.map((r) => r.name.toLowerCase()));
  const ghosts: Room[] = [];
  s.items.forEach((i) => {
    const n = i.room?.trim();
    if (!n || known.has(n.toLowerCase())) return;
    known.add(n.toLowerCase());
    ghosts.push({ id: `ghost:${n}`, name: n, createdBy: 'Family', createdAt: '' });
  });
  const rank = (r: Room) => {
    if (!r.floor) return FLOORS.length + 1;
    const i = (FLOORS as readonly string[]).indexOf(r.floor);
    return i === -1 ? FLOORS.length : i;
  };
  return [...s.rooms, ...ghosts].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name)
  );
};

export const useRooms = () => useStore(useShallow(selectRooms));

/** Just the room names, in the same order — for pickers and filters. */
export const useRoomNames = () =>
  useStore(useShallow((s: AppState) => selectRooms(s).map((r) => r.name)));

/** True for a room that exists only because an item names it (no record yet). */
export const isGhostRoom = (r: Room) => r.id.startsWith('ghost:');

/**
 * This person's default decider for the ACTIVE household, or undefined for
 * "anyone". A device preference, keyed by the decider's user id.
 */
export const selectDefaultDecider = (s: AppState): DeciderRef | undefined =>
  s.defaultDeciders[s.activeHouseholdId];

export const useDefaultDecider = () => useStore(selectDefaultDecider);

/** All collections (stable reference), newest first as stored. */
export const useCollections = () => useStore(useShallow((s: AppState) => s.collections));

/** One collection by id (undefined when it was deleted or never synced). */
export const useCollection = (id: string | undefined) =>
  useStore((s) => (id ? s.collections.find((c) => c.id === id) : undefined));

/** Items belonging to one collection (unarchived, stable reference). */
export const useCollectionItems = (collectionId: string) =>
  useStore(
    useShallow((s: AppState) =>
      s.items.filter((i) => i.collectionId === collectionId && !i.archived)
    )
  );

/** Normalized title used for duplicate detection. */
const dupKey = (i: Item) => i.title.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Ids of items whose title matches another item's (case/space-insensitive) —
 * the "did we photograph this twice?" signal for batch capture. Items inside a
 * collection are exempt: forty near-identical coins in a coin collection are
 * intentional, not re-photographs.
 */
export const useDuplicateIds = () =>
  useStore(
    useShallow((s: AppState) => {
      const counts = new Map<string, number>();
      s.items.forEach((i) => {
        if (i.archived || i.collectionId) return;
        const k = dupKey(i);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      });
      return s.items
        .filter((i) => !i.archived && !i.collectionId && (counts.get(dupKey(i)) ?? 0) > 1)
        .map((i) => i.id);
    })
  );

/**
 * Hook form of selectEntitlement. selectEntitlement builds a NEW object every
 * call, which Zustand v5's useSyncExternalStore rejects ("getSnapshot should
 * be cached" → infinite render loop). useShallow compares field-by-field so a
 * new reference is only produced when a value actually changes. Always use
 * THIS in components; call selectEntitlement(state) directly only on a state
 * object you already hold.
 */
export const useEntitlement = () => useStore(useShallow(selectEntitlement));

/** Plan limits + usage, for meters and upgrade prompts. */
export const selectEntitlement = (s: AppState) => {
  const pro = s.plan === 'pro';
  return {
    pro,
    /**
     * Cloud backup, family sharing, multi-device — free for everyone (decided
     * 2026-09-07). Pro is the AI layer only: value estimates + photo splitting.
     */
    cloudEnabled: true,
    itemsUsed: s.items.length,
    householdsUsed: s.households.length,
    // Local use is unlimited and free; nothing is ever "at a limit" now. These
    // stay so older call sites keep type-checking and never block a local add.
    itemLimit: Infinity,
    itemsLeft: Infinity,
    atItemLimit: false,
    nearItemLimit: false,
    householdLimit: Infinity,
    canAddHousehold: true,
  };
};
