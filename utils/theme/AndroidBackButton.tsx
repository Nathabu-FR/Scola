import React, { memo } from "react";
import { Platform, Pressable, StyleSheet, TouchableNativeFeedback, View } from "react-native";
import { useRouter } from "expo-router";
import { Papicons } from "@getpapillon/papicons";
import Icon from "@/ui/components/Icon";

export const AndroidBackButtonStyles = StyleSheet.create({
  container: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 36,
    marginRight: 12,
    marginLeft: -6,
    marginBottom: -3,
    overflow: "hidden",
  },
});

// Native iOS keeps the platform's own back chevron (see useScreenOptions),
// so this component only needs to cover the platforms where that chevron is
// deliberately turned off: Android, and desktop/web (Electron, Tauri, and
// the plain web build), which previously had no back affordance at all.
const AndroidBackButton = () => {
  const router = useRouter();

  if (Platform.OS === "android") {
    return (
      <TouchableNativeFeedback
        onPress={router.back}
        useForeground
      >
        <View style={AndroidBackButtonStyles.container}>
          <Icon size={26}>
            <Papicons name="arrowleft" />
          </Icon>
        </View>
      </TouchableNativeFeedback>
    );
  }

  if (Platform.OS === "web") {
    return (
      <Pressable
        onPress={() => router.back()}
        style={({ pressed }) => [
          AndroidBackButtonStyles.container,
          { opacity: pressed ? 0.5 : 1 },
        ]}
      >
        <Icon size={26}>
          <Papicons name="arrowleft" />
        </Icon>
      </Pressable>
    );
  }

  return null;
};

export default memo(AndroidBackButton);