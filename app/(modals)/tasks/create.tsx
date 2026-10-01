import { Papicons } from "@getpapillon/papicons";
import { useTheme } from "expo-router/react-navigation";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

import { addCustomHomeworkToDatabase, useAllHomeworkFromCache } from "@/database/useHomework";
import { useTimetableWidgetData } from "@/app/(tabs)/index/hooks/useTimetableWidgetData";
import { useAccountStore } from "@/stores/account";
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
  const { upcomingDays } = useTimetableWidgetData({ showCancelled: true });
  const allCachedHomeworks = useAllHomeworkFromCache();
  const [subject, setSubject] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState(() => localDateValue(new Date()));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const availableSubjects = useMemo(() => {
    // Les iCal ne créent pas de matières : on ne propose que les matières de
    // l'emploi du temps du compte (cours non-iCal), + les matières déjà
    // utilisées par des devoirs en cache (sinon impossible d'ajouter un
    // « maths » avec une casse différente, cf. capture « Devoir perso / maths »).
    const services = new Set(account?.services?.map(service => service.id) ?? []);
    const fromTimetable = upcomingDays.flatMap(day => day.courses)
      .filter(course => services.has(course.createdByAccount) && !course.createdByAccount.startsWith("ical_"))
      .map(course => course.subject.trim())
      .filter(Boolean);
    const fromCache = allCachedHomeworks
      .filter(hw => hw.createdByAccount === account?.id || services.has(hw.createdByAccount))
      .map(hw => hw.subject.trim())
      .filter(Boolean);
    const names = [...fromTimetable, ...fromCache];
    return Array.from(new Map(names.map(name => [name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(), name])).values());
  }, [account?.services, account?.id, allCachedHomeworks, upcomingDays]);

  // Les devoirs persos sont toujours supprimables ; le bouton retour existe
  // sur toutes les plateformes (la capture « fonds d'écran » montrait une
  // modale sans retour sur desktop/web).
  const save = async () => {
    const cleanSubject = subject.trim();
    // Le devoir doit utiliser une matière affichée pour ce compte. Les cours
    // iCal sont exclus de availableSubjects et ne peuvent donc pas en ajouter.
    const normalized = (value: string) =>
      value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    const matched = availableSubjects.find(name => normalized(name) === normalized(cleanSubject));
    if (!matched || !description.trim()) {
      setError(!matched ? "Choisis une matière dans la liste." : "Renseigne une consigne.");
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
      await addCustomHomeworkToDatabase({
        id: `personal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subject: matched,
        content: description.trim(),
        dueDate: date,
        isDone: false,
        attachments: [],
        evaluation: false,
        custom: true,
        createdByAccount: account.id,
        fromCache: true,
      });
      if (router.canGoBack()) router.back();
      else router.replace("/(tabs)/tasks");
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
            onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)/tasks")}
            style={{ width: 40, height: 40, alignItems: "center", justifyContent: "center" }}
          >
            <Papicons name="ArrowLeft" size={24} color="#8B5CF6" />
          </AnimatedPressable>
          <Typography variant="title" weight="semibold">Nouveau devoir</Typography>
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, paddingBottom: Math.max(24, insets.bottom + 16), gap: 10, width: "100%", maxWidth: 700, alignSelf: "center" }}>
          <Typography variant="body2" color="textSecondary">Les devoirs ajoutés ici restent sur cet appareil et portent le tag « Devoir perso ».</Typography>
          <Typography variant="title">Matière</Typography>
          {availableSubjects.length > 0 ? (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {availableSubjects.map(name => {
                const selected = subject === name;
                return (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    onPress={() => { setSubject(name); setError(""); }}
                    style={{ borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.card, paddingHorizontal: 14, paddingVertical: 9 }}
                  >
                    <Typography variant="body2" weight="semibold" selectable={false} style={{ color: selected ? colors.background : colors.text }}>{name}</Typography>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <Typography variant="body2" color="textSecondary">Aucune matière n’est disponible dans l’emploi du temps de ce compte.</Typography>
          )}
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
          <Button label={saving ? "Enregistrement…" : "Ajouter le devoir"} onPress={save} disabled={saving || availableSubjects.length === 0} style={{ marginTop: 10 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
