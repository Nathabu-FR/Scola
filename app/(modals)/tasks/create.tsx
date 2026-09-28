import { Papicons } from "@getpapillon/papicons";
import { useTheme } from "expo-router/react-navigation";
import { router } from "expo-router";
import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { addCustomHomeworkToDatabase } from "@/database/useHomework";
import { useAccountStore } from "@/stores/account";
import { Colors } from "@/utils/subjects/colors";
import { cleanSubjectName, getSubjectFormat } from "@/utils/subjects/utils";
import AnimatedPressable from "@/ui/components/AnimatedPressable";
import Button from "@/ui/new/Button";
import Typography from "@/ui/new/Typography";

const localDateValue = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export default function CreatePersonalHomework() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const account = useAccountStore(state => state.accounts.find(item => item.id === state.lastUsedAccount));
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(() => localDateValue(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    const cleanSubject = subject.trim();
    if (!cleanSubject || !description.trim()) {
      setError("Renseigne une matière et une consigne.");
      return;
    }
    if (!cleanSubjectName(cleanSubject)) {
      setError("Le nom de la matière doit contenir une lettre ou un chiffre.");
      return;
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dueDate.trim());
    if (!match) {
      setError("La date doit être au format AAAA-MM-JJ.");
      return;
    }
    const [, year, month, day] = match;
    const date = new Date(Number(year), Number(month) - 1, Number(day), 17, 0, 0, 0);
    if (date.getFullYear() !== Number(year) || date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day)) {
      setError("Cette date n’existe pas.");
      return;
    }
    if (!account) {
      setError("Aucun compte n’est sélectionné.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const subjectId = cleanSubjectName(cleanSubject);
      const savedSubject = account.customisation?.subjects?.[subjectId];
      if (!savedSubject) {
        const format = getSubjectFormat(cleanSubject);
        const color = Colors[Object.keys(account.customisation?.subjects ?? {}).length % Colors.length];
        const store = useAccountStore.getState();
        store.setSubjectName(subjectId, cleanSubject);
        store.setSubjectEmoji(subjectId, format?.emoji ?? "🤓");
        store.setSubjectColor(subjectId, color);
      }

      await addCustomHomeworkToDatabase({
        id: `personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subject: cleanSubject,
        content: description.trim(),
        dueDate: date,
        isDone: false,
        attachments: [],
        evaluation: false,
        custom: true,
        createdByAccount: account.id,
        fromCache: true,
      });
      router.back();
    } catch {
      setError("Le devoir n’a pas pu être enregistré. Réessaie.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 14,
    color: colors.text,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
    fontSize: 16,
    width: "100%" as const,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ height: 54, flexDirection: "row", alignItems: "center", paddingHorizontal: 16, gap: 12 }}>
          <AnimatedPressable
            accessibilityRole="button"
            accessibilityLabel="Retour"
            onPress={() => router.back()}
            style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
          >
            <Papicons name="ArrowLeft" size={24} color="#8B5CF6" />
          </AnimatedPressable>
          <Typography variant="title" weight="semibold">Nouveau devoir</Typography>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: Math.max(24, insets.bottom + 16), gap: 10, width: "100%", maxWidth: 700, alignSelf: "center" }}>
          <Typography variant="body2" color="textSecondary">Les devoirs ajoutés ici restent sur cet appareil et portent le tag « Devoir perso ».</Typography>
          <Typography variant="title">Matière</Typography>
          <TextInput
            value={subject}
            onChangeText={setSubject}
            placeholder="Ex. Mathématiques"
            placeholderTextColor={colors.text + "80"}
            style={inputStyle}
            returnKeyType="next"
          />
          <Typography variant="title" style={{ marginTop: 8 }}>À faire pour le</Typography>
          <TextInput
            value={dueDate}
            onChangeText={setDueDate}
            placeholder="AAAA-MM-JJ"
            placeholderTextColor={colors.text + "80"}
            style={inputStyle}
            keyboardType={Platform.OS === "web" ? "default" : "numbers-and-punctuation"}
            autoCapitalize="none"
          />
          <Typography variant="title" style={{ marginTop: 8 }}>Consigne</Typography>
          <TextInput
            value={description}
            onChangeText={setDescription}
            placeholder="Décris le devoir…"
            placeholderTextColor={colors.text + "80"}
            style={[inputStyle, { minHeight: 130, textAlignVertical: "top" }]}
            multiline
          />
          {error ? <Typography variant="body2" color="#E5484D">{error}</Typography> : null}
          <Button label={saving ? "Enregistrement…" : "Ajouter le devoir"} onPress={save} disabled={saving} style={{ marginTop: 10 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
