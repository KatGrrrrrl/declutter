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

export interface Item {
  id: string;
  title: string;
  room: string;
  decision: Decision;
  decidedAt?: string;
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
  createdAt: string;
}

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

/** Free tier limits — see PLAN_LIMITS. Paid removes both. */
export const FREE_ITEM_LIMIT = 50;
export const FREE_HOUSEHOLD_LIMIT = 1;

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
  /** Who created the household (may or may not be a decider). */
  createdBy: string;
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
  /** Subscription state. Real entitlement comes from RevenueCat later. */
  plan: Plan;
  /** True while the seeded sample household is loaded. */
  isDemo: boolean;

  people: Person[];
  items: Item[];
  /** Per-item family chat threads. */
  messages: ItemMessage[];
  /** Household roster: active members + pending invitations. */
  members: Member[];

  /** Cloud backup linkage (set after the first successful backup). */
  cloudHouseholdId?: string;
  lastBackupAt?: string;
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
  setCloudMeta: (meta: { cloudHouseholdId?: string; lastBackupAt?: string }) => void;
  /** Replace local state wholesale from a cloud restore snapshot. */
  restoreSnapshot: (snap: {
    householdName: string;
    deciderNames: string[];
    createdBy: string;
    cloudHouseholdId: string;
    items: Item[];
    people: Person[];
    messages: ItemMessage[];
    members: Member[];
    /** View to land in: contributors join as helpers. */
    role?: Role;
    /** The joining user's own display name (kept if provided). */
    userName?: string;
  }) => void;
  /** Merge one realtime row from another family member's device. */
  applyRemoteMessage: (m: ItemMessage) => void;
  applyRemoteItem: (i: Item) => void;

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
  /** Wipe everything and return to the welcome screen (the "log out"). */
  signOut: () => void;
  /** Replace demo content with an empty household of the same name. */
  startFresh: (householdName?: string) => void;
  addHousehold: (
    name: string,
    deciderNames?: string[]
  ) => { ok: boolean; reason?: 'limit' };
  switchHousehold: (id: string) => void;
  /** Post a chat message on an item, authored by the current user. */
  addMessage: (itemId: string, text: string) => void;
  setPlan: (plan: Plan) => void;
  setRole: (role: Role) => void; // demo-mode view switch
  decide: (id: string, decision: Decision) => void;
  undoDecision: (id: string) => void;
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
  bulkDecide: (ids: string[], decision: Decision) => void;
  bulkSetRoom: (ids: string[], room: string) => void;
  bulkArchive: (ids: string[], archived: boolean) => void;
  setStory: (id: string, story: Story) => void;
  assignHeir: (id: string, personId: string | undefined, visibility: HeirVisibility) => void;
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
      createdBy: 'Sam',
    },
  ] as Household[],
  activeHouseholdId: DEMO_HOUSEHOLD_ID,
  plan: 'free' as Plan,
  isDemo: true,
  people: seedPeople,
  items: seedItems,
  messages: seedMessages,
  members: seedMembers,
};

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
                messages: [] as ItemMessage[],
                members: roster,
                isDemo: false,
                households: [
                  {
                    id,
                    name: householdName,
                    createdAt: now,
                    deciderNames: deciders,
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

      signOut: () => set({ ...initial }),

      startFresh: (householdName) =>
        set((s) => {
          const id = uid();
          const name = householdName ?? s.householdName;
          const now = new Date().toISOString();
          return {
            items: [],
            people: [],
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
        if (s.cloudHouseholdId && !s.isDemo) {
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
          return h ? { activeHouseholdId: id, householdName: h.name } : {};
        }),

      setPlan: (plan) => set({ plan }),

      setRole: (role) => set({ role }),

      decide: (id, decision) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, decision, decidedAt: new Date().toISOString() } : it
          ),
        })),

      undoDecision: (id) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, decision: 'undecided', decidedAt: undefined } : it
          ),
        })),

      addItem: (item) => {
        const s = get();
        if (s.plan === 'free' && s.items.length >= FREE_ITEM_LIMIT) {
          return { ok: false, reason: 'limit' as const };
        }
        set({
          items: [
            {
              decision: 'undecided',
              heirVisibility: 'owner_only',
              isSentimental: false,
              tags: [],
              ...item,
              id: uid(),
              createdAt: new Date().toISOString(),
            } as Item,
            ...s.items,
          ],
        });
        return { ok: true };
      },

      updateItem: (id, patch) =>
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
        })),

      setArchived: (id, archived) =>
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, archived } : it)),
        })),

      bulkDecide: (ids, decision) =>
        set((s) => {
          const at = new Date().toISOString();
          const set_ = new Set(ids);
          return {
            items: s.items.map((it) =>
              set_.has(it.id)
                ? {
                    ...it,
                    decision,
                    decidedAt: decision === 'undecided' ? undefined : at,
                  }
                : it
            ),
          };
        }),

      bulkSetRoom: (ids, room) =>
        set((s) => {
          const set_ = new Set(ids);
          return { items: s.items.map((it) => (set_.has(it.id) ? { ...it, room } : it)) };
        }),

      bulkArchive: (ids, archived) =>
        set((s) => {
          const set_ = new Set(ids);
          return { items: s.items.map((it) => (set_.has(it.id) ? { ...it, archived } : it)) };
        }),

      removeItem: (id) => {
        const s = get();
        set({
          items: s.items.filter((it) => it.id !== id),
          messages: s.messages.filter((m) => m.itemId !== id),
        });
        if (s.cloudHouseholdId && !s.isDemo) {
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

      assignHeir: (id, personId, visibility) =>
        set((s) => ({
          items: s.items.map((it) =>
            it.id === id ? { ...it, heirPersonId: personId, heirVisibility: visibility } : it
          ),
        })),

      requestItem: (id, byName) =>
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, requestedBy: byName } : it)),
        })),

      addPerson: (p) =>
        set((s) => ({ people: [...s.people, { ...p, id: uid() }] })),

      setCloudMeta: (meta) => set(meta),

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
          return {
            onboarded: true,
            isDemo: false,
            role: snap.role ?? s.role,
            userName: snap.userName ?? s.userName,
            householdName: snap.householdName,
            households: [
              {
                id,
                name: snap.householdName,
                createdAt: new Date().toISOString(),
                deciderNames: snap.deciderNames,
                createdBy: snap.createdBy,
              },
            ],
            activeHouseholdId: id,
            ownerName: snap.deciderNames[0] ?? snap.createdBy,
            cloudHouseholdId: snap.cloudHouseholdId,
            items: snap.items,
            people: snap.people,
            messages: snap.messages,
            members: snap.members,
          };
        }),

      applyRemoteMessage: (m) =>
        set((s) =>
          s.messages.some((x) => x.id === m.id)
            ? {}
            : { messages: [...s.messages, m] }
        ),

      applyRemoteItem: (i) =>
        set((s) =>
          s.items.some((x) => x.id === i.id)
            ? { items: s.items.map((x) => (x.id === i.id ? { ...x, ...i, photoUri: x.photoUri ?? i.photoUri } : x)) }
            : { items: [i, ...s.items] }
        ),

      resetAll: () => set({ ...initial, onboarded: false }),
    }),
    {
      name: 'declutter-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: 4,
      /**
       * v1 → v2: chat messages + per-household deciders/creator.
       * v2 → v3: member roster (backfilled from deciders + current user).
       * v3 → v4: ALL ids become UUIDs (and cross-references are remapped) so
       *          local rows and cloud rows share identity — the basis of
       *          multi-device upsert sync.
       */
      migrate: (persisted) => {
        const s = persisted as Partial<AppState>;
        const now = new Date().toISOString();
        const households = (s.households ?? []).map((h) => ({
          ...h,
          deciderNames: h.deciderNames ?? [s.ownerName ?? 'Rose'],
          createdBy: h.createdBy ?? s.userName ?? 'Rose',
        }));
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

        return {
          ...s,
          messages,
          people,
          items,
          members: members4,
          households: households4,
          activeHouseholdId,
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
export const selectQueue = (s: AppState) =>
  s.items.filter((i) => i.decision === 'undecided');

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

/** Full roster (stable reference). Filter by status at the call site. */
export const useMembers = () => useStore(useShallow((s: AppState) => s.members));

/** Normalized title used for duplicate detection. */
const dupKey = (i: Item) => i.title.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Ids of items whose title matches another item's (case/space-insensitive) —
 * the "did we photograph this twice?" signal for batch capture.
 */
export const useDuplicateIds = () =>
  useStore(
    useShallow((s: AppState) => {
      const counts = new Map<string, number>();
      s.items.forEach((i) => {
        if (i.archived) return;
        const k = dupKey(i);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      });
      return s.items
        .filter((i) => !i.archived && (counts.get(dupKey(i)) ?? 0) > 1)
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
  const itemsUsed = s.items.length;
  const householdsUsed = s.households.length;
  return {
    pro,
    itemsUsed,
    itemLimit: pro ? Infinity : FREE_ITEM_LIMIT,
    itemsLeft: pro ? Infinity : Math.max(0, FREE_ITEM_LIMIT - itemsUsed),
    atItemLimit: !pro && itemsUsed >= FREE_ITEM_LIMIT,
    /** Warn as they approach the cap so the wall is never a surprise. */
    nearItemLimit: !pro && itemsUsed >= FREE_ITEM_LIMIT - 10 && itemsUsed < FREE_ITEM_LIMIT,
    householdsUsed,
    householdLimit: pro ? Infinity : FREE_HOUSEHOLD_LIMIT,
    canAddHousehold: pro || householdsUsed < FREE_HOUSEHOLD_LIMIT,
  };
};
