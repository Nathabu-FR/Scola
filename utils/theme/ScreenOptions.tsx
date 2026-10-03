import { Platform } from "react-native";
import { useTheme } from "expo-router/react-navigation";
import AndroidBackButton from "./AndroidBackButton";
import { useFont } from "./fonts";
import React from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const useScreenOptions = (): any => {
  const font = useFont();
  const { colors } = useTheme();

  return React.useMemo(() => ({
    headerLargeTitle: false,
    headerTitleAlign: Platform.OS === "web" ? "left" : undefined,
    headerStyle: Platform.OS === "web" ? { backgroundColor: colors.background } : undefined,
    headerShadowVisible: Platform.OS === "web" ? false : undefined,
    headerTransparent: Platform.OS === "ios" && parseInt(Platform.Version) >= 26,
    headerBackButtonDisplayMode:
      Platform.OS === "ios" && parseInt(Platform.Version) < 26
        ? undefined
        : "minimal",
    headerTitleStyle: {
      fontFamily: font("semibold"),
      fontSize: Platform.OS === "ios" ? 18 : 20,
    },
    headerLargeTitleStyle: {
      fontFamily: font("bold"),
    },
    headerBackTitleStyle: {
      fontFamily: font("semibold"),
      fontSize: 17,
    },
    // Android and web/desktop (Electron, Tauri) both rely on this custom
    // back button since their native header chevron is turned off elsewhere
    // (see headerBackVisible below and the per-layout overrides) — only iOS
    // keeps the platform-native one.
    headerBackIcon: Platform.OS == 'android' ? {
      type: "image",
      source: require("@/assets/icons/back.svg"),
    } : undefined,
    headerLeft: (Platform.OS == 'android' || Platform.OS === 'web') ? () => <AndroidBackButton /> : undefined,
    headerBackVisible: (Platform.OS == 'android' || Platform.OS === 'web') ? false : undefined
  }), [font, colors.background]);
};
