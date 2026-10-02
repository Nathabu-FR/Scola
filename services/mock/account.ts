import { Href, router } from "expo-router";
import { Alert, Platform } from "react-native";

import { initializeAccountManager } from "@/services/shared";
import { useAccountStore } from "@/stores/account";
import { useSettingsStore } from "@/stores/settings";
import { Account, ServiceAccount, Services } from "@/stores/account/types";
import uuid from "@/utils/uuid/uuid";
import { error as logError } from "@/utils/logger/logger";

const createMockService = (): ServiceAccount => {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    serviceId: Services.MOCK_DATA,
    auth: {},
    createdAt: now,
    updatedAt: now,
  };
};

const finishMockAccountSetup = async (accountId: string) => {
  useAccountStore.getState().setLastUsedAccount(accountId);
  await initializeAccountManager(accountId);
  router.dismissAll();
  router.replace("/" as Href);
};

const runMockSetup = (action: () => Promise<unknown>) => {
  void action().catch(cause => {
    // `Alert.alert` with a `buttons` array (used below) doesn't reliably
    // show anything on web/desktop builds, which used to make this whole
    // flow look like it silently did nothing. Logging unconditionally
    // means the failure is at least visible in the console there, on top
    // of the native alert where that does work.
    logError(`Mock Data setup failed: ${String(cause)}`, "MockData");
    const message = `Impossible de préparer le compte fictif : ${String(cause)}`;
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.alert(`Erreur Mock Data\n\n${message}`);
    } else {
      Alert.alert("Erreur Mock Data", message);
    }
  });
};

export async function createMockProfile(): Promise<Account> {
  const store = useAccountStore.getState();
  const existing = store.accounts.find(
    account =>
      account.firstName === "Camille" &&
      account.lastName === "Martin" &&
      account.services.length === 1 &&
      account.services[0].serviceId === Services.MOCK_DATA
  );

  if (existing) {
    await finishMockAccountSetup(existing.id);
    return existing;
  }

  const now = new Date().toISOString();
  const account: Account = {
    id: uuid(),
    firstName: "Camille",
    lastName: "Martin",
    schoolName: "Lycée Victor-Hugo",
    className: "Seconde 2",
    customisation: { profilePicture: "", subjects: {} },
    services: [createMockService()],
    createdAt: now,
    updatedAt: now,
  };
  store.addAccount(account);
  await finishMockAccountSetup(account.id);
  return account;
}

export function openMockDataAccountChooser(): void {
  useSettingsStore.getState().mutateProperty("personalization", { mockDataEnabled: true });
  // Demo data always belongs to its own account. This keeps it from mixing
  // with a real student's school data; createMockProfile reuses the existing
  // demo profile when the user returns to it later.
  runMockSetup(createMockProfile);
}
