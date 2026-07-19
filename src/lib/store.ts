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

interface AppState {
  // profile / onboarding
  onboarded: boolean;
  role: Role;
  ownerName: string;
  userName: string;
  householdName: string;

  people: Person[];
  items: Item[];

  // actions
  completeOnboarding: (opts: { role: Role; householdName: string; userName: string }) => void;
  setRole: (role: Role) => void; // demo-mode view switch
  decide: (id: string, decision: Decision) => void;
  undoDecision: (id: string) => void;
  addItem: (item: Omit<Item, 'id' | 'createdAt' | 'decision' | 'heirVisibility' | 'isSentimental' | 'tags'> & Partial<Item>) => void;
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

const initial = {
  onboarded: false,
  role: 'owner' as Role,
  ownerName: 'Rose',
  userName: 'Rose',
  householdName: 'The Lakehouse',
  people: seedPeople,
  items: seedItems,
};

export const useStore = create<AppState>()(
  persist(
    (set) => ({
      ...initial,

      completeOnboarding: ({ role, householdName, userName }) =>
        set({ onboarded: true, role, householdName, userName }),

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

      addItem: (item) =>
        set((s) => ({
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
        })),

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

/** Undecided queue for the parent's Decide deck (oldest first). */
export const selectQueue = (s: AppState) =>
  s.items.filter((i) => i.decision === 'undecided');

/** Kept items for the Keepsakes shelf (newest decision first). */
export const selectKeepsakes = (s: AppState) =>
  s.items
    .filter((i) => i.decision === 'keep')
    .sort((a, b) => (b.decidedAt ?? '').localeCompare(a.decidedAt ?? ''));
