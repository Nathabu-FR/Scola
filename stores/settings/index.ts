import { create } from "zustand";
import { persist } from "zustand/middleware";
import { Platform } from "react-native";

import { Colors } from "@/utils/colors";
import { MAGIC_URL } from "@/utils/endpoints";

import { createMMKVStorage } from "../global";
import { Personalization, SettingsState, SettingsStorage, Wallpaper } from "./types";

export const DEFAULT_MATERIAL_YOU_ENABLED =
  Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 31;

const defaultPersonalization: Personalization = {
  fontFamily: "sn-pro",
  colorSelected: Colors.BLUE,
  theme: "auto",
  useMaterialYou: DEFAULT_MATERIAL_YOU_ENABLED,
  iOSBottomAccessoryEnabled: true,
  showTabBarLabels: true,
  magicEnabled: true,
  hideNameOnHomeScreen: false,
  showAlertAtLogin: false,
  showDevMode: false,
  mockDataEnabled: false,
  magicModelURL: MAGIC_URL,
  gradesDisplayScale: "20",
  homeworkRemindersEnabled: false,
  homeworkReminderDaysBefore: 1,
  messageNotificationsEnabled: false,
  newsNotificationsEnabled: false,
  desktopCloseToTray: true,
  desktopLaunchAtStartup: false,
  desktopLaunchInBackground: false,
  welcomeModalSeen: false,
};

export const useSettingsStore = create<SettingsStorage>()(
  persist(
    (set, get) => ({
      personalization: defaultPersonalization,
      reset: () => { set({ personalization: defaultPersonalization }) },
      mutateProperty: <T extends keyof SettingsState>(
        section: T,
        updates: Partial<SettingsState[T]>
      ) => {
        set(state => ({
          ...state,
          [section]: {
            ...state[section],
            ...updates,
          },
        }));
      },
    }),
    {
      name: "settings-storage",
      storage: createMMKVStorage("settings"),
      version: 1,
    }
  )
);

/** Move legacy global profile preferences to the account that was active when
 * profile-scoped preferences were introduced. Call before switching accounts. */
export const migrateLegacyAccountPersonalization = (accountId: string): void => {
  if (!accountId) return;
  const { personalization, mutateProperty } = useSettingsStore.getState();
  const updates: Partial<Personalization> = {};

  if (personalization.wallpaper && !personalization.wallpaperOwnerAccountId) {
    updates.wallpaperOwnerAccountId = accountId;
    updates.wallpapersByAccount = {
      ...(personalization.wallpapersByAccount ?? {}),
      [accountId]: personalization.wallpaper,
    };
  }
  if (personalization.gradesPeriodName && !personalization.gradesPeriodOwnerAccountId) {
    updates.gradesPeriodOwnerAccountId = accountId;
    updates.gradesPeriodNamesByAccount = {
      ...(personalization.gradesPeriodNamesByAccount ?? {}),
      [accountId]: personalization.gradesPeriodName,
    };
  }

  if (Object.keys(updates).length > 0) {
    mutateProperty("personalization", updates);
  }
};

export const getWallpaperForAccount = (
  personalization: Personalization,
  accountId: string
): Wallpaper | undefined => {
  const scoped = personalization.wallpapersByAccount;
  if (Object.prototype.hasOwnProperty.call(scoped ?? {}, accountId)) {
    return scoped?.[accountId] ?? undefined;
  }
  if (!personalization.wallpaperOwnerAccountId || personalization.wallpaperOwnerAccountId === accountId) {
    return personalization.wallpaper;
  }
  return undefined;
};

export const setWallpaperForAccount = (accountId: string, wallpaper?: Wallpaper): void => {
  if (!accountId) return;
  migrateLegacyAccountPersonalization(accountId);
  const { personalization, mutateProperty } = useSettingsStore.getState();
  mutateProperty("personalization", {
    wallpapersByAccount: {
      ...(personalization.wallpapersByAccount ?? {}),
      [accountId]: wallpaper ?? null,
    },
  });
};

export const getGradesPeriodNameForAccount = (
  personalization: Personalization,
  accountId: string
): string | undefined => {
  const scoped = personalization.gradesPeriodNamesByAccount;
  if (Object.prototype.hasOwnProperty.call(scoped ?? {}, accountId)) {
    return scoped?.[accountId] ?? undefined;
  }
  if (!personalization.gradesPeriodOwnerAccountId || personalization.gradesPeriodOwnerAccountId === accountId) {
    return personalization.gradesPeriodName;
  }
  return undefined;
};

export const setGradesPeriodNameForAccount = (accountId: string, periodName?: string): void => {
  if (!accountId) return;
  migrateLegacyAccountPersonalization(accountId);
  const { personalization, mutateProperty } = useSettingsStore.getState();
  mutateProperty("personalization", {
    gradesPeriodNamesByAccount: {
      ...(personalization.gradesPeriodNamesByAccount ?? {}),
      [accountId]: periodName ?? null,
    },
  });
};
