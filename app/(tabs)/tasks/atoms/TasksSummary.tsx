import React from 'react';
import Reanimated, { LinearTransition } from 'react-native-reanimated';
import { useTheme } from "expo-router/react-navigation";

import { CircularProgress } from '@/ui/components/CircularProgress';
import Stack from '@/ui/components/Stack';
import Typography from '@/ui/components/Typography';
import { PapillonAppearIn, PapillonAppearOut } from '@/ui/utils/Transition';
import { Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Dynamic } from "@/ui/components/Dynamic";

interface TasksSummaryProps {
  totalCount: number;
  remainingCount: number;
  headerHeight: number;
}

const TasksSummary: React.FC<TasksSummaryProps> = ({
  totalCount,
  remainingCount,
  headerHeight,
}) => {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const colors = theme.colors;

  return (
    <Reanimated.View
      entering={PapillonAppearIn}
      exiting={PapillonAppearOut}
      layout={Platform.OS === "web" ? undefined : LinearTransition}
      style={{
        marginTop:
          headerHeight + (Platform.OS === "android" ? 10 : -insets.top + 10),
      }}
    >
      {Platform.OS === "ios" && (
        <LinearGradient
          colors={[theme.colors.tint + (theme.dark ? "FF" : "90"), theme.colors.tint + "00"]}
          start={[0, 0.7]}
          end={[0, 1]}
          style={{
            position: "absolute",
            top: -500,
            left: -20,
            right: -20,
            bottom: -20,
            borderRadius: 20,
            zIndex: -1,
            opacity: 0.2,
          }}
        />
      )}
      <Dynamic animated>
        <Stack flex width={"100%"} hAlign={"center"}>
          <Dynamic animated>
          <Stack
            flex
            gap={16}
            hAlign="center"
            vAlign="center"
            direction="horizontal"
            style={{ marginBottom: 16 }}
          >
            <CircularProgress
              backgroundColor={colors.tint + "15"}
              percentageComplete={
                totalCount === 0 ? 100 : ((totalCount - remainingCount) / totalCount) * 100
              }
              radius={15}
              strokeWidth={5}
              fill={theme.colors.tint}
              showCheckmark={true}
            />
            <Typography variant="title" color={theme.colors.tint}>
              {remainingCount === 0
                ? "Aucun devoir restant"
                : `${remainingCount} devoir${remainingCount !== 1 ? "s" : ""} restant${remainingCount !== 1 ? "s" : ""}`}
            </Typography>
          </Stack>
          </Dynamic>
        </Stack>
      </Dynamic>
    </Reanimated.View>
  );
};

export default TasksSummary;
