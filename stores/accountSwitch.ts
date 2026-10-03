import { create } from "zustand";

interface AccountSwitchState {
  switchingAccountId: string | null;
  begin: (accountId: string) => void;
  finish: (accountId: string) => void;
}

/** Ephemeral app-wide loading state. It is deliberately not persisted. */
export const useAccountSwitchStore = create<AccountSwitchState>(set => ({
  switchingAccountId: null,
  begin: switchingAccountId => set({ switchingAccountId }),
  finish: accountId => set(state =>
    state.switchingAccountId === accountId ? { switchingAccountId: null } : state
  ),
}));
