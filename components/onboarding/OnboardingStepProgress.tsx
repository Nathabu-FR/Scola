import React from "react";
import { View } from "react-native";
import { useTheme } from "expo-router/react-navigation";
import { useTranslation } from "react-i18next";

import Stack from "@/ui/components/Stack";
import Typography from "@/ui/new/Typography";

export default function OnboardingStepProgress({
  step,
  total,
  title,
  description,
}: {
  step: number;
  total: number;
  title: string;
  description?: string;
}) {
  const { colors } = useTheme();
  const { t } = useTranslation();

  return (
    <Stack gap={8} style={{ width: "100%", paddingBottom: 8 }}>
      <Stack direction="horizontal" gap={8}>
        <Typography variant="body2" color="textPrimary">
          {t("STEP")} {step}
        </Typography>
        <Typography variant="body2" color="textSecondary">
          {t("STEP_OUTOF")} {total}
        </Typography>
      </Stack>
      <View style={{ flexDirection: "row", gap: 5 }}>
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            style={{
              height: 4,
              flex: 1,
              borderRadius: 4,
              backgroundColor: index < step ? colors.tint : colors.border,
            }}
          />
        ))}
      </View>
      <Typography variant="h2">{title}</Typography>
      {description ? (
        <Typography variant="body1" color="textSecondary">
          {description}
        </Typography>
      ) : null}
    </Stack>
  );
}
