import * as Device from "expo-device";
import { router, useLocalSearchParams } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import {
  AccountKind,
  createSessionHandle,
  DoubleAuthMode,
  finishLoginManually,
  loginCredentials,
  loginToken,
  RefreshInformation,
  SecurityError,
  securitySave,
  securitySource,
  SessionHandle,
} from "@blockshub/pawnote-lts";
import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAccountStore } from "@/stores/account";
import { Services } from "@/stores/account/types";
import Button from "@/ui/components/Button";
import Typography from "@/ui/components/Typography";
import { customFetcher } from "@/utils/pronote/fetcher";
import { GetIdentityFromPronoteUsername } from "@/utils/pronote/name";
import uuid from "@/utils/uuid/uuid";
import { useSafeHorizontalPadding } from "@/ui/hooks/useSafeHorizontalPadding";
import { isTauriDesktop } from "@/utils/network/fetch";
import { Papicons } from "@getpapillon/papicons";

import { Pronote2FAModal } from "./2fa";

const asString = (value: unknown): string => {
  if (Array.isArray(value)) return asString(value[0]);
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const school = value as Record<string, unknown>;
    return asString(school.name ?? school.context ?? school.city);
  }
  return "";
};

export default function PronoteDesktopLogin() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const safePadding = useSafeHorizontalPadding(20);
  const params = useLocalSearchParams<{
    url?: string;
    school?: string | { name?: string; context?: string; city?: string };
    relinkAccountId?: string;
    relinkServiceId?: string;
    relinkDeviceUUID?: string;
  }>();

  const url = asString(params.url);
  const school = asString(params.school);
  const relinkAccountId = asString(params.relinkAccountId);
  const relinkServiceId = asString(params.relinkServiceId);
  const relinkDeviceUUID = asString(params.relinkDeviceUUID);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [directMode, setDirectMode] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [challengeVisible, setChallengeVisible] = useState(false);
  const [challengeError, setChallengeError] = useState<SecurityError | null>(null);
  const [challengeSession, setChallengeSession] = useState<SessionHandle | null>(null);
  const [deviceId] = useState(() => relinkDeviceUUID || uuid());
  const unlistenTauriEvents = useRef<Array<() => void>>([]);
  const goBack = () => router.canGoBack()
    ? router.back()
    : router.replace("/(onboarding)/services/pronote/locate");

  useEffect(() => () => {
    unlistenTauriEvents.current.forEach(unlisten => unlisten());
    if (typeof window !== "undefined" && window.location.hostname === "tauri.localhost") {
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("close_pronote_login"))
        .catch(() => undefined);
    }
  }, []);

  const finishAccountSetup = async (session: SessionHandle, refresh: RefreshInformation) => {
    const user = session.user.resources?.[0];
    if (!user) {
      throw new Error("Pronote n'a pas renvoyé les informations de l'élève.");
    }

    const { firstName, lastName } = GetIdentityFromPronoteUsername(session.user.name);
    const now = new Date().toISOString();
    const auth = {
      accessToken: refresh.token,
      refreshToken: refresh.token,
      additionals: {
        ...refresh,
        instanceURL: refresh.url,
        kind: refresh.kind,
        username: refresh.username,
        deviceUUID: deviceId,
      },
    };
    const store = useAccountStore.getState();

    if (relinkAccountId && relinkServiceId) {
      store.updateServiceAuthData(relinkServiceId, auth);
      store.setLastUsedAccount(relinkAccountId);
    } else {
      store.addAccount({
        id: deviceId,
        firstName,
        lastName,
        schoolName: user.establishmentName,
        className: user.className,
        customisation: { profilePicture: "", serviceProfilePicture: "", subjects: {} },
        services: [{
          id: deviceId,
          auth,
          serviceId: Services.PRONOTE,
          createdAt: now,
          updatedAt: now,
        }],
        createdAt: now,
        updatedAt: now,
      });
      store.setLastUsedAccount(deviceId);
    }

    router.dismissAll();
    router.replace("/");
  };

  const connect = async () => {
    setErrorMessage("");
    if (!url) {
      setErrorMessage("L’adresse Pronote de l’établissement est manquante. Reviens à la recherche de l’établissement.");
      return;
    }
    if (!username.trim() || !password) {
      setErrorMessage("Saisis ton identifiant et ton mot de passe Pronote.");
      return;
    }

    setLoading(true);
    try {
      const session = createSessionHandle(customFetcher);
      let refresh: RefreshInformation | undefined;

      try {
        refresh = await loginCredentials(session, {
          url,
          deviceUUID: deviceId,
          kind: AccountKind.STUDENT,
          username: username.trim(),
          password,
        });
      } catch (cause) {
        if (
          cause instanceof SecurityError &&
          !cause.handle.shouldCustomPassword &&
          !cause.handle.shouldCustomDoubleAuth
        ) {
          if (cause.handle.shouldEnterSource && !cause.handle.shouldEnterPIN) {
            const deviceName = Device.deviceName ?? "Scola";
            const source = deviceName.length > 30 ? "Scola" : deviceName;
            await securitySource(session, source);
            await securitySave(session, cause.handle, {
              mode: DoubleAuthMode.MGDA_NotificationSeulement,
              deviceName: source,
            });
            const context = cause.handle.context;
            refresh = await finishLoginManually(
              session,
              context.authentication,
              context.identity,
              context.initialUsername,
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
          : "La connexion Pronote a échoué. Vérifie ton identifiant et ton mot de passe."
      );
    } finally {
      setLoading(false);
    }
  };

  const connectWithEntToken = async (loginState: { status?: number; login?: string; mdp?: string }) => {
    if (loginState.status !== 0 || !loginState.login || !loginState.mdp) {
      setLoading(false);
      setErrorMessage("L’ENT n’a pas transmis de session Pronote valide. Réessaie la connexion.");
      return;
    }

    setLoading(true);
    setErrorMessage("");
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("close_pronote_login").catch(() => undefined);
      const session = createSessionHandle(customFetcher);
      let refresh: RefreshInformation | undefined;
      try {
        refresh = await loginToken(session, {
          url,
          kind: AccountKind.STUDENT,
          username: loginState.login,
          token: loginState.mdp,
          deviceUUID: deviceId,
        });
      } catch (cause) {
        if (
          cause instanceof SecurityError &&
          !cause.handle.shouldCustomPassword &&
          !cause.handle.shouldCustomDoubleAuth
        ) {
          if (cause.handle.shouldEnterSource && !cause.handle.shouldEnterPIN) {
            const deviceName = Device.deviceName ?? "Scola";
            const source = deviceName.length > 30 ? "Scola" : deviceName;
            await securitySource(session, source);
            await securitySave(session, cause.handle, {
              mode: DoubleAuthMode.MGDA_NotificationSeulement,
              deviceName: source,
            });
            const context = cause.handle.context;
            refresh = await finishLoginManually(
              session,
              context.authentication,
              context.identity,
              context.initialUsername,
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

      if (!refresh) throw new Error("Pronote n’a pas confirmé la connexion.");
      await finishAccountSetup(session, refresh);
    } catch (cause) {
      setErrorMessage(
        cause instanceof Error
          ? cause.message
          : "La connexion Pronote via l’ENT a échoué. Réessaie."
      );
    } finally {
      setLoading(false);
    }
  };

  const connectViaEnt = async () => {
    setErrorMessage("");
    if (!url) {
      setErrorMessage("L’adresse Pronote de l’établissement est manquante. Reviens à la recherche de l’établissement.");
      return;
    }
    if (!isTauriDesktop()) {
      setErrorMessage("La fenêtre de connexion ENT est disponible dans l’application Scola pour ordinateur.");
      return;
    }

    setLoading(true);
    try {
      const [{ invoke }, { listen }] = await Promise.all([
        import("@tauri-apps/api/core"),
        import("@tauri-apps/api/event"),
      ]);
      unlistenTauriEvents.current.forEach(unlisten => unlisten());
      const unlistenLogin = await listen<string>("scola-pronote-login-state", event => {
        let loginState: { status?: number; login?: string; mdp?: string };
        try {
          loginState = JSON.parse(event.payload);
        } catch {
          setLoading(false);
          setErrorMessage("La réponse de l’ENT est illisible. Réessaie la connexion.");
          return;
        }
        void connectWithEntToken(loginState);
      });
      const unlistenError = await listen("scola-pronote-connection-error", () => {
        setLoading(false);
        setErrorMessage("Pronote a signalé une erreur de connexion. Vérifie l’ENT de ton établissement.");
      });
      unlistenTauriEvents.current = [unlistenLogin, unlistenError];
      await invoke("open_pronote_login", { url, deviceUUID: deviceId });
    } catch (cause) {
      setLoading(false);
      setErrorMessage(
        cause instanceof Error
          ? cause.message
          : "Impossible d’ouvrir la fenêtre de connexion ENT."
      );
    }
  };

  const inputStyle = {
    width: "100%" as const,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    color: colors.text,
    backgroundColor: colors.card,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retour"
        onPress={goBack}
        style={{ position: "absolute", left: 16, top: 12, zIndex: 2, width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 22, backgroundColor: "#8B5CF620" }}
      >
        <Papicons name="ArrowLeft" size={23} color="#8B5CF6" />
      </Pressable>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, alignItems: "center", justifyContent: "center", padding: 24, ...safePadding }}
        >
          <View style={{ width: "100%", maxWidth: 480, gap: 16 }}>
            <Typography variant="h2" align="center">PRONOTE</Typography>
            <Typography variant="h3" align="center">
              {school ? `Connexion à ${school}` : "Connexion à Pronote"}
            </Typography>

            {!directMode ? (
              <>
                <Typography variant="body1" color="textSecondary" align="center">
                  Connecte-toi sur la page officielle de l’ENT de ton établissement.
                </Typography>
                {!!errorMessage && (
                  <Typography variant="body1" align="center" style={{ color: "#D60046" }}>
                    {errorMessage}
                  </Typography>
                )}
                <Button
                  title={loading ? "Connexion en cours…" : "Se connecter avec l’ENT"}
                  onPress={() => void connectViaEnt()}
                  disabled={loading}
                  style={{ marginTop: 8 }}
                />
                {loading && <ActivityIndicator color={colors.tint} />}
                <Pressable disabled={loading} onPress={() => { setErrorMessage(""); setDirectMode(true); }}>
                  <Typography variant="body1" color="textSecondary" align="center">
                    Utiliser des identifiants Pronote directs
                  </Typography>
                </Pressable>
              </>
            ) : (
              <>
                <Typography variant="body1" color="textSecondary" align="center">
                  Cette méthode fonctionne uniquement si ton établissement autorise la connexion directe à Pronote.
                </Typography>
                <View style={{ gap: 10, marginTop: 8 }}>
                  <TextInput
                    value={username}
                    onChangeText={setUsername}
                    placeholder={t("ONBOARDING_USERNAME", "Identifiant Pronote")}
                    placeholderTextColor={colors.text + "80"}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="username"
                    textContentType="username"
                    editable={!loading}
                    returnKeyType="next"
                    style={inputStyle}
                  />
                  <TextInput
                    value={password}
                    onChangeText={setPassword}
                    placeholder={t("ONBOARDING_PASSWORD", "Mot de passe Pronote")}
                    placeholderTextColor={colors.text + "80"}
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoComplete="current-password"
                    textContentType="password"
                    editable={!loading}
                    onSubmitEditing={() => void connect()}
                    returnKeyType="go"
                    style={inputStyle}
                  />
                </View>
                {!!errorMessage && (
                  <Typography variant="body1" align="center" style={{ color: "#D60046" }}>
                    {errorMessage}
                  </Typography>
                )}
                <Button
                  title={loading ? "Connexion en cours…" : "Se connecter"}
                  onPress={() => void connect()}
                  disabled={loading || !username.trim() || !password}
                  style={{ marginTop: 4 }}
                />
                <Pressable disabled={loading} onPress={() => { setErrorMessage(""); setDirectMode(false); }}>
                  <Typography variant="body1" color="textSecondary" align="center">
                    Revenir à la connexion par l’ENT
                  </Typography>
                </Pressable>
              </>
            )}
            <Button
              title="Retour"
              onPress={goBack}
              disabled={loading}
              style={{ marginTop: 2 }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

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
          relinkAccountId={relinkAccountId || undefined}
          relinkServiceId={relinkServiceId || undefined}
        />
      </Modal>
    </SafeAreaView>
  );
}
