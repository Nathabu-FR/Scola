
import 'react-native-reanimated';
import "@/utils/i18n";

import { Buffer } from 'buffer';
import React, { useEffect, useMemo, useRef } from 'react';
import { useSegments } from 'expo-router';

import { AppProviders } from '@/components/AppProviders';
import FakeSplash from '@/components/FakeSplash';
import { RootNavigator } from '@/components/RootNavigator';
import { useAppInitialization } from '@/hooks/useAppInitialization';
import { useNetworkStore } from '@/stores/logs';
import { checkConsent } from '@/utils/logger/consent';
import { posthog } from '@/utils/logger/posthog';
import uuid from '@/utils/uuid/uuid';
import { useWidgetSync } from '@/widgets';
import { LogBox } from 'react-native';
import { appFetch, isTauriDesktop } from "@/utils/network/fetch";

// Keep the real WebView fetch available for URLs that are intentionally not
// sent through Tauri's native HTTP transport.
const browserFetch =
  typeof window !== "undefined" ? window.fetch.bind(window) : globalThis.fetch;

// Polyfill Buffer
global.Buffer = Buffer;

LogBox.ignoreLogs([
  "Require cycle:",
  "i18next is made possible by our own product, Locize",
  'Route "./',
  "Linking found multiple possible URI schemes in your Expo config.",
  "[Layout children]: No route named",
  "Found screens with the same name nested inside one another.",
  "Account manager not initialized. Call initializeAccountManager first.",
  "Manager is null, skipping timetable fetch",
  "Installing bindings...",
  "Successfully installed!",
]);

export default function RootLayout() {
  const { isAppReady, fontsLoaded } = useAppInitialization();
  const segments = useSegments();
  const lastTrackedView = useRef<string | null>(null);

  useWidgetSync();

  const analyticsView = useMemo(() => {
    if (segments.length === 0) return null;

    const groupMatch = segments[0].match(/^\((.+)\)$/);
    if (groupMatch) {
      const group = groupMatch[1];
      const rest = segments.slice(1).join('/');
      return rest ? `${group}:${rest}` : group;
    }

    return segments.join('/');
  }, [segments]);

  useEffect(() => {
    if (!analyticsView || lastTrackedView.current === analyticsView) return;

    const trackView = async () => {
      const consent = await checkConsent();
      if (!consent.given || consent.level !== "advanced") return;
      posthog.screen(analyticsView);
      lastTrackedView.current = analyticsView;
    };

    trackView();
  }, [analyticsView]);

  useEffect(() => {
    // fetch en place AVANT notre surcharge : c'est lui qu'on remet au démontage.
    const originalFetch = window.fetch;

    const shouldUseTauriTransport = (url: string) => {
      try {
        const parsedUrl = new URL(url, window.location.href);
        const hostname = parsedUrl.hostname.toLowerCase();
        // Tauri's native HTTP plugin uses this WebView endpoint for IPC.
        // Sending it back through plugin-http recursively invokes itself.
        if (parsedUrl.protocol === "ipc:" || hostname === "ipc.localhost") {
          return false;
        }
        // Tout le trafic scolaire/desktop passe par le client HTTP Rust :
        // le log montrait des fetch iCal (calendar.google.com) + wallpapers
        // (raw.githubusercontent.com) partis en window.fetch → CORS + ERR_FAILED.
        return (
          hostname === "api.ecoledirecte.com" ||
          hostname.endsWith(".ecoledirecte.com") ||
          hostname === "calendar.google.com" ||
          hostname === "raw.githubusercontent.com" ||
          hostname.endsWith(".githubusercontent.com") ||
          hostname === "api.github.com" ||
          hostname === "data.geopf.fr" ||
          hostname === "data.education.gouv.fr" ||
          hostname.endsWith(".pronote.com") ||
          hostname.endsWith(".index-education.com") ||
          hostname.endsWith(".indexeducation.com")
        );
      } catch {
        return false;
      }
    };

    const patchedFetch: typeof window.fetch = async (...args) => {
      const input = args[0];
      const requestUrl = input instanceof Request ? input.url : String(input);
      const id = __DEV__ ? uuid() : "";

      if (__DEV__) {
        try {
          const request = input instanceof Request && args[1] === undefined
            ? input
            : new Request(...args);
          useNetworkStore.getState().addRequest(request, id);
        } catch { }
      }

      const useNative = isTauriDesktop() && shouldUseTauriTransport(requestUrl);

      let response: Response;
      if (useNative) {
        response = await appFetch(input, args[1]);
      } else {
        response = await browserFetch(...args);
      }

      if (__DEV__) {
        try {
          // The diagnostic panel only needs status and URL. Keeping a cloned
          // body for each response buffered large school feeds in memory.
          useNetworkStore.getState().addResponse(response, id);
        } catch { }
      }

      return response;
    };

    window.fetch = patchedFetch;

    return () => {
      // On ne restaure que si notre fetch est toujours celui en place.
      if (window.fetch === patchedFetch) {
        window.fetch = originalFetch;
      }
    };
  }, []);

  if (!fontsLoaded) {
    return null;
  }

  return (
    <AppProviders>
      <FakeSplash isAppReady={isAppReady} instant={true} />
      <RootNavigator />
    </AppProviders>
  );
}
