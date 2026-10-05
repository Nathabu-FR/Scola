import { Papicons } from "@getpapillon/papicons";
import { useTheme } from "expo-router/react-navigation";
import { useState } from "react";
import { Alert, Platform, View } from "react-native";

import { useSettingsStore } from "@/stores/settings";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import NativeSwitch from "@/ui/native/NativeSwitch";
import Picker from "@/ui/components/Picker";
import { requestHomeworkReminderPermission } from "@/services/local/homeworkNotifications";

export default function NotificationsModal() {
  const { colors } = useTheme();
  const settings = useSettingsStore(state => state.personalization);
  const mutateProperty = useSettingsStore(state => state.mutateProperty);
  const enabled = settings.homeworkRemindersEnabled ?? false;
  const daysBefore = settings.homeworkReminderDaysBefore ?? 1;
  const [requestingPermission, setRequestingPermission] = useState(false);
  const options = ["Le jour même à 8 h", "La veille à 18 h", "2 jours avant à 18 h"];
  const selectedIndex = daysBefore;
  const webNotificationsAvailable = Platform.OS !== "web" || typeof Notification !== "undefined";

  const setEnabled = async (next: boolean) => {
    if (!next) {
      mutateProperty("personalization", { homeworkRemindersEnabled: false });
      return;
    }

    setRequestingPermission(true);
    try {
      const granted = await requestHomeworkReminderPermission();
      if (!granted) {
        Alert.alert("Notifications désactivées", "Autorise les notifications de Scola dans les réglages de ton appareil pour recevoir les rappels.");
        return;
      }
      mutateProperty("personalization", { homeworkRemindersEnabled: true });
    } catch (error) {
      Alert.alert("Notifications indisponibles", String(error));
    } finally {
      setRequestingPermission(false);
    }
  };

  return (
    <List
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: 16, paddingBottom: 28 }}
      style={{ flex: 1, backgroundColor: colors.overground }}
    >
      <View style={{ alignItems: "center", gap: 6, paddingVertical: 10 }}>
        <Papicons name="Clock" size={30} color={colors.primary} />
        <Typography variant="h3" weight="semibold">Rappels de devoirs</Typography>
        <Typography variant="body1" color="textSecondary" style={{ textAlign: "center" }}>
          Les rappels utilisent les devoirs enregistrés sur ce profil.
        </Typography>
      </View>

      <List.Section>
        <List.Item>
          <List.Leading>
            <Papicons name="Clock" color={colors.text} />
          </List.Leading>
          <Typography variant="title">Activer les rappels</Typography>
          <Typography color="textSecondary" numberOfLines={2}>
            Une notification est programmée pour chaque devoir à venir.
          </Typography>
          <List.Trailing>
            <NativeSwitch
              value={enabled}
              disabled={requestingPermission || !webNotificationsAvailable}
              onValueChange={setEnabled}
            />
          </List.Trailing>
        </List.Item>

        <List.Item>
          <List.Leading>
            <Papicons name="Calendar" color={colors.text} />
          </List.Leading>
          <Typography variant="title">Quand prévenir</Typography>
          <Typography color="textSecondary" numberOfLines={2}>
            Choisis le délai avant la date de rendu.
          </Typography>
          <List.Trailing>
            <View style={{ width: 170, alignItems: "flex-end" }}>
              <Picker
                options={options}
                selectedIndex={selectedIndex}
                onValueChange={index => mutateProperty("personalization", {
                  homeworkReminderDaysBefore: index as 0 | 1 | 2,
                })}
              />
            </View>
          </List.Trailing>
        </List.Item>
      </List.Section>

      <Typography variant="caption" color="textSecondary" style={{ paddingHorizontal: 4, paddingTop: 8 }}>
        {Platform.OS === "web"
          ? webNotificationsAvailable
            ? "Sur ordinateur, les rappels fonctionnent tant que Scola reste ouverte."
            : "Les notifications système ne sont pas disponibles dans ce navigateur."
          : "Sur mobile, les rappels programmés peuvent s’afficher même lorsque Scola est fermée."}
      </Typography>
    </List>
  );
}
