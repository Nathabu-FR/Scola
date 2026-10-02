import { SplashScreen } from "expo-router";
import React from "react";
import { Image } from "react-native";
import Reanimated, { Easing, withDelay, withTiming } from "react-native-reanimated";

export const SplashOut = () => {
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
        backgroundColor: "#29947A",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
      }}
      exiting={SplashOut}
    >
      <Image
        source={require('@/assets/images/splash.png')}
        style={{
          width: "100%",
          height: "100%",
          position: "absolute",
          top: 0,
          left: 0,
          zIndex: -1,
        }}
        resizeMode="cover"
      />
    </Reanimated.View>
  );
};

export default FakeSplash;
