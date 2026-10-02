import { SplashScreen } from "expo-router";
import { SCOLA_BRAND } from "@/constants/scolaBrand";
import React from "react";
import { Image, View } from "react-native";

const FakeSplash = ({ isAppReady, instant }: { isAppReady: boolean; instant?: boolean }) => {
  if (instant && isAppReady) {
    SplashScreen.hideAsync();
    return null;
  }

  return (
    <View
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 9999,
        backgroundColor: SCOLA_BRAND.navy,
        justifyContent: "center",
        alignItems: "center",
      }}
    >
      <Image
        source={require("@/assets/images/logotype-scola.png")}
        style={{ width: 240, height: 53 }}
        resizeMode="contain"
      />
    </View>
  );
};

export default FakeSplash;
