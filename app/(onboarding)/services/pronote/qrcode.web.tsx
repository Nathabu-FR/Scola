import { CameraView, useCameraPermissions } from "expo-camera";
import * as Device from "expo-device";
import { router } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import {
  createSessionHandle,
  DoubleAuthMode,
  finishLoginManually,
  loginQrCode,
  RefreshInformation,
  SecurityError,
  securitySave,
  securitySource,
  SessionHandle,
} from "@blockshub/pawnote-lts";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Modal, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Pronote2FAModal } from "./2fa";
import Button from "@/ui/components/Button";
import Typography from "@/ui/components/Typography";
import { useAccountStore } from "@/stores/account";
import { Services } from "@/stores/account/types";
import { customFetcher } from "@/utils/pronote/fetcher";
import { GetIdentityFromPronoteUsername } from "@/utils/pronote/name";
import uuid from "@/utils/uuid/uuid";

type PronoteQRPayload = {
  jeton: string;
  login: string;
  url: string;
};

export default function PronoteLoginWithQRWeb() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [permission, requestPermission] = useCameraPermissions();
  const [qrData, setQRData] = useState<string | null>(null);
  const [pin, setPin] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [challengeVisible, setChallengeVisible] = useState(false);
  const [challengeError, setChallengeError] = useState<SecurityError | null>(null);
  const [challengeSession, setChallengeSession] = useState<SessionHandle | null>(null);
  const [deviceId] = useState(() => uuid());

  useEffect(() => {
    if (!permission?.granted && permission?.canAskAgain !== false) {
      void requestPermission();
    }
  }, [permission?.granted, permission?.canAskAgain, requestPermission]);

  const finishAccountSetup = async (session: SessionHandle, refresh: RefreshInformation) => {
    const user = session.user.resources?.[0];
    if (!user) {
      throw new Error("Pronote n'a pas renvoyé les informations de l'élève.");
    }

    const { firstName, lastName } = GetIdentityFromPronoteUsername(session.user.name);
    const now = new Date().toISOString();
    const store = useAccountStore.getState();

    store.addAccount({
      id: deviceId,
      firstName,
      lastName,
      schoolName: user.establishmentName,
      className: user.className,
      customisation: { profilePicture: "", serviceProfilePicture: "", subjects: {} },
      services: [{
        id: deviceId,
        auth: {
          accessToken: refresh.token,
          refreshToken: refresh.token,
          additionals: {
            ...refresh,
            instanceURL: refresh.url,
            kind: refresh.kind,
            username: refresh.username,
            deviceUUID: deviceId,
          },
        },
        serviceId: Services.PRONOTE,
        createdAt: now,
        updatedAt: now,
      }],
      createdAt: now,
      updatedAt: now,
    });
    store.setLastUsedAccount(deviceId);
    router.dismissAll();
    router.replace("/");
  };

  const connect = async () => {
    setErrorMessage("");
    if (!qrData || pin.length !== 4) {
      setErrorMessage("Scanne le QR code puis saisis le code PIN à 4 chiffres.");
      return;
    }

    let qr: PronoteQRPayload;
    try {
      const decoded = JSON.parse(qrData);
      if (
        typeof decoded?.jeton !== "string" ||
        typeof decoded?.login !== "string" ||
        typeof decoded?.url !== "string" ||
        !/^https?:\/\//i.test(decoded.url)
      ) {
        throw new Error("Ce QR code ne contient pas les informations de connexion Pronote.");
      }
      qr = { jeton: decoded.jeton, login: decoded.login, url: decoded.url };
    } catch (cause) {
      setErrorMessage(cause instanceof Error ? cause.message : "QR code Pronote invalide.");
      return;
    }

    setLoading(true);
    try {
      const session = createSessionHandle(customFetcher);
      let refresh: RefreshInformation | undefined;

      try {
        refresh = await loginQrCode(session, { qr, pin, deviceUUID: deviceId });
      } catch (cause) {
        if (
          cause instanceof SecurityError &&
          !cause.handle.shouldCustomPassword &&
          !cause.handle.shouldCustomDoubleAuth
        ) {
          if (cause.handle.shouldEnterSource && !cause.handle.shouldEnterPIN) {
            const deviceName = Device.deviceName ?? "Scola";
            const source = deviceName.length > 30 ? "Scola" : deviceName;
            const mode: DoubleAuthMode = DoubleAuthMode.MGDA_NotificationSeulement;
            await securitySource(session, source);
            await securitySave(session, cause.handle, { mode, deviceName: source });
            const context = cause.handle.context;
            refresh = await finishLoginManually(
              session,
              context.authentication,
              context.identity,
              context.initialUsername
            );
          } else {
            setChallengeError(cause);
            setChallengeSession(session);
            setChallengeVisible(true);
            setLoading(false);
            return;
          }
        } else {
          throw cause;
        }
      }

      if (!refresh) {
        throw new Error("Pronote n'a pas confirmé la connexion.");
      }
      await finishAccountSetup(session, refresh);
    } catch (cause) {
      setErrorMessage(
        cause instanceof Error
          ? cause.message
          : "La connexion Pronote a échoué. Vérifie le QR code et le code PIN."
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: "center", padding: 24, gap: 16 }}>
        <Typography variant="h2">PRONOTE</Typography>
        <Typography variant="h3" align="center">
          {t("ONBOARDING_METHOD_QRCODE", "Connexion par QR code")}
        </Typography>
        <Typography variant="body1" color="textSecondary" align="center">
          Autorise la caméra de ton ordinateur, puis présente-lui le QR code de Pronote. Pawnote finalisera la connexion et chargera tes données.
        </Typography>

        {!qrData && permission?.granted && (
          <View style={{ width: "100%", maxWidth: 560, height: 270, overflow: "hidden", borderRadius: 20 }}>
            <CameraView
              style={{ flex: 1 }}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                setQRData(data);
                setErrorMessage("");
              }}
              onMountError={({ message }) => setErrorMessage(message)}
            />
          </View>
        )}

        {!qrData && !permission?.granted && (
          <View style={{ alignItems: "center", gap: 12, padding: 16 }}>
            <Typography variant="body1" color="textSecondary" align="center">
              {permission?.canAskAgain === false
                ? "L'accès à la caméra est bloqué dans les réglages du navigateur."
                : "La caméra est nécessaire pour lire le QR code Pronote."}
            </Typography>
            <Button
              title="Autoriser la caméra"
              onPress={() => void requestPermission()}
              style={{ marginTop: 4 }}
            />
          </View>
        )}

        {qrData && (
          <View style={{ width: "100%", maxWidth: 440, gap: 12 }}>
            <Typography variant="body1" color="textSecondary" align="center">
              QR code détecté. Saisis le code PIN associé.
            </Typography>
            <TextInput
              value={pin}
              onChangeText={value => setPin(value.replace(/\D/g, "").slice(0, 4))}
              placeholder="Code PIN à 4 chiffres"
              keyboardType="number-pad"
              secureTextEntry
              maxLength={4}
              autoFocus
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 14,
                color: colors.text,
                backgroundColor: colors.card,
                paddingHorizontal: 16,
                paddingVertical: 13,
                textAlign: "center",
                fontSize: 18,
              }}
            />
            <Button
              title={loading ? "Connexion en cours…" : "Se connecter"}
              onPress={() => void connect()}
              disabled={loading || pin.length !== 4}
            />
            {loading && <ActivityIndicator color={colors.tint} />}
            <Button
              title="Scanner un autre QR code"
              onPress={() => {
                setQRData(null);
                setPin("");
                setErrorMessage("");
              }}
              style={{ marginTop: 4 }}
            />
          </View>
        )}

        {!!errorMessage && (
          <Typography variant="body1" align="center" style={{ color: "#D60046", maxWidth: 560 }}>
            {errorMessage}
          </Typography>
        )}

        <Button
          title="Retour"
          onPress={() => router.back()}
          style={{ marginTop: "auto" }}
        />
      </ScrollView>

      <Modal
        visible={challengeVisible}
        animationType="slide"
        onRequestClose={() => setChallengeVisible(false)}
      >
        <Pronote2FAModal
          doubleAuthSession={challengeSession}
          doubleAuthError={challengeError}
          setChallengeModalVisible={setChallengeVisible}
          deviceId={deviceId}
        />
      </Modal>
    </SafeAreaView>
  );
}
