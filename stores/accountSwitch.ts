import { create } from "zustand";

export type ProfileSyncStage = "timetable" | "homework" | "grades" | "extras" | "magic";

interface AccountSwitchState {
  switchingAccountId: string | null;
  stage: ProfileSyncStage | null;
  step: number;
  begin: (accountId: string) => void;
  setStage: (accountId: string, stage: ProfileSyncStage) => void;
  finish: (accountId: string) => void;
}

/** Ephemeral app-wide loading state. It is deliberately not persisted. */
export const useAccountSwitchStore = create<AccountSwitchState>(set => ({
  switchingAccountId: null,
  stage: null,
  step: 0,
  begin: switchingAccountId => set({ switchingAccountId, stage: null, step: 0 }),
  setStage: (accountId, stage) => set(state =>
    state.switchingAccountId === accountId
      ? { stage, step: (["timetable", "homework", "grades", "extras", "magic"] as ProfileSyncStage[]).indexOf(stage) + 1 }
      : state
  ),
  finish: accountId => set(state =>
    state.switchingAccountId === accountId
      ? { switchingAccountId: null, stage: null, step: 0 }
      : state
  ),
}));
