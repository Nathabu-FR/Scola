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
    Alert.alert(
      "Erreur Mock Data",
      `Impossible de préparer le compte fictif : ${String(cause)}`
    );
  });
};

export async function createMockProfile(): Promise<Account> {
  const store = useAccountStore.getState();
  const existing = store.accounts.find(
    account =>
      account.firstName === "Camille" &&
      account.lastName === "Martin" &&
      account.services.some(service => service.serviceId === Services.MOCK_DATA)
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

export async function attachMockDataToCurrentAccount(): Promise<Account> {
  const store = useAccountStore.getState();
  const account = store.accounts.find(
    item => item.id === store.lastUsedAccount
  );
  if (!account) {
    return createMockProfile();
  }

  if (
    !account.services.some(service => service.serviceId === Services.MOCK_DATA)
  ) {
    store.addServiceToAccount(account.id, createMockService());
  }

  const updatedAccount =
    useAccountStore.getState().accounts.find(item => item.id === account.id) ??
    account;
  await finishMockAccountSetup(updatedAccount.id);
  return updatedAccount;
}

export function openMockDataAccountChooser(): void {
  useSettingsStore.getState().mutateProperty("personalization", { mockDataEnabled: true });
  const store = useAccountStore.getState();
  const currentAccount = store.accounts.find(
    account => account.id === store.lastUsedAccount
  );

  if (!currentAccount) {
    runMockSetup(createMockProfile);
    return;
  }

  if (
    currentAccount.services.some(
      service => service.serviceId === Services.MOCK_DATA
    )
  ) {
    runMockSetup(() => finishMockAccountSetup(currentAccount.id));
    return;
  }

  // This used to ask (via a native Alert.alert with a `buttons` array)
  // whether to create a brand new mock profile or attach mock data to the
  // account already signed in. That dialog's buttons don't reliably work
  // on web/desktop builds (Electron, Tauri), which made the whole "Mock
  // Data" onboarding option look broken whenever an account already
  // existed - the far more common case once someone has tested the app
  // before. Attaching to the current account is the safer default (it
  // never creates a duplicate profile), and is always reversible from the
  // accounts settings afterwards.
  if (Platform.OS === "web") {
    runMockSetup(attachMockDataToCurrentAccount);
    return;
  }

  Alert.alert(
    "Ajouter Mock Data",
    "Comment souhaites-tu utiliser les données fictives ?",
    [
      { text: "Annuler", style: "cancel" },
      {
        text: "Nouveau profil",
        onPress: () => runMockSetup(createMockProfile),
      },
      {
        text: "Compte actuel",
        onPress: () => runMockSetup(attachMockDataToCurrentAccount),
      },
    ]
  );
}
