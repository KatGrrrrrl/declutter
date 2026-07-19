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
  addedBy: string; // display name of the contributor/owner who captured it
  marketValue?: number; // dollars
  isSentimental: boolean;
  story?: Story;
  heirPersonId?: string;
  heirVisibility: HeirVisibility;
  requestedBy?: string; // contributor interest signal (owner-visible only)
  /**
   * High-ticket privacy tier: when true, this item must NEVER leave the
   * device — excluded from any future Supabase sync/upload and from shared
   * family views. Kept in the model now so the sync layer honors it later.
   */
  localOnly?: boolean;
  createdAt: string;
}

/** Free tier limits — see PLAN_LIMITS. Paid removes both. */
export const FREE_ITEM_LIMIT = 50;
export const FREE_HOUSEHOLD_LIMIT = 1;

export type Plan = 'free' | 'pro';

export interface Household {
  id: string;
  name: string;
  createdAt: string;
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

  // actions
  completeOnboarding: (opts: {
    role: Role;
    householdName: string;
    userName: string;
    startEmpty?: boolean;
  }) => void;
  /** Wipe everything and return to the welcome screen (the "log out"). */
  signOut: () => void;
  /** Replace demo content with an empty household of the same name. */
  startFresh: (householdName?: string) => void;
  addHousehold: (name: string) => { ok: boolean; reason?: 'limit' };
  switchHousehold: (id: string) => void;
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
  setStory: (id: string, story: Story) => void;
  assignHeir: (id: string, personId: string | undefined, visibility: HeirVisibility) => void;
  requestItem: (id: string, byName: string) => void;
  addPerson: (p: Omit<Person, 'id'>) => void;
  resetAll: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const seedPeople: Person[] = [
  { id: 'p-maya', displayName: 'Maya', relationship: 'daughter' },
  { id: 'p-sam', displayName: 'Sam', relationship: 'son' },
  { id: 'p-noor', displayName: 'Noor', relationship: 'granddaughter' },
];

const seedItems: Item[] = [
  {
    id: 'i-teapot', title: 'Blue china teapot', room: 'Kitchen', decision: 'undecided',
    tags: ['china'], addedBy: 'Sam', isSentimental: true, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:00:00Z',
  },
  {
    id: 'i-clock', title: 'Mantel clock', room: 'Living room', decision: 'undecided',
    tags: ['heirloom'], addedBy: 'Sam', isSentimental: true, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:05:00Z',
  },
  {
    id: 'i-drill', title: 'Cordless drill', room: 'Garage', decision: 'undecided',
    tags: ['tools'], addedBy: 'Maya', isSentimental: false, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:10:00Z',
  },
  {
    id: 'i-atlas', title: 'World atlas, 1968', room: 'Study', decision: 'undecided',
    tags: ['books'], addedBy: 'Maya', isSentimental: false, heirVisibility: 'owner_only',
    createdAt: '2026-07-01T10:15:00Z',
  },
  {
    id: 'i-ring', title: 'Opal ring', room: 'Bedroom', decision: 'keep',
    decidedAt: '2026-06-28T15:00:00Z', tags: ['jewelry'], addedBy: 'Sam',
    marketValue: 1400, isSentimental: true, heirPersonId: 'p-sam',
    heirVisibility: 'owner_only',
    story: {
      transcript: 'Your father gave me this the year we opened the shop. I wore it every market day for luck.',
      durationSec: 34, createdAt: '2026-06-28T15:04:00Z',
    },
    createdAt: '2026-06-27T09:00:00Z',
  },
  {
    id: 'i-quilt', title: 'Wedding quilt', room: 'Bedroom', decision: 'keep',
    decidedAt: '2026-06-28T15:10:00Z', tags: ['textiles'], addedBy: 'Maya',
    isSentimental: true, heirPersonId: 'p-maya', heirVisibility: 'revealed',
    story: {
      transcript: 'My mother and her sisters made this in the winter of 1949. Every square is a dress one of them wore.',
      durationSec: 51, createdAt: '2026-06-28T15:12:00Z',
    },
    createdAt: '2026-06-27T09:05:00Z',
  },
  {
    id: 'i-china-set', title: 'Delft dinner service', room: 'Kitchen', decision: 'keep',
    decidedAt: '2026-06-28T15:20:00Z', tags: ['china'], addedBy: 'Sam',
    marketValue: 120, isSentimental: true, heirVisibility: 'owner_only',
    createdAt: '2026-06-27T09:10:00Z',
  },
  {
    id: 'i-mower', title: 'Push mower', room: 'Garage', decision: 'donate',
    decidedAt: '2026-06-28T15:30:00Z', tags: ['tools'], addedBy: 'Maya',
    isSentimental: false, heirVisibility: 'owner_only',
    createdAt: '2026-06-27T09:15:00Z',
  },
];

const DEMO_HOUSEHOLD_ID = 'h-demo';

/** Pristine app state — the seeded sample household, pre-onboarding. */
const initial = {
  onboarded: false,
  role: 'owner' as Role,
  ownerName: 'Rose',
  userName: 'Rose',
  householdName: 'The Lakehouse',
  households: [
    { id: DEMO_HOUSEHOLD_ID, name: 'The Lakehouse', createdAt: '2026-06-27T09:00:00Z' },
  ] as Household[],
  activeHouseholdId: DEMO_HOUSEHOLD_ID,
  plan: 'free' as Plan,
  isDemo: true,
  people: seedPeople,
  items: seedItems,
};

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...initial,

      completeOnboarding: ({ role, householdName, userName, startEmpty }) =>
        set(() => {
          const id = uid();
          // A real household starts empty: no sample items, no sample heirs.
          const fresh = startEmpty
            ? {
                items: [] as Item[],
                people: [] as Person[],
                isDemo: false,
                households: [
                  { id, name: householdName, createdAt: new Date().toISOString() },
                ] as Household[],
                activeHouseholdId: id,
                ownerName: role === 'owner' ? userName : 'Rose',
              }
            : {};
          return { onboarded: true, role, householdName, userName, ...fresh };
        }),

      signOut: () => set({ ...initial }),

      startFresh: (householdName) =>
        set((s) => {
          const id = uid();
          const name = householdName ?? s.householdName;
          return {
            items: [],
            people: [],
            isDemo: false,
            householdName: name,
            households: [{ id, name, createdAt: new Date().toISOString() }],
            activeHouseholdId: id,
            ownerName: s.role === 'owner' ? s.userName : s.ownerName,
          };
        }),

      addHousehold: (name) => {
        const s = get();
        if (s.plan === 'free' && s.households.length >= FREE_HOUSEHOLD_LIMIT) {
          return { ok: false, reason: 'limit' as const };
        }
        const id = uid();
        set({
          households: [...s.households, { id, name, createdAt: new Date().toISOString() }],
          activeHouseholdId: id,
          householdName: name,
        });
        return { ok: true };
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

      resetAll: () => set({ ...initial, onboarded: false }),
    }),
    {
      name: 'declutter-store-v1',
      storage: createJSONStorage(() => AsyncStorage),
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
