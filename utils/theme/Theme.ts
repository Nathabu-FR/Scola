import {
  DarkTheme as NativeDarkTheme,
  DefaultTheme as NativeDefaultTheme,
} from "expo-router/react-navigation";
import { Platform } from "react-native";
import { getDynamicColorScheme } from "react-native-dynamic-theme";
import { SCOLA_BRAND } from "@/constants/scolaBrand";

const FALLBACK_COLORS = {
  light: {
    primary: SCOLA_BRAND.blue,
    tint: SCOLA_BRAND.blue,
    background: "#FBFCFF",
    overground: "#F1F5FD",
    text: "#10203D",
    card: "#FFFFFF",
    item: Platform.OS === "android" ? "#EDF3FF" : "#FFFFFF",
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

const isMaterialYouAvailable =
  Platform.OS === "android" && typeof Platform.Version === "number" && Platform.Version >= 31;

function getThemeColors(useMaterialYou: boolean) {
  if (useMaterialYou && isMaterialYouAvailable) {
    const scheme = getDynamicColorScheme(SCOLA_BRAND.blue);
    return {
      light: {
        primary: scheme.light.primary,
        tint: scheme.light.primary,
        background: scheme.light.surfaceContainer,
        overground: scheme.light.surfaceContainer,
        text: scheme.light.onBackground,
        card: scheme.light.surfaceDim,
        item: scheme.light.surfaceContainerLowest,
        border: scheme.light.outlineVariant,
      },
      dark: {
        primary: scheme.dark.primaryContainer,
        tint: scheme.dark.primary,
        background: scheme.dark.background,
        overground: scheme.dark.background,
        text: scheme.dark.onBackground,
        card: scheme.dark.surfaceContainer,
        item: scheme.dark.surfaceContainer,
        border: scheme.dark.outlineVariant,
      },
    };
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
