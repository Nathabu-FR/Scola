import { create } from "zustand";

export type ProfileSyncStage = "timetable" | "homework" | "grades" | "extras" | "magic";

interface AccountSwitchState {
  switchingAccountId: string | null;
  stage: ProfileSyncStage | null;
  step: number;
  progress: number;
  blocking: boolean;
  begin: (accountId: string, blocking?: boolean) => void;
  setStage: (accountId: string, stage: ProfileSyncStage, progress?: number) => void;
  finish: (accountId: string) => void;
}

/** Ephemeral app-wide loading state. It is deliberately not persisted. */
export const useAccountSwitchStore = create<AccountSwitchState>(set => ({
  switchingAccountId: null,
  stage: null,
  step: 0,
  progress: 0,
  blocking: false,
  begin: (switchingAccountId, blocking = true) => set({ switchingAccountId, stage: null, step: 0, progress: 0, blocking }),
  setStage: (accountId, stage, progress) => set(state =>
    state.switchingAccountId === accountId
      ? {
          stage,
          step: (["timetable", "homework", "grades", "extras", "magic"] as ProfileSyncStage[]).indexOf(stage) + 1,
          progress: progress === undefined
            ? state.progress
            : Math.max(state.progress, Math.min(100, progress)),
        }
      : state
  ),
  finish: accountId => set(state =>
    state.switchingAccountId === accountId
      ? { switchingAccountId: null, stage: null, step: 0, progress: 0, blocking: false }
      : state
  ),
}));
