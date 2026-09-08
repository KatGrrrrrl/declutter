/**
 * Who else is in this household right now — fed by Realtime presence on the
 * household channel (see realtime.ts). Session-only, never persisted: a list
 * of people who are online is only true while the socket is open.
 */

import { create } from 'zustand';

export interface PresentPerson {
  /** Auth user id — so the same person on two devices counts once. */
  uid: string;
  name: string;
}

interface PresenceState {
  /** Everyone else online in the active household (never includes the viewer). */
  others: PresentPerson[];
  setOthers: (others: PresentPerson[]) => void;
  clear: () => void;
}

export const usePresence = create<PresenceState>((set) => ({
  others: [],
  setOthers: (others) => set({ others }),
  clear: () => set({ others: [] }),
}));
