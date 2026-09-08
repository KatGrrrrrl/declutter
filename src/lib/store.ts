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
  decidedBy?: string; // display name of the decider who made the call
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

export type MemberStatus = 'invited' | 'active' | 'declined';

/**
 * A household member (or pending invitee). Distinct from `Person` (heirs may
 * never use the app). Anyone may invite; a decider approves or declines.
 * NOTE: with no backend yet, invitations are local records — nothing is sent.
 * Real invite delivery (email/link) arrives with accounts + sync.
 */
export interface Member {
  id: string;
  name: string;
  relationship?: string;
  /** Where the invitation is delivered. Required for new invites. */
  email?: string;
  status: MemberStatus;
  invitedBy: string;
  invitedAt: string;
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
   * Who holds the final say on items in THIS house. Anyone can set a home up
   * (usually the adult child), but only deciders may keep/donate/let-go and
   * assign heirs. Different houses can have different deciders — Mum decides
   * at Mum's house, an aunt at the cottage.
   */
  deciderNames: string[];
  /**
   * Who ADMINISTERS this home — a different job from deciding. Deciders hold
   * the final say over items (keep/donate/let-go, heirs); administrators hold
   * the final say over the household itself: who is in it, and what stays in
   * the record. An administrator may remove any member — a decider included —
   * and remove any item, which is why it is tracked separately instead of
   * being inferred from deciderNames.
   *
   * Seeded with whoever set the home up. A home always keeps at least one.
   */
  adminNames: string[];
  /** Who created the household (may or may not be a decider). */
  createdBy: string;
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

interface AppState {
  // profile / onboarding
  onboarded: boolean;
  role: Role;
  ownerName: string;
  userName: string;
  householdName: string;

  /** All households this user owns; free tier allows one. */
  households: Household[];
  /** Which household the app is currently showing. */
  activeHouseholdId: string;
  /** Subscription state, mirrored from household_plans by billing.refreshPlan(). */
  plan: Plan;
  /** True while the seeded sample household is loaded. */
  isDemo: boolean;

  people: Person[];
  items: Item[];
  /** Named item sets (coin collection, wine cellar, …) for this household. */
  collections: Collection[];
  /** The rooms of the open household, with floor + "how to find it" notes. */
  rooms: Room[];
  /** Per-item family chat threads. */
  messages: ItemMessage[];
  /** Household roster: active members + pending invitations. */
  members: Member[];
  /**
   * This user's default decision-maker per household (household id → decider
   * name). New items they add are flagged as that person's call first. A
   * personal preference, so it lives on the device and is never synced.
   */
  defaultDeciders: Record<string, string>;

  /**
   * Set when the user logs out of their account: the app locks (data stays on
   * device, but re-entry requires signing back in — an inventory of valuables
   * must not stay browsable on a logged-out phone). lastAccountEmail is who
   * may unlock.
   */
  lockedOut?: boolean;
  lastAccountEmail?: string;
  /** True immediately after logging out, so the login screen can confirm it
   *  even though the lock redirect drops any URL params. Consumed once. */
  pendingLogoutNotice?: boolean;
  lockOut: (accountEmail: string) => void;
  unlock: () => void;
  clearLogoutNotice: () => void;
  /**
   * Lock without the "you logged out" notice — for when a session lapses or
   * is missing on load rather than the user tapping Log out.
   */
  requireSignIn: () => void;
  /**
   * Record that a household is in the cloud. Keeps the original link time;
   * `backedUpAt` (when given) stamps the household's last full backup.
   */
  markCloudLinked: (householdId: string, backedUpAt?: string) => void;
  /** The cloud copy is gone (deleted everywhere): the household is local-only again. */
  unlinkHousehold: (householdId: string) => void;
  /** Replace local state wholesale from a cloud restore snapshot. */
  restoreSnapshot: (snap: {
    householdName: string;
    deciderNames: string[];
    adminNames?: string[];
    createdBy: string;
    cloudHouseholdId: string;
    items: Item[];
    people: Person[];
    collections: Collection[];
    rooms?: Room[];
    messages: ItemMessage[];
    members: Member[];
    /** View to land in: contributors join as helpers. */
    role?: Role;
    /** The joining user's own display name (kept if provided). */
    userName?: string;
    /**
     * Items this account captured (cloud `created_by` = me). Restored with
     * addedBy = the user's own name, so their edit/remove rights survive a
     * restore instead of every item reading as "Family".
     */
    selfItemIds?: string[];
  }) => void;
  /**
   * Merge a cloud pull into local state WITHOUT replacing it — the refresh
   * sync CloudBridge runs on every connect/load. Adds items, collections and
   * chat this device has never seen, and overlays the CLOUD-OWNED fields on
   * items it already holds (device-local state — photo uri, story, heirs,
   * main decider, localOnly — is never touched). Deliberately deletes
   * nothing: live deletions arrive over realtime, and a full Restore remains
   * the reset button.
   */
  mergeCloudData: (snap: {
    items: Item[];
    collections: Collection[];
    rooms?: Room[];
    messages: ItemMessage[];
    selfItemIds?: string[];
  }) => void;
  /** Merge one realtime row from another family member's device. */
  applyRemoteMessage: (m: ItemMessage) => void;
  /** Apply an item INSERT/UPDATE arriving from another device. */
  applyRemoteItem: (f: RemoteItemFields) => void;
  /** Apply an item DELETE arriving from another device. */
  applyRemoteItemDelete: (id: string) => void;

  // actions
  completeOnboarding: (opts: {
    role: Role;
    householdName: string;
    userName: string;
    startEmpty?: boolean;
    /** Final-say holders for the new household; defaults to the creator. */
    deciderNames?: string[];
    /** People invited during setup (deciders are auto-included). */
    invites?: { name: string; relationship?: string; email?: string }[];
    /** Emails for the auto-invited deciders, keyed by decider name. */
    deciderEmails?: Record<string, string>;
  }) => void;
  /** Invite a family member (any role may invite; a decider approves). */
  inviteMember: (name: string, relationship?: string, email?: string) => void;
  /** Decider actions on pending invitations. */
  approveMember: (id: string) => void;
  declineMember: (id: string) => void;
  reinviteMember: (id: string) => void;
  /**
   * Remove someone from the household entirely — an ADMINISTRATOR action, and
   * the one place a decider can be removed. Drops the roster row, their
   * decider/administrator standing, and (when linked) revokes their cloud
   * membership so the removal is real rather than cosmetic.
   *
   * Refuses to leave the home unrunnable: the last administrator and the last
   * decider both stay. Their items and stories are untouched — removing a
   * person is not removing what they catalogued.
   */
  removeMember: (id: string) => { ok: boolean; reason?: 'last-admin' | 'last-decider' | 'missing' };
  /** Grant/revoke administrator standing in the open household (admins only). */
  setAdmin: (name: string, isAdmin: boolean) => { ok: boolean; reason?: 'last-admin' };
  /** Wipe everything and return to the welcome screen (the "log out"). */
  signOut: () => void;
  /** Replace demo content with an empty household of the same name. */
  startFresh: (householdName?: string) => void;
  addHousehold: (
    name: string,
    deciderNames?: string[]
  ) => { ok: boolean; reason?: 'limit' };
  switchHousehold: (id: string) => void;
  /** Rename a household; mirrors to the cloud when it's the linked one (owner-only there, via RLS). */
  renameHousehold: (id: string, name: string) => void;
  /**
   * Remove a household from THIS DEVICE. Never touches the cloud — a synced
   * copy stays in the account (Settings offers the owner-only cloud delete
   * separately). Removing the open household clears the local data arrays,
   * which belong to it, and lands in the next household. Refuses to remove
   * the last one.
   */
  removeHousehold: (id: string) => { ok: boolean; reason?: 'last' };
  /** Post a chat message on an item, authored by the current user. */
  addMessage: (itemId: string, text: string) => void;
  setPlan: (plan: Plan) => void;
  setRole: (role: Role) => void; // demo-mode view switch
  decide: (id: string, decision: Decision) => void;
  undoDecision: (id: string) => void;
  /** Flag one of the household's deciders as this item's primary decider (or clear). */
  setMainDecider: (id: string, name: string | undefined) => void;
  /** This user's default decider for a household — applied to items they add (undefined = anyone). */
  setDefaultDecider: (householdId: string, name: string | undefined) => void;
  /** Returns ok:false when the free item limit is reached. */
  addItem: (
    item: Omit<Item, 'id' | 'createdAt' | 'decision' | 'heirVisibility' | 'isSentimental' | 'tags'> &
      Partial<Item>
  ) => { ok: boolean; reason?: 'limit' };
  updateItem: (id: string, patch: Partial<Item>) => void;
  /**
   * Remove an item (and its chat). UI gates this to: deciders always; the
   * capturer while the item is still undecided. Cloud delete rides along
   * when linked (RLS enforces the same rule server-side).
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
   * Edit a room. Renaming rewrites `room` on every item in it (and pushes
   * those to the cloud) — the name IS the link between item and room.
   */
  updateRoom: (
    id: string,
    patch: { name?: string; floor?: string; locationNote?: string }
  ) => { ok: boolean; reason?: 'blank' | 'duplicate' };
  /**
   * Delete a room — administrators only in the UI. Refuses while items are
   * still in it: an empty room is a tidy-up, a full one would orphan things
   * the family catalogued. Move them first.
   */
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
const uid = (): string => {
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

const seedMembers: Member[] = [
  {
    id: '00000000-0000-4000-8000-0000000000c1', name: 'Rose', relationship: 'Mum', status: 'active',
    invitedBy: 'Sam', invitedAt: '2026-06-27T09:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000c2', name: 'Sam', relationship: 'Son', status: 'active',
    invitedBy: 'Sam', invitedAt: '2026-06-27T09:00:00Z',
  },
  {
    id: '00000000-0000-4000-8000-0000000000c3', name: 'Maya', relationship: 'Daughter', status: 'active',
    invitedBy: 'Sam', invitedAt: '2026-06-27T09:30:00Z',
  },
  // Pending invitation — demos the decider approval flow on Family.
  {
    id: '00000000-0000-4000-8000-0000000000c4', name: 'Noor', relationship: 'Granddaughter', status: 'invited',
    invitedBy: 'Maya', invitedAt: '2026-07-15T12:00:00Z',
  },
];

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
const startingRooms = (createdBy: string, now: string): Room[] =>
  DEFAULT_ROOMS.map((name) => ({ id: uid(), name, createdBy, createdAt: now }));

/**
 * Room records inferred from the rooms items already name, plus the defaults.
 * The backfill for anything that predates room records — a store persisted
 * before this feature, or a cloud copy restored without room rows.
 */
const roomsFromItems = (items: Item[], createdBy: string, now: string): Room[] => {
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
  role: 'owner' as Role,
  ownerName: 'Rose',
  userName: 'Rose',
  householdName: 'The Lakehouse',
  households: [
    {
      id: DEMO_HOUSEHOLD_ID,
      name: 'The Lakehouse',
      createdAt: '2026-06-27T09:00:00Z',
      // Sam (the son) set the home up; Rose holds the final say — the
      // recommended shape: anyone starts it, the family designates deciders.
      deciderNames: ['Rose'],
      // Sam set it up, so Sam administers it — Rose still holds every item
      // decision. The two jobs are deliberately different people here.
      adminNames: ['Sam'],
      createdBy: 'Sam',
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
  members: seedMembers,
  defaultDeciders: {} as Record<string, string>,
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
 * Mirror an item edit to the cloud so other devices see it without a manual
 * backup. Call AFTER set(), with the ids that changed.
 *
 * Fire-and-forget by design: every failure is silent, because the change is
 * already saved locally and the next full backup carries it. Skips demo data
 * and `localOnly` items, which never leave the device.
 */
function pushItemChange(s: AppState, ...ids: string[]) {
  const hid = linkedCloudId(s);
  if (!hid) return;
  const changed = ids
    .map((id) => s.items.find((i) => i.id === id))
    .filter((i): i is Item => !!i && !i.localOnly);
  if (!changed.length) return;
  void (async () => {
    try {
      // One batch: user and role resolved once, collections uploaded once,
      // item updates in parallel, tags as a single replace-set. A one-swipe
      // collection decide used to fan out into ~7 sequential round trips per
      // item — forty coins was ~280 requests, each waiting on the last.
      const { pushItemUpdates } = await import('@/lib/sync');
      await pushItemUpdates(changed, hid, s.collections);
    } catch {
      /* offline — the next backup carries it */
    }
  })();
}

/**
 * Mirror a room add/edit to the cloud. Same fire-and-forget contract as
 * pushItemChange: the change is already saved locally, and a failure just
 * means the next full backup carries it.
 *
 * Rooms go up eagerly (unlike collections, which wait for a synced item):
 * the point of the room map is that the whole family can see where things are,
 * including rooms nobody has photographed yet.
 */
function pushRoomChange(s: AppState, room: Room, previousName?: string) {
  const hid = linkedCloudId(s);
  if (!hid) return;
  void (async () => {
    try {
      const { pushRoom } = await import('@/lib/sync');
      await pushRoom(room, hid, previousName);
    } catch {
      /* offline — the next backup carries it */
    }
  })();
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial,

      completeOnboarding: ({ role, householdName, userName, startEmpty, deciderNames, invites, deciderEmails }) =>
        set(() => {
          const id = uid();
          const now = new Date().toISOString();
          const deciders = deciderNames?.length ? deciderNames : [userName];
          // Roster: creator is active immediately; named deciders and any
          // setup invitees start as 'invited' (they haven't joined yet).
          // Dedupe by name, creator wins.
          const roster: Member[] = [
            { id: uid(), name: userName, status: 'active', invitedBy: userName, invitedAt: now },
          ];
          const addInvite = (name: string, relationship?: string, email?: string) => {
            const trimmed = name.trim();
            if (!trimmed || roster.some((m) => m.name.toLowerCase() === trimmed.toLowerCase()))
              return;
            roster.push({
              id: uid(),
              name: trimmed,
              relationship,
              email: email?.trim().toLowerCase() || undefined,
              status: 'invited',
              invitedBy: userName,
              invitedAt: now,
            });
          };
          deciders.forEach((d) => addInvite(d, 'Final say', deciderEmails?.[d]));
          invites?.forEach((i) => addInvite(i.name, i.relationship, i.email));
          // A real household starts empty: no sample items, no sample heirs.
          const fresh = startEmpty
            ? {
                items: [] as Item[],
                people: [] as Person[],
                collections: [] as Collection[],
                rooms: startingRooms(userName, now),
                messages: [] as ItemMessage[],
                members: roster,
                isDemo: false,
                households: [
                  {
                    id,
                    name: householdName,
                    createdAt: now,
                    deciderNames: deciders,
                    // Whoever sets the home up administers it. The deciders
                    // they named are usually invitees who haven't joined yet,
                    // so handing them the roster would deadlock it.
                    adminNames: [userName],
                    createdBy: userName,
                  },
                ] as Household[],
                activeHouseholdId: id,
                ownerName: deciders[0] ?? userName,
              }
            : {};
          return { onboarded: true, role, householdName, userName, ...fresh };
        }),

      inviteMember: (name, relationship, email) => {
        const s = get();
        const trimmed = name.trim();
        if (!trimmed) return;
        if (s.members.some((m) => m.name.toLowerCase() === trimmed.toLowerCase())) return;
        set({
          members: [
            ...s.members,
            {
              id: uid(),
              name: trimmed,
              relationship,
              email: email?.trim().toLowerCase() || undefined,
              status: 'invited',
              invitedBy: s.userName,
              invitedAt: new Date().toISOString(),
            },
          ],
        });
      },

      approveMember: (id) =>
        set((s) => ({
          members: s.members.map((m) => (m.id === id ? { ...m, status: 'active' as const } : m)),
        })),

      declineMember: (id) =>
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id ? { ...m, status: 'declined' as const } : m
          ),
        })),

      // Asking someone again after they said no. Back to 'invited', with the
      // clock restarted — a second invitation is a new invitation, and the
      // roster should not still be dated to the one that was refused.
      reinviteMember: (id) =>
        set((s) => ({
          members: s.members.map((m) =>
            m.id === id
              ? { ...m, status: 'invited' as const, invitedBy: s.userName, invitedAt: new Date().toISOString() }
              : m
          ),
        })),

      removeMember: (id) => {
        const s = get();
        const member = s.members.find((m) => m.id === id);
        const household = s.households.find((h) => h.id === s.activeHouseholdId);
        if (!member || !household) return { ok: false, reason: 'missing' as const };

        const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
        const admins = household.adminNames ?? [household.createdBy];
        // A home with nobody to administer it can never let anyone back in,
        // and one with nobody to decide can never empty its queue. Both are
        // dead ends the UI must steer around rather than land in.
        if (admins.some((a) => same(a, member.name)) && admins.length <= 1) {
          return { ok: false, reason: 'last-admin' as const };
        }
        if (
          household.deciderNames.some((d) => same(d, member.name)) &&
          household.deciderNames.length <= 1
        ) {
          return { ok: false, reason: 'last-decider' as const };
        }

        set({
          members: s.members.filter((m) => m.id !== id),
          households: s.households.map((h) =>
            h.id === household.id
              ? {
                  ...h,
                  deciderNames: h.deciderNames.filter((d) => !same(d, member.name)),
                  adminNames: (h.adminNames ?? [h.createdBy]).filter(
                    (a) => !same(a, member.name)
                  ),
                }
              : h
          ),
        });

        // Cloud: drop the roster line AND revoke the real membership, so a
        // removed person actually loses access rather than just vanishing from
        // this device's list. Both are owner-gated by RLS; a non-owner's calls
        // simply touch no rows. Their items and stories stay — removing a
        // person is not removing what they catalogued.
        const hid = linkedCloudId(s);
        if (hid) {
          void (async () => {
            try {
              const { supabase } = await import('@/lib/supabase');
              await supabase
                .from('roster_entries')
                .delete()
                .eq('household_id', hid)
                .eq('name', member.name);
              if (member.email) {
                await supabase
                  .from('household_members')
                  .update({ status: 'revoked' })
                  .eq('household_id', hid)
                  .eq('invited_email', member.email.toLowerCase())
                  .in('status', ['invited', 'active']);
              }
            } catch {
              /* offline — the next backup re-mirrors the roster without them */
            }
          })();
        }
        return { ok: true };
      },

      setAdmin: (name, isAdmin) => {
        const s = get();
        const household = s.households.find((h) => h.id === s.activeHouseholdId);
        if (!household) return { ok: false };
        const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
        const admins = household.adminNames ?? [household.createdBy];
        if (!isAdmin && admins.length <= 1 && admins.some((a) => same(a, name))) {
          return { ok: false, reason: 'last-admin' as const };
        }
        const next = isAdmin
          ? admins.some((a) => same(a, name))
            ? admins
            : [...admins, name]
          : admins.filter((a) => !same(a, name));
        set({
          households: s.households.map((h) =>
            h.id === household.id ? { ...h, adminNames: next } : h
          ),
        });
        return { ok: true };
      },

      signOut: () => set({ ...initial }),

      startFresh: (householdName) =>
        set((s) => {
          const id = uid();
          const name = householdName ?? s.householdName;
          const now = new Date().toISOString();
          return {
            items: [],
            people: [],
            collections: [],
            rooms: startingRooms(s.userName, now),
            messages: [],
            members: [
              { id: uid(), name: s.userName, status: 'active' as const, invitedBy: s.userName, invitedAt: now },
            ],
            isDemo: false,
            householdName: name,
            households: [
              {
                id,
                name,
                createdAt: now,
                deciderNames: [s.userName],
                adminNames: [s.userName],
                createdBy: s.userName,
              },
            ],
            activeHouseholdId: id,
            ownerName: s.role === 'owner' ? s.userName : s.ownerName,
          };
        }),

      addHousehold: (name, deciderNames) => {
        const s = get();
        if (s.plan === 'free' && s.households.length >= FREE_HOUSEHOLD_LIMIT) {
          return { ok: false, reason: 'limit' as const };
        }
        const id = uid();
        set({
          households: [
            ...s.households,
            {
              id,
              name,
              createdAt: new Date().toISOString(),
              deciderNames: deciderNames?.length ? deciderNames : [s.userName],
              adminNames: [s.userName],
              createdBy: s.userName,
            },
          ],
          activeHouseholdId: id,
          householdName: name,
        });
        return { ok: true };
      },

      addMessage: (itemId, text) => {
        const s = get();
        const trimmed = text.trim();
        if (!trimmed) return;
        const msg = {
          id: uid(),
          itemId,
          author: s.userName,
          text: trimmed,
          createdAt: new Date().toISOString(),
        };
        set({ messages: [...s.messages, msg] });
        // Fire-and-forget cloud push so family sees it live; realtime echoes
        // are deduped by id in applyRemoteMessage. Never blocks the UI.
        if (linkedCloudId(s)) {
          void (async () => {
            try {
              const { supabase } = await import('@/lib/supabase');
              const { data: auth } = await supabase.auth.getUser();
              if (!auth?.user) return;
              await supabase.from('item_messages').insert({
                id: msg.id,
                item_id: msg.itemId,
                author: auth.user.id,
                author_name: msg.author,
                body: msg.text,
                created_at: msg.createdAt,
              });
            } catch {
              /* offline or unsynced item — the next Back up covers it */
            }
          })();
        }
      },

      switchHousehold: (id) =>
        set((s) => {
          const h = s.households.find((x) => x.id === id);
          // Nothing to clean up: the cloud link lives on each household record,
          // so the one we open brings its own.
          return h ? { activeHouseholdId: id, householdName: h.name } : {};
        }),

      renameHousehold: (id, name) => {
        const s = get();
        const trimmed = name.trim();
        if (!trimmed || !s.households.some((h) => h.id === id)) return;
        set({
          households: s.households.map((h) => (h.id === id ? { ...h, name: trimmed } : h)),
          ...(s.activeHouseholdId === id ? { householdName: trimmed } : {}),
        });
        // Mirror to the cloud when this is the linked household. RLS makes the
        // cloud rename owner-only — a contributor's update just touches 0 rows
        // (and the owner's next backup would restore the family name anyway).
        if (linkedCloudId(s) === id) {
          void (async () => {
            try {
              const { supabase } = await import('@/lib/supabase');
              await supabase.from('households').update({ name: trimmed }).eq('id', id);
            } catch {
              /* offline — the next owner backup carries the name */
            }
          })();
        }
      },

      removeHousehold: (id) => {
        const s = get();
        if (!s.households.some((h) => h.id === id)) return { ok: true };
        if (s.households.length <= 1) return { ok: false, reason: 'last' as const };
        const remaining = s.households.filter((h) => h.id !== id);
        if (s.activeHouseholdId !== id) {
          // Not the open one: its data isn't loaded, so only the entry goes.
          set({ households: remaining });
          return { ok: true };
        }
        // Removing the household that's open: the local arrays hold ITS data,
        // so they go with it (same shape as startFresh), and we land in the
        // next household — empty here until CloudBridge restores it if synced.
        const next = remaining[0];
        const now = new Date().toISOString();
        set({
          households: remaining,
          activeHouseholdId: next.id,
          householdName: next.name,
          items: [],
          people: [],
          collections: [],
          rooms: startingRooms(s.userName, now),
          messages: [],
          members: [
            { id: uid(), name: s.userName, status: 'active' as const, invitedBy: s.userName, invitedAt: now },
          ],
        });
        return { ok: true };
      },

      setPlan: (plan) => set({ plan }),

      setRole: (role) => set({ role }),

      decide: (id, decision) => {
        set((s) => {
          const by = s.role === 'owner' ? s.ownerName : s.userName;
          return {
            items: s.items.map((it) =>
              it.id === id
                ? { ...it, decision, decidedAt: new Date().toISOString(), decidedBy: by }
                : it
            ),
          };
        });
        pushItemChange(get(), id);
      },

      setMainDecider: (id, name) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, mainDeciderName: name } : it)),
        }));
        // Whose call it is belongs to the family, not the device (0014).
        pushItemChange(get(), id);
      },

      setDefaultDecider: (householdId, name) =>
        set((s) => {
          const next = { ...s.defaultDeciders };
          if (name) next[householdId] = name;
          else delete next[householdId];
          return { defaultDeciders: next };
        }),

      undoDecision: (id) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id
              ? { ...it, decision: 'undecided', decidedAt: undefined, decidedBy: undefined }
              : it
          ),
        }));
        pushItemChange(get(), id);
      },

      addItem: (item) => {
        const s = get();
        if (s.plan === 'free' && s.items.length >= FREE_ITEM_LIMIT) {
          return { ok: false, reason: 'limit' as const };
        }
        // Route it to this user's default decider unless the caller said otherwise.
        const mainDeciderName = item.mainDeciderName ?? selectDefaultDecider(s);
        set({
          items: [
            {
              decision: 'undecided',
              heirVisibility: 'owner_only',
              isSentimental: false,
              tags: [],
              ...item,
              mainDeciderName,
              id: uid(),
              createdAt: new Date().toISOString(),
            } as Item,
            ...s.items,
          ],
        });
        return { ok: true };
      },

      updateItem: (id, patch) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        }));
        // Story, heir, photo uri, main decider… are device-local: no round
        // trip (and no tag churn) unless a cloud-owned field actually changed.
        if ((Object.keys(patch) as (keyof Item)[]).some((k) => CLOUD_ITEM_KEYS.has(k))) {
          pushItemChange(get(), id);
        }
      },

      setArchived: (id, archived) => {
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, archived } : it)),
        }));
        pushItemChange(get(), id);
      },

      bulkDecide: (ids, decision, donate) => {
        set((s) => {
          const at = new Date().toISOString();
          const by = s.role === 'owner' ? s.ownerName : s.userName;
          const undecided = decision === 'undecided';
          const set_ = new Set(ids);
          return {
            items: s.items.map((it) =>
              set_.has(it.id)
                ? {
                    ...it,
                    decision,
                    decidedAt: undecided ? undefined : at,
                    decidedBy: undecided ? undefined : by,
                    ...(donate && decision === 'donate'
                      ? { donateTo: donate.donateTo, donateToKind: donate.donateToKind }
                      : {}),
                  }
                : it
            ),
          };
        });
        pushItemChange(get(), ...ids);
      },

      bulkSetRoom: (ids, room) => {
        set((s) => {
          const set_ = new Set(ids);
          return { items: s.items.map((it) => (set_.has(it.id) ? { ...it, room } : it)) };
        });
        pushItemChange(get(), ...ids);
      },

      bulkArchive: (ids, archived) => {
        set((s) => {
          const set_ = new Set(ids);
          return { items: s.items.map((it) => (set_.has(it.id) ? { ...it, archived } : it)) };
        });
        pushItemChange(get(), ...ids);
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
          createdBy: viewerName(s),
          createdAt: new Date().toISOString(),
        };
        set({ rooms: [...s.rooms, room] });
        pushRoomChange(get(), room);
        return { ok: true, id: room.id };
      },

      updateRoom: (id, patch) => {
        const s = get();
        const room = s.rooms.find((r) => r.id === id);
        if (!room) return { ok: false };
        const name = patch.name?.trim();
        if (patch.name !== undefined && !name) return { ok: false, reason: 'blank' as const };
        const renamed = Boolean(name && name.toLowerCase() !== room.name.toLowerCase());
        if (
          name &&
          s.rooms.some((r) => r.id !== id && r.name.toLowerCase() === name.toLowerCase())
        ) {
          return { ok: false, reason: 'duplicate' as const };
        }
        const next: Room = {
          ...room,
          ...(name ? { name } : {}),
          ...(patch.floor !== undefined ? { floor: patch.floor.trim() || undefined } : {}),
          ...(patch.locationNote !== undefined
            ? { locationNote: patch.locationNote.trim() || undefined }
            : {}),
        };
        // The room's NAME is what items point at, so a rename has to carry the
        // items with it — otherwise they'd all fall out into a ghost room.
        const movedIds = renamed
          ? s.items.filter((i) => i.room === room.name).map((i) => i.id)
          : [];
        set({
          rooms: s.rooms.map((r) => (r.id === id ? next : r)),
          ...(renamed
            ? {
                items: s.items.map((i) =>
                  i.room === room.name ? { ...i, room: next.name } : i
                ),
              }
            : {}),
        });
        pushRoomChange(get(), next, renamed ? room.name : undefined);
        if (movedIds.length) pushItemChange(get(), ...movedIds);
        return { ok: true };
      },

      removeRoom: (id) => {
        const s = get();
        const room = s.rooms.find((r) => r.id === id);
        if (!room) return { ok: true };
        const count = s.items.filter((i) => i.room === room.name).length;
        if (count > 0) return { ok: false, reason: 'not-empty' as const, count };
        set({ rooms: s.rooms.filter((r) => r.id !== id) });
        const hid = linkedCloudId(s);
        if (hid) {
          void (async () => {
            try {
              // By NAME, not id: whichever device synced the room first minted
              // the cloud row's id, so ours may not match it.
              const { deleteRoom } = await import('@/lib/sync');
              await deleteRoom(room.name, hid);
            } catch {
              /* offline — the row stays until a future cleanup */
            }
          })();
        }
        return { ok: true };
      },

      addCollection: (name, note) => {
        const s = get();
        const trimmed = name.trim();
        const existing = s.collections.find(
          (c) => c.name.toLowerCase() === trimmed.toLowerCase()
        );
        if (existing) return existing.id; // creating "Coins" twice just reuses it
        const col: Collection = {
          id: uid(),
          name: trimmed,
          note: note?.trim() || undefined,
          createdBy: viewerName(s),
          createdAt: new Date().toISOString(),
        };
        set({ collections: [col, ...s.collections] });
        // The cloud row is uploaded lazily, alongside the first synced item
        // that references it — a collection holding only localOnly items never
        // leaks even its name (see sync.ts).
        return col.id;
      },

      updateCollection: (id, patch) => {
        const s = get();
        const name = patch.name?.trim();
        set({
          collections: s.collections.map((c) =>
            c.id === id
              ? { ...c, ...(name ? { name } : {}), note: patch.note ?? c.note }
              : c
          ),
        });
        const hid = linkedCloudId(s);
        if (!hid) return;
        void (async () => {
          try {
            const { pushCollectionUpdate } = await import('@/lib/sync');
            const next = get().collections.find((c) => c.id === id);
            if (next) await pushCollectionUpdate(next);
          } catch {
            /* offline — the next backup carries it */
          }
        })();
      },

      removeCollection: (id) => {
        const s = get();
        set({
          collections: s.collections.filter((c) => c.id !== id),
          items: s.items.map((it) =>
            it.collectionId === id ? { ...it, collectionId: undefined } : it
          ),
        });
        // Cloud FK is ON DELETE SET NULL, so this one delete un-groups the
        // cloud rows too; deleting a never-uploaded collection is a no-op.
        if (linkedCloudId(s)) {
          void (async () => {
            try {
              const { supabase } = await import('@/lib/supabase');
              await supabase.from('collections').delete().eq('id', id);
            } catch {
              /* offline — the row stays until a future cleanup */
            }
          })();
        }
      },

      setItemCollection: (itemId, collectionId) => {
        get().updateItem(itemId, { collectionId });
      },

      bulkSetCollection: (ids, collectionId) => {
        set((s) => {
          const set_ = new Set(ids);
          return {
            items: s.items.map((it) => (set_.has(it.id) ? { ...it, collectionId } : it)),
          };
        });
        pushItemChange(get(), ...ids);
      },

      removeItem: (id) => {
        const s = get();
        set({
          items: s.items.filter((it) => it.id !== id),
          messages: s.messages.filter((m) => m.itemId !== id),
        });
        if (linkedCloudId(s)) {
          void (async () => {
            try {
              const { supabase } = await import('@/lib/supabase');
              const { data: auth } = await supabase.auth.getUser();
              if (!auth?.user) return;
              await supabase.from('items').delete().eq('id', id);
            } catch {
              /* offline — the row stays in cloud until a future cleanup */
            }
          })();
        }
      },

      setStory: (id, story) =>
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, story } : it)),
        })),

      assignHeir: (id, personId, visibility) => {
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, heirPersonId: personId, heirVisibility: visibility } : it
          ),
        }));
        // Mirrored to heir_assignments (owner-only rows; a non-owner device
        // only ever receives the ones marked 'revealed'). See 0014.
        pushItemChange(get(), id);
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

      addPerson: (p) =>
        set((s) => ({ people: [...s.people, { ...p, id: uid() }] })),

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

      unlock: () => set({ lockedOut: false, pendingLogoutNotice: false }),

      clearLogoutNotice: () => set({ pendingLogoutNotice: false }),

      requireSignIn: () => set({ lockedOut: true, pendingLogoutNotice: false }),

      restoreSnapshot: (snap) =>
        set((s) => {
          // Local household id mirrors the cloud id (they're the same row).
          const id = snap.cloudHouseholdId;
          const userName = snap.userName ?? s.userName;
          const mine = new Set(snap.selfItemIds ?? []);
          const items = mine.size
            ? snap.items.map((i) => (mine.has(i.id) ? { ...i, addedBy: userName } : i))
            : snap.items;
          const now = new Date().toISOString();
          const prev = s.households.find((h) => h.id === id);
          const restored: Household = {
            id,
            name: snap.householdName,
            createdAt: prev?.createdAt ?? now,
            deciderNames: snap.deciderNames,
            // Fall back to whoever set the home up: a household restored from
            // a cloud copy written before administrators existed has no
            // is_admin flags to read, and must not come back unadministered.
            adminNames: snap.adminNames?.length
              ? snap.adminNames
              : (prev?.adminNames ?? [snap.createdBy]),
            createdBy: snap.createdBy,
            // It came from the cloud, so it is linked from the first moment.
            cloudLinkedAt: prev?.cloudLinkedAt ?? now,
            lastBackupAt: now,
          };
          // Merge, never replace: a restore (or accepting an invitation) brings
          // ONE home onto this device — the other homes already here stay, as
          // the Account & sync copy promises. Only the demo is dropped, the
          // same as every other path that starts a real home.
          const others = s.isDemo ? [] : s.households.filter((h) => h.id !== id);
          return {
            onboarded: true,
            isDemo: false,
            role: snap.role ?? s.role,
            userName,
            householdName: snap.householdName,
            households: [...others, restored],
            activeHouseholdId: id,
            ownerName: snap.deciderNames[0] ?? snap.createdBy,
            items,
            people: snap.people,
            collections: snap.collections,
            // A home with no room rows in the cloud (or restored from an older
            // copy) still needs somewhere to put things: fall back to the
            // rooms its items name, then to the defaults.
            rooms: snap.rooms?.length
              ? snap.rooms
              : roomsFromItems(items, snap.createdBy, now),
            messages: snap.messages,
            members: snap.members,
          };
        }),

      mergeCloudData: ({ items, collections, rooms, messages, selfItemIds }) =>
        set((s) => {
          const cloudById = new Map(items.map((i) => [i.id, i]));
          const localIds = new Set(s.items.map((i) => i.id));
          const mine = new Set(selfItemIds ?? []);
          // Items this device holds: overlay only what the cloud row owns —
          // the same field set realtime merges — plus the photo path.
          const merged = s.items.map((local) => {
            const cloud = cloudById.get(local.id);
            if (!cloud) return local; // localOnly, or pushed after this pull
            return {
              ...local,
              title: cloud.title,
              room: cloud.room,
              decision: cloud.decision,
              decidedAt: cloud.decidedAt,
              decidedBy: cloud.decidedBy,
              marketValue: cloud.marketValue,
              isSentimental: cloud.isSentimental,
              donateTo: cloud.donateTo,
              donateToKind: cloud.donateToKind,
              archived: cloud.archived,
              collectionId: cloud.collectionId,
              // Cloud-owned since 0014. An owner's pull carries every
              // assignment; a non-owner's carries only the revealed ones,
              // which is all that device may hold anyway.
              mainDeciderName: cloud.mainDeciderName,
              heirPersonId: cloud.heirPersonId,
              heirVisibility: cloud.heirVisibility,
              remotePhotoPath: cloud.remotePhotoPath ?? local.remotePhotoPath,
              story: local.story ?? cloud.story,
            };
          });
          // Items the cloud has that this device has never seen.
          const fresh = items
            .filter((i) => !localIds.has(i.id))
            .map((i) => (mine.has(i.id) ? { ...i, addedBy: s.userName } : i));
          // Collections: the cloud copy wins on name/note; collections only
          // this device knows (e.g. holding localOnly items) survive.
          const cloudColIds = new Set(collections.map((c) => c.id));
          const mergedCols = [
            ...collections,
            ...s.collections.filter((c) => !cloudColIds.has(c.id)),
          ];
          // Rooms merge by NAME, not id: two devices that both typed "Attic"
          // before either synced hold different room ids for the same room,
          // and the family should end up with one Attic, not two. The cloud
          // copy wins on floor/location; rooms only this device knows survive.
          const cloudRooms = rooms ?? [];
          const cloudRoomNames = new Set(cloudRooms.map((r) => r.name.toLowerCase()));
          const mergedRooms = cloudRooms.length
            ? [...cloudRooms, ...s.rooms.filter((r) => !cloudRoomNames.has(r.name.toLowerCase()))]
            : s.rooms;
          const msgIds = new Set(s.messages.map((m) => m.id));
          const freshMsgs = messages.filter((m) => !msgIds.has(m.id));
          return {
            items: [...fresh, ...merged],
            collections: mergedCols,
            rooms: mergedRooms,
            messages: [...s.messages, ...freshMsgs],
          };
        }),

      applyRemoteMessage: (m) =>
        set((s) =>
          s.messages.some((x) => x.id === m.id)
            ? {}
            : { messages: [...s.messages, m] }
        ),

      // `f` carries only cloud-owned fields, so merging can never clobber
      // local state (tags, addedBy, photoUri, story, heirs, main decider) —
      // including when our own write echoes back to us over realtime.
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
      version: 7,
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
       */
      migrate: (persisted) => {
        // Pre-v6 stores carry the link beside the households, not on them.
        const {
          cloudHouseholdId: legacyLinkId,
          lastBackupAt: legacyBackupAt,
          ...s
        } = persisted as Partial<AppState> & { cloudHouseholdId?: string; lastBackupAt?: string };
        const now = new Date().toISOString();
        const households = (s.households ?? []).map((h) => {
          const createdBy = h.createdBy ?? s.userName ?? 'Rose';
          return {
            ...h,
            deciderNames: h.deciderNames ?? [s.ownerName ?? 'Rose'],
            createdBy,
            // v7: whoever set the home up administers it, which is exactly the
            // rule the Family screen already applied ad hoc before this field.
            adminNames: h.adminNames?.length ? h.adminNames : [createdBy],
          };
        });
        let members = s.members;
        if (!members) {
          const names = new Set<string>();
          members = [];
          const push = (name: string | undefined, status: MemberStatus) => {
            if (!name || names.has(name.toLowerCase())) return;
            names.add(name.toLowerCase());
            members!.push({
              id: uid(),
              name,
              status,
              invitedBy: s.userName ?? name,
              invitedAt: now,
            });
          };
          push(s.userName, 'active');
          households.forEach((h) => h.deciderNames.forEach((d) => push(d, 'active')));
        }

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
        const messages = (s.messages ?? []).map((m) => ({
          ...m,
          id: remap(m.id),
          itemId: remap(m.itemId),
        }));
        const members4 = members.map((m) => ({ ...m, id: remap(m.id) }));
        const households4 = households.map((h) => ({ ...h, id: remap(h.id) }));
        const activeHouseholdId = s.activeHouseholdId
          ? remap(s.activeHouseholdId)
          : households4[0]?.id;

        // v6: put the old top-level link onto the household it pointed at.
        const linkId = legacyLinkId ? remap(legacyLinkId) : undefined;
        const households6 = households4.map((h) =>
          h.id === linkId && !h.cloudLinkedAt
            ? { ...h, cloudLinkedAt: legacyBackupAt ?? now, lastBackupAt: legacyBackupAt }
            : h
        );

        return {
          ...s,
          messages,
          people,
          items,
          members: members4,
          households: households6,
          activeHouseholdId,
          // v5: collections arrive empty for stores persisted before them.
          collections: s.collections ?? [],
          // v7: back-fill room records so nothing an item names disappears.
          rooms: s.rooms?.length
            ? s.rooms
            : roomsFromItems(items, households[0]?.createdBy ?? s.userName ?? 'Family', now),
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

/** The current viewer's display name (owner or member). */
const viewerName = (s: AppState) => (s.role === 'owner' ? s.ownerName : s.userName);
export const selectViewerName = viewerName;

/** Undecided items, with the viewer's own flagged items surfaced first. */
export const selectQueue = (s: AppState) => {
  const me = viewerName(s);
  const rank = (i: Item) =>
    i.mainDeciderName ? (i.mainDeciderName === me ? 0 : 2) : 1;
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

/**
 * Whether the current user holds the final say in the ACTIVE household.
 * (In demo mode the view toggle also flips userName-vs-ownerName roles, so
 * role is still consulted; once real auth exists this becomes purely
 * membership-based.)
 */
export const selectCanDecide = (s: AppState) => {
  const h = selectActiveHousehold(s);
  if (!h) return s.role === 'owner';
  const name = s.role === 'owner' ? s.ownerName : s.userName;
  return h.deciderNames.includes(name) || s.role === 'owner';
};

export const useCanDecide = () => useStore(selectCanDecide);

/**
 * Whether the current user ADMINISTERS the active household — the authority
 * over the household itself: removing any member (deciders included) and
 * removing any item from the record.
 *
 * Deliberately not the same question as selectCanDecide. Deciding is about
 * the parent's things; administering is about the household's shape, and is
 * usually the adult child who set the home up.
 */
export const selectIsAdmin = (s: AppState) => {
  const h = selectActiveHousehold(s);
  const me = viewerName(s);
  if (!h) return s.role === 'owner';
  const admins = h.adminNames?.length ? h.adminNames : [h.createdBy];
  return admins.some((a) => a.toLowerCase() === me.toLowerCase());
};

export const useIsAdmin = () => useStore(selectIsAdmin);

/** Administrator names for the active household (never empty). */
export const useAdminNames = () =>
  useStore(
    useShallow((s: AppState) => {
      const h = selectActiveHousehold(s);
      if (!h) return [] as string[];
      return h.adminNames?.length ? h.adminNames : [h.createdBy];
    })
  );

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
 * This user's default decider for the ACTIVE household, or undefined for
 * "anyone". Only honoured while that person still has the final say there and
 * there is actually a choice to make (more than one decider).
 */
export const selectDefaultDecider = (s: AppState): string | undefined => {
  const h = selectActiveHousehold(s);
  if (!h || h.deciderNames.length < 2) return undefined;
  const name = s.defaultDeciders[h.id];
  return name && h.deciderNames.includes(name) ? name : undefined;
};

export const useDefaultDecider = () => useStore(selectDefaultDecider);

/** Full roster (stable reference). Filter by status at the call site. */
export const useMembers = () => useStore(useShallow((s: AppState) => s.members));

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
