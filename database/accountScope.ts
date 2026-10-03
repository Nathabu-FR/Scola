import { useMemo } from "react";

import { Account } from "@/stores/account/types";
import { useAccountStore } from "@/stores/account";

/** Data rows are owned by a service id; custom rows can be owned by the profile id. */
export function getAccountDataSourceIds(
  account: Pick<Account, "id" | "services"> | null | undefined
): string[] {
  if (!account) return [];

  return [...new Set([account.id, ...account.services.map(service => service.id)].filter(Boolean))];
}

export function getActiveAccountDataSourceIds(): string[] {
  const { accounts, lastUsedAccount } = useAccountStore.getState();
  const account = accounts.find(item => item.id === lastUsedAccount);
  return getAccountDataSourceIds(account);
}

/** Stable hook selector: service-token refreshes replace Account objects, but
 * should not restart every database observer when the profile/source ids stay
 * the same. */
export function useActiveAccountDataSourceIds(): string[] {
  const sourceKey = useAccountStore(state => {
    const account = state.accounts.find(item => item.id === state.lastUsedAccount);
    return getAccountDataSourceIds(account).join("\u0000");
  });

  return useMemo(() => sourceKey ? sourceKey.split("\u0000") : [], [sourceKey]);
}
