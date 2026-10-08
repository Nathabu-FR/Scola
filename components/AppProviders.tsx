import { ThemeProvider, useTheme } from "expo-router/react-navigation";
import * as SystemUI from 'expo-system-ui';
import { PostHogProvider } from 'posthog-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AppState, Modal, Pressable, Text, useColorScheme, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DatabaseProvider } from "@/database/DatabaseProvider";
import { useAllHomeworkFromCache } from "@/database/useHomework";
import { useLatestMessagesFromCache } from "@/database/useChat";
import { useNews } from "@/database/useNews";
import { DEFAULT_MATERIAL_YOU_ENABLED, useSettingsStore } from '@/stores/settings';
import { useAccountStore } from "@/stores/account";
import { AlertProvider } from '@/ui/components/AlertProvider';
import { AppColors } from "@/utils/colors";
import { posthog } from '@/utils/logger/posthog';
import { syncHomeworkReminders } from "@/services/local/homeworkNotifications";
import { sendSchoolNotification } from "@/services/local/schoolNotifications";
import { syncDesktopPreferences } from "@/services/local/desktopPreferences";
import { isTauriDesktop } from "@/utils/network/fetch";
import { checkForDesktopUpdate, installDesktopUpdate, type DesktopRelease } from "@/services/local/desktopUpdates";
import { warn } from "@/utils/logger/logger";
import { createDarkTheme, createDefaultTheme } from '@/utils/theme/Theme';

interface AppProvidersProps {
  children: React.ReactNode;
}

function HomeworkReminderScheduler() {
  const homeworks = useAllHomeworkFromCache({ upcomingOnly: true });
  const accountId = useAccountStore(state => state.lastUsedAccount);
  const remindersEnabled = useSettingsStore(state => state.personalization.homeworkRemindersEnabled ?? false);
  const daysBefore = useSettingsStore(state => state.personalization.homeworkReminderDaysBefore ?? 1);

  const syncReminders = useCallback(() => {
    void syncHomeworkReminders(accountId, homeworks, remindersEnabled, daysBefore)
      .catch(error => warn(`Could not update homework reminders: ${String(error)}`));
  }, [accountId, daysBefore, homeworks, remindersEnabled]);

  useEffect(() => {
    syncReminders();
    const subscription = AppState.addEventListener("change", state => {
      if (state === "active") syncReminders();
    });
    return () => subscription.remove();
  }, [syncReminders]);

  return null;
}

function normalizePersonName(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isMessageFromStudent(author: string, firstName: string, lastName: string): boolean {
  const normalizedAuthor = normalizePersonName(author);
  if (!normalizedAuthor) return false;
  if (["moi", "vous", "me", "you"].includes(normalizedAuthor)) return true;
  const normalizedFirst = normalizePersonName(firstName);
  const normalizedLast = normalizePersonName(lastName);
  if (!normalizedFirst && !normalizedLast) return false;
  return Boolean(
    (normalizedFirst && normalizedAuthor.includes(normalizedFirst) && (!normalizedLast || normalizedAuthor.includes(normalizedLast))) ||
    (normalizedLast && normalizedAuthor === normalizedLast)
  );
}

function SchoolNotificationObserver() {
  const news = useNews();
  const messages = useLatestMessagesFromCache();
  const personalization = useSettingsStore(state => state.personalization);
  const activeAccountId = useAccountStore(state => state.lastUsedAccount);
  const account = useAccountStore(state => state.accounts.find(item => item.id === activeAccountId));

  useEffect(() => {
    const latestByAccount = new Map<string, (typeof news)[number]>();
    for (const item of news) {
      const current = latestByAccount.get(item.createdByAccount);
      if (!current || item.createdAt.getTime() > current.createdAt.getTime()) {
        latestByAccount.set(item.createdByAccount, item);
      }
    }

    const settings = useSettingsStore.getState();
    const cursorByAccount = { ...(settings.personalization.notificationNewsCursorByAccount ?? {}) };
    let changed = false;
    for (const [accountId, item] of latestByAccount) {
      const marker = `${item.id}:${item.createdAt.getTime()}`;
      const previous = cursorByAccount[accountId];
      if (previous && previous !== marker && settings.personalization.newsNotificationsEnabled) {
        void sendSchoolNotification("Nouvelle actualité", item.title || item.category || "Une actualité est disponible.", `news:${accountId}:${marker}`)
          .catch(error => warn(`Could not send school news notification: ${String(error)}`));
      }
      if (previous !== marker) {
        cursorByAccount[accountId] = marker;
        changed = true;
      }
    }
    if (changed) settings.mutateProperty("personalization", { notificationNewsCursorByAccount: cursorByAccount });
  }, [news]);

  useEffect(() => {
    const settings = useSettingsStore.getState();
    const cursorsByAccount = { ...(settings.personalization.notificationMessageCursorByAccount ?? {}) };
    let changed = false;
    for (const item of messages) {
      const accountCursors = { ...(cursorsByAccount[item.accountId] ?? {}) };
      const previous = accountCursors[item.conversationId];
      if (previous && previous !== item.messageId && settings.personalization.messageNotificationsEnabled &&
          !isMessageFromStudent(item.author, account?.firstName ?? "", account?.lastName ?? "")) {
        const title = item.subject ? `Nouveau message · ${item.subject}` : "Nouveau message scolaire";
        void sendSchoolNotification(title, item.content || `Message de ${item.author}`, `message:${item.accountId}:${item.conversationId}:${item.messageId}`)
          .catch(error => warn(`Could not send school message notification: ${String(error)}`));
      }
      if (previous !== item.messageId) {
        accountCursors[item.conversationId] = item.messageId;
        cursorsByAccount[item.accountId] = accountCursors;
        changed = true;
      }
    }
    if (changed) settings.mutateProperty("personalization", { notificationMessageCursorByAccount: cursorsByAccount });
  }, [messages, account?.firstName, account?.lastName]);

  return null;
}

function DesktopPreferencesSync() {
  const personalization = useSettingsStore(state => state.personalization);
  useEffect(() => {
    if (!isTauriDesktop()) return;
    void syncDesktopPreferences({
      closeToTray: personalization.desktopCloseToTray ?? true,
      launchAtStartup: personalization.desktopLaunchAtStartup ?? false,
      launchInBackground: personalization.desktopLaunchInBackground ?? false,
    }).catch(error => warn(`Could not apply desktop preferences: ${String(error)}`));
  }, [personalization.desktopCloseToTray, personalization.desktopLaunchAtStartup, personalization.desktopLaunchInBackground]);
  return null;
}

function DesktopUpdatePrompt() {
  const [release, setRelease] = useState<DesktopRelease | null>(null);
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState("");
  const [windowVisible, setWindowVisible] = useState(false);
  const { colors } = useTheme();
  const mutateProperty = useSettingsStore(state => state.mutateProperty);
  const ignoredVersion = useSettingsStore(state => state.personalization.ignoredUpdateVersion);
  const remindAt = useSettingsStore(state => state.personalization.updateReminderAt ?? 0);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const window = getCurrentWindow();
      setWindowVisible(await window.isVisible());
      unlisten = await window.onFocusChanged(({ payload }) => {
        if (payload) setWindowVisible(true);
        else void window.isVisible().then(setWindowVisible);
      });
      if (disposed) unlisten();
    }).catch(() => setWindowVisible(true));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriDesktop()) return;
    const delay = remindAt - Date.now();
    if (delay > 0) {
      const timer = setTimeout(() => {
        mutateProperty("personalization", { updateReminderAt: undefined });
      }, delay);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void checkForDesktopUpdate().then(found => {
      if (!cancelled && found && found.version !== ignoredVersion) setRelease(found);
    }).catch(() => {
      // A disconnected or rate-limited GitHub request should not interrupt startup.
    });
    return () => { cancelled = true; };
  }, [ignoredVersion, remindAt, mutateProperty]);

  if (!release || !windowVisible) return null;
  const dismissLater = () => {
    mutateProperty("personalization", { updateReminderAt: Date.now() + 24 * 60 * 60 * 1000 });
    setRelease(null);
  };
  const ignore = () => {
    mutateProperty("personalization", { ignoredUpdateVersion: release.version, updateReminderAt: undefined });
    setRelease(null);
  };
  const install = async () => {
    setInstallError("");
    setInstalling(true);
    try {
      await installDesktopUpdate(release.version);
    } catch (error) {
      warn(`Could not install desktop update: ${String(error)}`);
      setInstallError("Le téléchargement ou l’installation a échoué. Vérifie ta connexion puis réessaie.");
      setInstalling(false);
    }
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={dismissLater}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 440, borderRadius: 22, backgroundColor: colors.overground, padding: 24, gap: 14 }}>
          <Text style={{ color: colors.text, fontSize: 22, fontWeight: "700" }}>Mise à jour disponible</Text>
          <Text style={{ color: colors.text + "99", fontSize: 16 }}>Scola {release.version} est disponible. L’installation fermera l’application puis la rouvrira automatiquement.</Text>
          {installing ? <Text style={{ color: colors.primary }}>Téléchargement et installation…</Text> : null}
          {installError ? <Text style={{ color: "#F87171" }}>{installError}</Text> : null}
          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <Pressable disabled={installing} onPress={ignore} style={{ padding: 10 }}><Text style={{ color: colors.text + "99" }}>Ignorer</Text></Pressable>
            <Pressable disabled={installing} onPress={dismissLater} style={{ padding: 10 }}><Text style={{ color: colors.text }}>Plus tard</Text></Pressable>
            <Pressable disabled={installing} onPress={() => void install()} style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, backgroundColor: colors.primary }}><Text style={{ color: "white", fontWeight: "700" }}>Installer</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

export function AppProviders({ children }: AppProvidersProps) {
  const colorScheme = useColorScheme();
  const selectedTheme = useSettingsStore(state => state.personalization.theme);
  const selectedColorEnum = useSettingsStore(state => state.personalization.colorSelected);
  const useMaterialYou = useSettingsStore(state => state.personalization.useMaterialYou) ?? DEFAULT_MATERIAL_YOU_ENABLED;

  const color = useMemo(() => {
    const color = selectedColorEnum !== null ? AppColors.find(appColor => appColor.colorEnum === selectedColorEnum) : null;
    return color || AppColors[0];
  }, [selectedColorEnum]);

  // Memoize theme selection to prevent unnecessary re-computations
  const theme = useMemo(() => {
    const defaultTheme = createDefaultTheme(useMaterialYou, color.mainColor);
    const darkTheme = createDarkTheme(useMaterialYou, color.mainColor);
    const newScheme = selectedTheme === 'auto' ? (colorScheme === 'dark' ? darkTheme : defaultTheme) : (selectedTheme === 'dark' ? darkTheme : defaultTheme);
    return newScheme;
  }, [colorScheme, color, selectedTheme, useMaterialYou]);

  const backgroundColor = theme.colors.background;

  // Combined effect for system UI updates to reduce effect overhead
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(backgroundColor);
  }, [backgroundColor]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor }}>
      <PostHogProvider client={posthog} autocapture={false}>
        <DatabaseProvider>
          <ThemeProvider value={theme}>
            <AlertProvider>
              <HomeworkReminderScheduler />
              <SchoolNotificationObserver />
              <DesktopPreferencesSync />
              <DesktopUpdatePrompt />
              {children}
            </AlertProvider>
          </ThemeProvider>
        </DatabaseProvider>
      </PostHogProvider>
    </GestureHandlerRootView>
  );
}
