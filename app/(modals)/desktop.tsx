import { useTheme } from "expo-router/react-navigation";
import { Bell, Monitor } from "lucide-react-native";
import { useState } from "react";
import { Alert, View } from "react-native";

import { syncDesktopPreferences, type DesktopPreferences } from "@/services/local/desktopPreferences";
import { useSettingsStore } from "@/stores/settings";
import List from "@/ui/new/List";
import NativeSwitch from "@/ui/native/NativeSwitch";
import Typography from "@/ui/new/Typography";

export default function DesktopSettingsModal() {
  const { colors } = useTheme();
  const settings = useSettingsStore(state => state.personalization);
  const mutateProperty = useSettingsStore(state => state.mutateProperty);
  const [saving, setSaving] = useState(false);

  const preferences: DesktopPreferences = {
    closeToTray: settings.desktopCloseToTray ?? true,
    launchAtStartup: settings.desktopLaunchAtStartup ?? false,
    launchInBackground: settings.desktopLaunchInBackground ?? false,
  };

  const updatePreferences = async (updates: Partial<DesktopPreferences>) => {
    const next = { ...preferences, ...updates };
    if (!next.launchAtStartup) next.launchInBackground = false;
    setSaving(true);
    try {
      await syncDesktopPreferences(next);
      mutateProperty("personalization", {
        desktopCloseToTray: next.closeToTray,
        desktopLaunchAtStartup: next.launchAtStartup,
        desktopLaunchInBackground: next.launchInBackground,
      });
    } catch (error) {
      Alert.alert("Réglage non appliqué", String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <List
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
      style={{ flex: 1, backgroundColor: colors.overground }}
    >
      <View style={{ alignItems: "center", gap: 8, paddingVertical: 12 }}>
        <Monitor size={30} color={colors.primary} />
        <Typography variant="h3" weight="semibold">Scola sur Windows</Typography>
        <Typography variant="body1" color="textSecondary" style={{ textAlign: "center" }}>
          Choisis comment Scola reste disponible sur ton ordinateur.
        </Typography>
      </View>

      <List.Section>
        <List.Item>
          <List.Leading><Bell color={colors.text} size={20} /></List.Leading>
          <Typography variant="title">Garder Scola dans la zone de notification</Typography>
          <Typography color="textSecondary" numberOfLines={2}>Le bouton de fermeture masque la fenêtre, mais Scola continue de fonctionner.</Typography>
          <List.Trailing>
            <NativeSwitch value={preferences.closeToTray} disabled={saving} onValueChange={value => void updatePreferences({ closeToTray: value })} />
          </List.Trailing>
        </List.Item>

        <List.Item>
          <List.Leading><Monitor color={colors.text} size={20} /></List.Leading>
          <Typography variant="title">Démarrer avec Windows</Typography>
          <Typography color="textSecondary" numberOfLines={2}>Lance Scola automatiquement après l’ouverture de ta session.</Typography>
          <List.Trailing>
            <NativeSwitch value={preferences.launchAtStartup} disabled={saving} onValueChange={value => void updatePreferences({ launchAtStartup: value })} />
          </List.Trailing>
        </List.Item>

        <List.Item>
          <List.Leading><Bell color={colors.text} size={20} /></List.Leading>
          <Typography variant="title">Démarrer en arrière-plan</Typography>
          <Typography color="textSecondary" numberOfLines={2}>Scola démarre dans la zone de notification sans ouvrir sa fenêtre.</Typography>
          <List.Trailing>
            <NativeSwitch value={preferences.launchInBackground} disabled={saving || !preferences.launchAtStartup} onValueChange={value => void updatePreferences({ launchInBackground: value })} />
          </List.Trailing>
        </List.Item>
      </List.Section>
    </List>
  );
}
