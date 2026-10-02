import React, { useMemo, useState } from "react";
import { Alert, Modal, Platform, Pressable, Switch, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useTheme } from "expo-router/react-navigation";
import { Papicons } from "@getpapillon/papicons";

import { useLogStore, useNetworkStore } from "@/stores/logs";
import List from "@/ui/new/List";
import Stack from "@/ui/components/Stack";
import Typography from "@/ui/new/Typography";
import Icon from "@/ui/components/Icon";
import { database } from "@/database";
import { ClearDatabaseForAccount } from "@/database/DatabaseProvider";
import { useAccountStore } from "@/stores/account";
import { Services } from "@/stores/account/types";
import { useSettingsStore } from "@/stores/settings";
import { useTipsStore } from "@/stores/tips";
import { showAllTips, tipsAreSupported } from "@/modules/papillon-tips";
import { useMagicStore } from "@/stores/magic";
import ModelManager from "@/utils/magic/ModelManager";
import { MAGIC_URL } from "@/utils/endpoints";
import { initializeTransport } from "@/utils/transport";
import LogIcon from "@/components/Log/LogIcon";
import { getManager, initializeAccountManager } from "@/services/shared";
import { warn } from "@/utils/logger/logger";

const HOSTS: Record<string, { title: string; icon: string }> = {
  "index-education": { title: "PRONOTE", icon: "Pronote" },
  "ecoledirecte.com": { title: "École Directe", icon: "EcoleDirecte" },
  "api.skolengo.com": { title: "Skolengo", icon: "Skolengo" },
  "analytics.papillon.bzh": { title: "Télémétrie", icon: "Info" },
  "github.com": { title: "Ressource(s)", icon: "Code" },
  "geopf.fr": { title: "Localisation", icon: "MapPin" },
  "raw.githubusercontent.com": { title: "GitHub", icon: "Code" }
};

export default function DevMode() {
  const theme = useTheme();
  const { colors } = theme;
  const [visibleCount, setVisibleCount] = useState<number>(5);
  const [logsVisible, setLogsVisible] = useState<boolean>(false);
  const [sourceEditorVisible, setSourceEditorVisible] = useState(false);
  const [sourceDraft, setSourceDraft] = useState("");
  const hosts = useNetworkStore((state) => state.hosts);
  const mockDataEnabled = useSettingsStore(
    state => state.personalization.mockDataEnabled ?? false
  );

  const entries = useMemo(() => {
    return Array.from(hosts.entries())
      .map(([urlStr, data]) => ({
        url: new URL(urlStr),
        count: data.requests.length,
        rawUrl: urlStr
      }))
      .sort((a, b) => b.count - a.count);
  }, [hosts]);

  const renderHostRow = (item: typeof entries[0]) => {
    const match = Object.entries(HOSTS).find(([key]) => item.url.host.toLowerCase().includes(key));
    const classification = match ? match[1] : { title: item.url.host, icon: "Globe" };
    const isSecure = item.url.protocol === "https:";

    return (
      <List.Item 
        key={item.rawUrl} 
        onPress={() => router.push({
          pathname: "/(dev)/requests",
          params: { host: `${item.url.protocol}//${item.url.host}` }
        })}
      >
        <List.Leading>
          <Stack direction="horizontal" gap={10}>
            <Papicons
              name={isSecure ? "Lock" : "Unlock"}
              color={isSecure ? colors.primary : "#C50017"}
            />
            <Papicons name={classification.icon} opacity={0.8} color={colors.text} />
          </Stack>
        </List.Leading>

        <Typography variant="title" numberOfLines={1}>
          {classification.title}
        </Typography>
        <Typography color="textSecondary" variant="body1" numberOfLines={1}>
          {item.url.host}
        </Typography>

        <List.Trailing>
          <Stack direction="horizontal" hAlign="center" gap={4}>
            <Typography variant="body1" weight="bold">{item.count}</Typography>
            <Papicons name="ChevronRight" color={colors.text} size={16} />
          </Stack>
        </List.Trailing>
      </List.Item>
    );
  };

  async function ClearWatermelon() {
    await database.write(async () => {
      await database.unsafeResetDatabase();
    });
  }

  async function ClearSettings() {
    useSettingsStore.getState().reset();
  }

  async function ClearAccounts() {
    useAccountStore.getState().reset();
  }
  async function ClearMagicCache() {
    useMagicStore.getState().clear();
  }

  const showMessage = (title: string, message: string) => {
    if (Platform.OS === "web") window.alert(`${title}\n\n${message}`);
    else Alert.alert(title, message);
  };

  const confirmAction = (title: string, message: string, confirmLabel = "Confirmer") => {
    if (Platform.OS === "web") return Promise.resolve(window.confirm(`${title}\n\n${message}`));
    return new Promise<boolean>(resolve => {
      Alert.alert(title, message, [
        { text: "Annuler", style: "cancel", onPress: () => resolve(false) },
        { text: confirmLabel, style: "destructive", onPress: () => resolve(true) },
      ], { cancelable: true, onDismiss: () => resolve(false) });
    });
  };

  const handleDangerousAction = async (action: () => Promise<unknown> | unknown) => {
    if (!(await confirmAction("Confirmation", "Es-tu sûr de vouloir faire cette opération ?"))) return;
    try {
      await action();
      showMessage("Succès", "Cette opération a été effectuée avec succès.");
    } catch (error) {
      showMessage("Erreur", String(error));
    }
  };

  const resetModel = async () => {
    try {
      const result = await ModelManager.reset();
      if (result.success) {
        showMessage("Succès", "Le modèle a été réinitialisé avec succès. Il sera retéléchargé au prochain démarrage.");
      } else {
        showMessage("Erreur", `Échec du reset : ${result.error}`);
      }
    } catch (error) {
      showMessage("Erreur", `Erreur lors du reset : ${String(error)}`);
    }
  }

  const handlePress = async (action: () => Promise<unknown> | unknown) => {
    try {
      const result = await action();
      if (result && typeof result === "object" && "success" in result && result.success === false) {
        showMessage("Erreur", "error" in result ? String(result.error) : "L’opération a échoué.");
        return;
      }
      // Certains boutons renvoyaient `undefined` après un console.log : le
      // toast « succès » s'affichait mais l'utilisateur ne voyait aucun
      // résultat (« certains boutons de mode dev ne fonctionnent pas »).
      // Si l'action renvoie un texte, on l'affiche tel quel.
      showMessage("Succès", typeof result === "string" && result.length > 0 ? result : "Cette opération a été effectuée avec succès.");
    } catch (error) {
      showMessage("Erreur", String(error));
    }
  }

  const setMockDataEnabled = async (enabled: boolean) => {
    if (enabled) {
      if (await confirmAction("Activer les données fictives", "Un service scolaire fictif apparaîtra dans l’ajout de compte.", "Activer")) {
        useSettingsStore.getState().mutateProperty("personalization", { mockDataEnabled: true });
      }
      return;
    }

    if (!(await confirmAction("Désactiver les données fictives", "Les services fictifs et leurs données locales seront supprimés.", "Désactiver"))) return;
    try {
      const profiles = useAccountStore.getState().accounts;
      const mockOnlyAccountIds = new Set(
        profiles
          .filter(account =>
            account.services.length > 0 &&
            account.services.every(service => service.serviceId === Services.MOCK_DATA)
          )
          .map(account => account.id)
      );
      const mockServices = profiles.flatMap(account =>
        account.services
          .filter(service => service.serviceId === Services.MOCK_DATA)
          .map(service => ({ service, profile: account }))
      );
      for (const { service } of mockServices) {
        // Les données mock sont taguées par service.id (createdByAccount =
        // accountId du plugin), pas par l'id du service : l'ancien appel
        // ClearDatabaseForAccount(service.id) ne supprimait rien et le compte
        // démo survivait. On nettoie par compte propriétaire.
        await ClearDatabaseForAccount(service.id).catch(() => undefined);
        getManager()?.removeService(service.id);
        useAccountStore.getState().removeServiceFromAccount(service.id);
      }
      for (const accountId of mockOnlyAccountIds) {
        const profile = useAccountStore.getState().accounts.find(account => account.id === accountId);
        if (profile && profile.services.length === 0) {
          await ClearDatabaseForAccount(profile.id);
          useAccountStore.getState().removeAccount(profile);
        }
      }
      useSettingsStore.getState().mutateProperty("personalization", { mockDataEnabled: false });
      const activeAccountId = useAccountStore.getState().lastUsedAccount;
      if (activeAccountId) {
        try {
          await initializeAccountManager(activeAccountId);
        } catch (cause) {
          warn(`Mock Data was disabled, but the account manager could not refresh: ${String(cause)}`);
        }
      }
    } catch (cause) {
      showMessage("Erreur", `Impossible de désactiver les données fictives : ${String(cause)}`);
    }
  };

  const forceAllTips = useTipsStore(state => state.forceAll);

  const triggerAllTips = async () => {
    useTipsStore.getState().setForceAll(true);
    await showAllTips();
    showMessage("Astuces forcées", "Chaque astuce réapparaîtra sur son écran sans attendre le nombre d'ouvertures habituel, et sans consommer ses passages.");
  };

  // Only lifts our own override. TipKit's `showAllTipsForTesting` has no
  // counterpart that simply cancels it — `hideAllTipsForTesting` force-hides
  // everything instead — so the override itself dies with the process, and is
  // just not re-applied at the next launch.
  const stopForcingTips = () => {
    useTipsStore.getState().setForceAll(false);
    showMessage("Astuces", "Les astuces reprennent leur rythme normal. Celles déjà à l'écran le resteront jusqu'au prochain lancement.");
  };

  const resetAllTips = async () => {
    if (!(await confirmAction("Réinitialiser les astuces", "Les compteurs repartent de zéro et les astuces déjà fermées reviendront au prochain lancement.", "Réinitialiser"))) return;
    const tips = useTipsStore.getState();
    tips.reset();
    tips.requestDatastoreReset();
    showMessage("Astuces", "Les compteurs ont été réinitialisés.");
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.overground }}>
      <List showsVerticalScrollIndicator={false} animated contentInsetAdjustmentBehavior="always" contentContainerStyle={{ padding: 16 }}>
        <List.Section>
          <List.SectionTitle>
            <Papicons name="Code" color={String(colors.text) + "88"} />
            <List.Label>Données de développement</List.Label>
          </List.SectionTitle>
          <List.Item>
            <Typography variant="action">Ajouter des données fictives</Typography>
            <Typography variant="body2" color="textSecondary">
              Affiche un service scolaire fictif dans l'ajout de compte.
            </Typography>
            <List.Trailing>
              <Switch value={mockDataEnabled} onValueChange={setMockDataEnabled} />
            </List.Trailing>
          </List.Item>
        </List.Section>
        <List.Section>
          <List.SectionTitle>
            <Papicons name="Code" color={colors.text + 88} />
            <List.Label>Liste des journaux</List.Label>
          </List.SectionTitle>
          <List.Item>
            <Typography variant="action">Afficher les journaux</Typography>
            <List.Trailing>
              <Switch value={logsVisible} onValueChange={setLogsVisible}/>
            </List.Trailing>
          </List.Item>
          {logsVisible && useLogStore.getState().logs
            .slice()
            .reverse()
            .slice(0, visibleCount)
            .map((logEntry, index) => (
              <List.Item key={index}>
                <List.Leading>
                  <LogIcon type={logEntry.type} />
                </List.Leading>
                <Typography variant="body2">{logEntry.message}</Typography>
                <Typography variant="caption">
                  {new Date(logEntry.date).toLocaleString()} -{" "}
                  {logEntry.from ?? "UNKNOW"}
                </Typography>
              </List.Item>
            ))}
            {logsVisible && (
              <List.Item onPress={() => setVisibleCount(visibleCount + 5)}>
                <List.Leading>
                  <Papicons name="Plus" />
                </List.Leading>
                <Typography>Afficher plus</Typography>
              </List.Item>
            )}
        </List.Section>
        <List.Section>
          <List.SectionTitle>
            <Papicons name="Globe" color={colors.text + 88} />
            <List.Label>Liste des requêtes</List.Label>
          </List.SectionTitle>
          {entries.map(renderHostRow)}
        </List.Section>
        <List.Section>
          <List.SectionTitle>
            <Papicons name="phone" color={colors.text + 88} />
            <List.Label>Écrans</List.Label>
          </List.SectionTitle>
          <List.Item onPress={() => router.push("/(modals)/welcome")}>
            <List.Leading>
              <Icon>
                <Papicons name="Sparkles" />
              </Icon>
            </List.Leading>
            <Typography variant="action">Ouvrir le modal de bienvenue</Typography>
          </List.Item>
        </List.Section>
        {tipsAreSupported && (
          <List.Section>
            <List.SectionTitle>
              <Papicons name="Sparkles" color={String(colors.text) + "88"} />
              <List.Label>Astuces</List.Label>
            </List.SectionTitle>
            <List.Item onPress={() => (forceAllTips ? stopForcingTips() : triggerAllTips())}>
              <List.Leading>
                <Icon>
                  <Papicons name="Sparkles" />
                </Icon>
              </List.Leading>
              <Typography variant="action">
                {forceAllTips ? "Ne plus forcer les astuces" : "Forcer toutes les astuces"}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                Affiche chaque astuce dès le prochain passage sur son écran, sans
                attendre le nombre d'ouvertures habituel.
              </Typography>
            </List.Item>
            <List.Item onPress={resetAllTips}>
              <List.Leading>
                <Icon>
                  <Papicons name="Trash" />
                </Icon>
              </List.Leading>
              <Typography variant="action">Réinitialiser toutes les astuces</Typography>
              <Typography variant="body2" color="textSecondary">
                Remet les compteurs à zéro. Les astuces déjà fermées reviennent au
                prochain lancement.
              </Typography>
            </List.Item>
          </List.Section>
        )}
        <List.Section>
          <List.SectionTitle>
            <Papicons name="Bus" color={colors.text + 88} />
            <List.Label>Transport</List.Label>
          </List.SectionTitle>
          <List.Item onPress={() => void handlePress(async () => {
            // initializeTransport(undefined) jette sur desktop/web quand la
            // géolocalisation est refusée : le bouton « Initialiser sans
            // adresse » semblait ne rien faire. On renvoie un résumé lisible.
            const transport = await initializeTransport(undefined);
            return `Transport prêt (${transport.defaultApp}, domicile : ${transport.homeAddress ? "oui" : "non"})`;
          })}>
            <Typography variant="action">Initialiser sans adresse</Typography>
          </List.Item>
          <List.Item onPress={() => void handlePress(async () => {
            const transport = await initializeTransport("106 Rue de la Pompe, 75016 Paris");
            return `Transport prêt (${transport.defaultApp}, école : ${transport.schoolAddress ? "oui" : "non"})`;
          })}>
            <Typography variant="action">Initialiser avec une adresse</Typography>
          </List.Item>
        </List.Section>
        <List.Section>
          <List.SectionTitle>
            <Papicons name="Sparkles" color={colors.text + 88} />
            <List.Label>Scola Magic+</List.Label>
          </List.SectionTitle>
            <List.Item onPress={() => handlePress(ClearMagicCache)}>
              <Typography variant="action">Supprimer le cache de Magic</Typography>
              <List.Trailing>
                <Typography color="textSecondary" variant="action">
                  {useMagicStore.getState().processHomeworks.length} devoirs
                </Typography>
              </List.Trailing>
            </List.Item>
            <List.Item onPress={() => void handlePress(async () => {
              const result = await ModelManager.refresh();
              if (!result.success) throw new Error(result.error ?? "Échec du rafraîchissement");
              return result.updated ? "Modèle mis à jour." : "Modèle déjà à jour.";
            })}>
              <Typography variant="action">Rafraîchir le modèle</Typography>
            </List.Item>
            <List.Item onPress={() => void resetModel()}>
              <Typography variant="action">Réinitialiser le modèle</Typography>
            </List.Item>
            <List.Item onPress={() => {
              const status = ModelManager.getStatus();
              showMessage(
                "Statut du modèle",
                `Modèle chargé: ${status.hasModel ? "Oui" : "Non"}\n` +
                  `Max Length: ${status.maxLen}\n` +
                  `Nombre de labels: ${status.labelsCount}\n` +
                  `Taille du vocabulaire: ${status.wordIndexSize}\n` +
                  `Index OOV: ${status.oovIndex}`
              );
            }}>
              <Typography variant="action">Afficher les informations du modèle</Typography>
            </List.Item>
            <List.Item onPress={async () => {
                try {
                  const result = await ModelManager.predict(
                    "ds analyse de doc",
                    true
                  );
                  if ("error" in result) {
                    showMessage("Erreur de prédiction", result.error);
                  } else {
                    showMessage(
                      "Test de prédiction réussi",
                      `Prédiction: ${result.predicted}\nScores: ${result.scores
                        .slice(0, 3)
                        .map(s => s.toFixed(3))
                        .join(", ")}...`
                    );
                  }
                } catch (error) {
                  showMessage("Erreur", `Erreur lors du test : ${String(error)}`);
                }
              }}>
              <Typography variant="action">Tester les prédictions</Typography>
            </List.Item>
            <List.Item onPress={() => {
              const currentURL = useSettingsStore.getState().personalization.magicModelURL || MAGIC_URL;
              setSourceDraft(currentURL);
              setSourceEditorVisible(true);
            }}>
              <Typography variant="action">Changer la source de Magic</Typography>
            </List.Item>
            <List.Item onPress={() => handlePress(() => {
              useSettingsStore.getState().mutateProperty("personalization", {
                magicModelURL: MAGIC_URL
              })
            })}>
              <Typography variant="action">Réinitialiser la source de Magic</Typography>
            </List.Item>
        </List.Section>
        <List.Section>
          <List.SectionTitle>
            <Papicons name="AlertTriangle" color={colors.text + 88} />
            <List.Label>Zone de danger</List.Label>
          </List.SectionTitle>
          <List.Item onPress={async () => handleDangerousAction(ClearWatermelon)}>
            <List.Leading>
              <Icon>
                <Papicons name="Trash" />
              </Icon>
            </List.Leading>
            <Typography variant="action">Supprimer la base de données</Typography>
          </List.Item>
          <List.Item onPress={() => handleDangerousAction(ClearSettings)}>
            <List.Leading>
              <Icon>
                <Papicons name="Trash" />
              </Icon>
            </List.Leading>
            <Typography variant="action">Supprimer les paramètres</Typography>
          </List.Item>
          <List.Item onPress={() => handleDangerousAction(ClearAccounts)}>
            <List.Leading>
              <Icon>
                <Papicons name="Trash" />
              </Icon>
            </List.Leading>
            <Typography variant="action">Supprimer les comptes</Typography>
          </List.Item>
          <List.Item 
            style={{ backgroundColor: "#C50017" }} 
            onPress={() => handleDangerousAction(async () => {
              await ClearWatermelon();
              await ClearSettings();
              await ClearAccounts();

              router.dismissAll();
              router.reload();
            })}
          >
            <List.Leading>
              <Icon fill="#FFFFFF" opacity={1}>
                <Papicons name="Trash" />
              </Icon>
            </List.Leading>
            <Typography variant="title" color="white">Réinitialiser Scola</Typography>
            <Typography variant="subtitle" color="white">Efface définitivement vos comptes, paramètres et données locales.</Typography>
          </List.Item>
        </List.Section>
      </List>
      <Modal visible={sourceEditorVisible} transparent animationType="fade" onRequestClose={() => setSourceEditorVisible(false)}>
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", padding: 24, backgroundColor: "#0009" }}>
          <View style={{ width: "100%", maxWidth: 520, gap: 14, padding: 20, borderRadius: 18, backgroundColor: colors.card }}>
            <Typography variant="title">Source du modèle Magic</Typography>
            <TextInput
              value={sourceDraft}
              onChangeText={setSourceDraft}
              autoCapitalize="none"
              keyboardType="url"
              placeholder="https://…"
              placeholderTextColor={String(colors.text) + "80"}
              style={{ color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12 }}
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
              <Pressable onPress={() => setSourceEditorVisible(false)} style={{ padding: 12 }}>
                <Typography variant="body1">Annuler</Typography>
              </Pressable>
              <Pressable
                onPress={() => {
                  const value = sourceDraft.trim();
                  if (!value) return;
                  useSettingsStore.getState().mutateProperty("personalization", { magicModelURL: value });
                  setSourceEditorVisible(false);
                  showMessage("Succès", "URL du modèle Magic mise à jour.");
                }}
                style={{ padding: 12 }}
              >
                <Typography variant="body1" weight="semibold" style={{ color: colors.primary }}>Valider</Typography>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
