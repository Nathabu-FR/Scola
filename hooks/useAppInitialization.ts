import { useEffect, useState, useRef, useCallback } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';

import { configureTips, resetTipsDatastore, showAllTips } from '@/modules/papillon-tips';
import { syncAccountProfile } from '@/services/shared';
import { useAccountStore } from '@/stores/account';
import { useProfileSyncStore } from '@/stores/profileSync';
import { useSettingsStore } from '@/stores/settings';
import { useTipsStore } from '@/stores/tips';
import i18n from '@/utils/i18n';
import { checkConsent } from '@/utils/logger/consent';
import { warn } from '@/utils/logger/logger';
import { posthog } from '@/utils/logger/posthog';
import { FONT_CONFIG } from '@/constants/LayoutScreenOptions';
import { preloadTauriFetch } from "@/utils/network/fetch";

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

export function useAppInitialization() {
  const [fontsLoaded, fontsError] = useFonts(FONT_CONFIG);

  // Settings
  const customLanguage = useSettingsStore(state => state.personalization.language);
  const selectedTheme = useSettingsStore(state => state.personalization.theme);
  const syncIntervalMinutes = useSettingsStore(state => state.personalization.dataSyncIntervalMinutes ?? 30);
  const mutateProperty = useSettingsStore(state => state.mutateProperty);

  useEffect(() => {
    if (!selectedTheme) {
      mutateProperty('personalization', {
        theme: "auto"
      });
    }
  }, [mutateProperty, selectedTheme]);

  // Language Initialization
  useEffect(() => {
    if (customLanguage && i18n.language !== customLanguage) {
      i18n.changeLanguage(customLanguage).catch((error) => {
        console.error("Error changing language:", error);
      });
    }
  }, [customLanguage]);

  // TipKit Initialization
  // Has to happen before any tip is asked whether it should show, and exactly
  // once per process. `immediate` because our tips point at something on screen
  // right now — holding one back for an hour would point at nothing.
  //
  // A reset asked for from the debug menu is carried out here rather than
  // there: TipKit only lets its datastore be wiped before it is configured, so
  // this launch is the first chance to honour it.
  useEffect(() => {
    const setUpTips = async () => {
      const { pendingDatastoreReset, clearPendingDatastoreReset, forceAll } =
        useTipsStore.getState();

      if (pendingDatastoreReset) {
        await resetTipsDatastore();
        clearPendingDatastoreReset();
      }

      await configureTips('immediate');

      if (forceAll) {
        await showAllTips();
      }
    };

    setUpTips().catch(err => {
      warn(`TipKit configuration failed: ${err}`);
    });
  }, []);

  // Preload the native Tauri HTTP transport before school SDKs are used.
  // Global fetch remains routed by RootLayout so Tauri IPC keeps using the
  // original WebView fetch instead of recursively calling plugin-http.
  useEffect(() => {
    preloadTauriFetch().catch(err => {
      warn(`Tauri HTTP transport initialization failed: ${err}`);
    });
  }, []);

  // AppState Monitoring
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (appState.current.match(/inactive|background/) && nextAppState === "active") {
        const accountId = useAccountStore.getState().lastUsedAccount;
        const lastSyncedAt = useProfileSyncStore.getState().lastSyncedAt[accountId] ?? 0;
        if (accountId && Date.now() - lastSyncedAt >= syncIntervalMinutes * 60 * 1000) {
          syncAccountProfile(accountId, { force: true, showProgress: true }).catch(e =>
            warn(`Profile refresh on resume failed: ${String(e)}`)
          );
        }
      }

      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [syncIntervalMinutes]);

  // Timers are suspended by mobile operating systems while the app is fully
  // backgrounded. Refresh on this interval while active, and check the saved
  // timestamp again when the app becomes active.
  useEffect(() => {
    const intervalMs = Math.max(1, syncIntervalMinutes) * 60 * 1000;
    const timer = setInterval(() => {
      if (AppState.currentState !== "active") return;
      const accountId = useAccountStore.getState().lastUsedAccount;
      if (!accountId) return;
      syncAccountProfile(accountId, { force: true, showProgress: true }).catch(e =>
        warn(`Scheduled profile refresh failed: ${String(e)}`)
      );
    }, intervalMs);

    return () => clearInterval(timer);
  }, [syncIntervalMinutes]);

  // PostHog Consent Sync
  useEffect(() => {
    async function syncPostHogConsent() {
      const consent = await checkConsent();

      if (consent.given && consent.level !== "none") {
        await posthog.optIn();
      } else {
        await posthog.optOut();
      }
    }

    syncPostHogConsent();
  }, []);

  // Error Handling for Fonts
  const handleError = useCallback(() => {
    if (fontsError) { throw fontsError; }
  }, [fontsError]);

  useEffect(handleError, [handleError]);

  return {
    isAppReady: fontsLoaded,
    fontsLoaded,
    fontsError
  };
}
