import React from "react";
import { ActivityIndicator, Modal, Platform, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "expo-router/react-navigation";

import { useAccountSwitchStore } from "@/stores/accountSwitch";

export default function AccountSwitchOverlay() {
  const accountId = useAccountSwitchStore(state => state.switchingAccountId);
  const stage = useAccountSwitchStore(state => state.stage);
  const step = useAccountSwitchStore(state => state.step);
  const progress = useAccountSwitchStore(state => state.progress);
  const blocking = useAccountSwitchStore(state => state.blocking);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const stageLabels = {
    timetable: "Emploi du temps",
    homework: "Tâches",
    grades: "Notes",
    extras: "Actualités et messagerie",
    magic: "Magic+",
  } as const;

  if (!accountId) return null;

  const status = stage
    ? `Étape ${step} sur 5 · ${stageLabels[stage]}`
    : "Connexion aux services…";
  const progressBar = (
    <View style={{ height: 3, overflow: "hidden", borderRadius: 3, backgroundColor: colors.border }}>
      <View style={{ width: `${Math.max(progress, 4)}%`, height: "100%", borderRadius: 3, backgroundColor: colors.primary }} />
    </View>
  );

  return (
    <>
      <Modal
        visible={blocking}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => {}}
      >
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.38)" }}>
          <View style={{ width: 280, gap: 14, paddingHorizontal: 22, paddingVertical: 20, borderRadius: 20, backgroundColor: colors.item }}>
            <View style={{ alignItems: "center", gap: 12 }}>
              <ActivityIndicator size="large" color={colors.primary} />
              <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>Préparation initiale du profil…</Text>
              <Text style={{ color: colors.text + "AA", fontSize: 13, textAlign: "center" }}>{status}</Text>
            </View>
            {progressBar}
          </View>
        </View>
      </Modal>

      {!blocking && (
        <View
          pointerEvents="box-none"
          style={{
            position: "absolute",
            top: Platform.OS === "web" ? 8 : insets.top + 6,
            left: 16,
            right: 16,
            zIndex: 10000,
            elevation: 20,
          }}
        >
          <View style={{ overflow: "hidden", borderRadius: 14, backgroundColor: colors.item, shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 10 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: colors.text, fontSize: 13, fontWeight: "600" }}>Mise à jour en arrière-plan</Text>
                <Text numberOfLines={1} style={{ color: colors.text + "AA", fontSize: 12 }}>{status}</Text>
              </View>
              <Text style={{ color: colors.primary, fontSize: 12, fontWeight: "600" }}>{Math.round(progress)} %</Text>
            </View>
            {progressBar}
          </View>
        </View>
      )}
    </>
  );
}
