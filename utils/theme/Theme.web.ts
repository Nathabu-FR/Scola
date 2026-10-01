import {
  DarkTheme as NativeDarkTheme,
  DefaultTheme as NativeDefaultTheme,
} from "expo-router/react-navigation";
import { SCOLA_BRAND } from "@/constants/scolaBrand";

// react-native-dynamic-theme wraps a native TurboModule ('DynamicTheme') to
// read Android 12+ Material You colors. It has no web implementation, and
// merely importing it crashes on load (TurboModuleRegistry doesn't exist on
// react-native-web) even though Theme.ts only ever calls it when
// Platform.OS === "android". This file mirrors Theme.ts exactly, with
// isMaterialYouAvailable hardcoded to false — exactly what already happens
// on iOS today — instead of importing the native-only package.

const FALLBACK_COLORS = {
  light: {
    primary: SCOLA_BRAND.blue,
    tint: SCOLA_BRAND.blue,
    background: "#FBFCFF",
    overground: "#F1F5FD",
    text: "#10203D",
    card: "#FFFFFF",
    item: "#FFFFFF",
    border: "#D8E3F5",
  },
  dark: {
    primary: "#65A8FF",
    tint: SCOLA_BRAND.cyan,
    background: SCOLA_BRAND.navy,
    overground: "#091C40",
    text: "#F5F8FF",
    card: "#0D244E",
    item: "#132B57",
    border: "#213F78",
  },
};

const isMaterialYouAvailable = false;

function getThemeColors(useMaterialYou: boolean) {
  if (useMaterialYou && isMaterialYouAvailable) {
    // Unreachable on web — kept only so this stays a faithful mirror of
    // Theme.ts's shape.
  }
  return FALLBACK_COLORS;
}

export function createDefaultTheme(useMaterialYou: boolean, primaryColor: string) {
  const colors = getThemeColors(useMaterialYou);

  return {
    ...NativeDefaultTheme,
    colors: {
      ...NativeDefaultTheme.colors,
      primary: useMaterialYou ? colors.light.primary : (primaryColor || colors.light.primary),
      tint: useMaterialYou ? colors.light.tint : (primaryColor || colors.light.tint),
      background: colors.light.background,
      overground: colors.light.overground,
      text: colors.light.text,
      card: colors.light.card,
      item: colors.light.item,
      border: colors.light.border,
    },
  };
}

export function createDarkTheme(useMaterialYou: boolean, primaryColor: string) {
  const colors = getThemeColors(useMaterialYou);

  return {
    ...NativeDarkTheme,
    colors: {
      ...NativeDarkTheme.colors,
      primary: useMaterialYou ? colors.dark.primary : (primaryColor || colors.dark.primary),
      tint: useMaterialYou ? colors.dark.tint : (primaryColor || colors.dark.tint),
      background: colors.dark.background,
      overground: colors.dark.overground,
      text: colors.dark.text,
      card: colors.dark.card,
      item: colors.dark.item,
      border: colors.dark.border,
    },
  };
}
