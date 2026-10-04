import { create } from "zustand";
import { persist } from "zustand/middleware";

import { createMMKVStorage } from "./global";

interface ProfileSyncState {
  initialSyncCompleted: Record<string, boolean>;
  lastSyncedAt: Record<string, number>;
  markInitialSyncCompleted: (accountId: string) => void;
  markSynced: (accountId: string, timestamp: number) => void;
  removeAccount: (accountId: string) => void;
  clear: () => void;
}

export const useProfileSyncStore = create<ProfileSyncState>()(
  persist(
    set => ({
      initialSyncCompleted: {},
      lastSyncedAt: {},
      markInitialSyncCompleted: accountId => set(state => ({
        initialSyncCompleted: { ...state.initialSyncCompleted, [accountId]: true },
      })),
      markSynced: (accountId, timestamp) => set(state => ({
        lastSyncedAt: { ...state.lastSyncedAt, [accountId]: timestamp },
      })),
      removeAccount: accountId => set(state => {
        const initialSyncCompleted = { ...state.initialSyncCompleted };
        const lastSyncedAt = { ...state.lastSyncedAt };
        delete initialSyncCompleted[accountId];
        delete lastSyncedAt[accountId];
        return { initialSyncCompleted, lastSyncedAt };
      }),
      clear: () => set({ initialSyncCompleted: {}, lastSyncedAt: {} }),
    }),
    {
      name: "profile-sync-storage",
      storage: createMMKVStorage("profile-sync"),
      version: 1,
    }
  )
);
