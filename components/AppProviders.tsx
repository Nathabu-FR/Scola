import { ThemeProvider } from "expo-router/react-navigation";
import * as SystemUI from 'expo-system-ui';
import { PostHogProvider } from 'posthog-react-native';
import React, { useCallback, useEffect, useMemo } from 'react';
import { AppState, useColorScheme } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { DatabaseProvider } from "@/database/DatabaseProvider";
import { useAllHomeworkFromCache } from "@/database/useHomework";
import { DEFAULT_MATERIAL_YOU_ENABLED, useSettingsStore } from '@/stores/settings';
import { useAccountStore } from "@/stores/account";
import { AlertProvider } from '@/ui/components/AlertProvider';
import { AppColors } from "@/utils/colors";
import { posthog } from '@/utils/logger/posthog';
import { syncHomeworkReminders } from "@/services/local/homeworkNotifications";
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
              {children}
            </AlertProvider>
          </ThemeProvider>
        </DatabaseProvider>
      </PostHogProvider>
    </GestureHandlerRootView>
  );
}
