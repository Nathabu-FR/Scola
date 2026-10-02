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
