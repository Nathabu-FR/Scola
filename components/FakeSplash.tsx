import { SplashScreen } from "expo-router";
import { SCOLA_BRAND } from "@/constants/scolaBrand";
import React from "react";
import { Image } from "react-native";
import Reanimated, { Easing, withDelay, withTiming } from "react-native-reanimated";

export const ScolaSplashOut = () => {
  "worklet";
  return {
    initialValues: {
      opacity: 1,
    },
    animations: {
      opacity: withDelay(100, withTiming(0, {
        duration: 250,
        easing: Easing.out(Easing.ease),
      })),
    },
  };
};

const FakeSplash = ({ isAppReady, instant }: { isAppReady: boolean, instant?: boolean }) => {
  if (instant && isAppReady) {
    SplashScreen.hideAsync();
    return null;
  }

  return (
    <Reanimated.View
      style={{
        flex: 1,
        width: "100%",
        height: "100%",
        position: "absolute",
        top: 0,
        left: 0,
        zIndex: 9999,
        backgroundColor: SCOLA_BRAND.navy,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
      exiting={ScolaSplashOut}
    >
      <Image
        source={require('@/assets/images/logotype.png')}
        style={{ width: 240, height: 53 }}
        resizeMode="contain"
      />
    </Reanimated.View>
  );
};

export default FakeSplash;