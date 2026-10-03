import React from "react";
import { ActivityIndicator, Modal, Text, View } from "react-native";
import { useTheme } from "expo-router/react-navigation";

import { useAccountSwitchStore } from "@/stores/accountSwitch";

export default function AccountSwitchOverlay() {
  const switchingAccountId = useAccountSwitchStore(state => state.switchingAccountId);
  const { colors } = useTheme();

  return (
    <Modal
      visible={Boolean(switchingAccountId)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {}}
    >
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.38)" }}>
        <View style={{ minWidth: 210, alignItems: "center", gap: 12, paddingHorizontal: 24, paddingVertical: 20, borderRadius: 20, backgroundColor: colors.item }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>Chargement du profil…</Text>
        </View>
      </View>
    </Modal>
  );
}
