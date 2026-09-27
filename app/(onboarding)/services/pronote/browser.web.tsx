import { Papicons } from "@getpapillon/papicons";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import Button from "@/ui/components/Button";
import Icon from "@/ui/components/Icon";
import Typography from "@/ui/components/Typography";

export default function PronoteDesktopLogin() {
  const { t } = useTranslation();

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 }}>
        <Icon size={42}>
          <Papicons name="QrCode" />
        </Icon>
        <Typography variant="h3" align="center">
          {t("ONBOARDING_PRONOTE_QRCODE_DESKTOP_TITLE", "Connexion Pronote sur ordinateur")}
        </Typography>
        <Typography variant="body1" color="textSecondary" align="center" style={{ maxWidth: 560 }}>
          {t(
            "ONBOARDING_PRONOTE_QRCODE_DESKTOP_DESCRIPTION",
            "Scola s'appuie sur Pawnote pour sécuriser la session. Affiche le QR code de connexion Pronote sur un autre écran, puis scanne-le avec la caméra de ton ordinateur."
          )}
        </Typography>
        <Button
          title={t("ONBOARDING_METHOD_QRCODE", "Connexion par QR code")}
          onPress={() => router.replace("/(onboarding)/services/pronote/qrcode")}
          style={{ marginTop: 8 }}
        />
        <Button
          title={t("ONBOARDING_GO_BACK", "Retour")}
          onPress={() => router.back()}
        />
      </View>
    </SafeAreaView>
  );
}
