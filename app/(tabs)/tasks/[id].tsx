import { Papicons } from "@getpapillon/papicons";
import { useTheme } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { t } from "i18next";
import React, { useEffect, useState } from "react";

import ModalOverhead from "@/components/ModalOverhead";
import { deleteCustomHomeworkFromDatabase, getHomeworkById, updateHomeworkIsDone } from "@/database/useHomework";
import { useAccountStore } from "@/stores/account";
import { getManager } from "@/services/shared";
import AnimatedPressable from "@/ui/components/AnimatedPressable";
import Icon from "@/ui/components/Icon";
import Stack from "@/ui/components/Stack";
import { NativeHeaderPressable, NativeHeaderSide } from "@/ui/components/NativeHeader";
import { formatHTML } from "@/utils/format/html";
import { getAttachmentIcon } from "@/utils/news/getAttachmentIcon";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectEmoji } from "@/utils/subjects/emoji";
import { getSubjectName } from "@/utils/subjects/name";
import { Alert, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { Homework } from "@/services/shared/homework";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import { useSafeHorizontalPadding } from "@/ui/hooks/useSafeHorizontalPadding";
import { View } from "react-native";

const Task = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useTheme();
  const colors = theme.colors;
  const activeAccountId = useAccountStore(state => state.lastUsedAccount);
  const backHeader = (Platform.OS === "android" || Platform.OS === "web") ? (
    <NativeHeaderSide side="Left">
      <NativeHeaderPressable onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
        <Icon size={28}><Papicons name="ArrowLeft" color="#8B5CF6" /></Icon>
      </NativeHeaderPressable>
    </NativeHeaderSide>
  ) : null;
  const [task, setTask] = useState<Homework>();
  const [loading, setLoading] = useState(true);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getHomeworkById(id)
      .then(result => {
        if (!cancelled) {
          setTask(result);
          setIsDone(result?.isDone ?? false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const formatedTask = formatHTML(task?.content ?? "")

  const subjectInfo = {
    color: getSubjectColor(task?.subject ?? ""),
    emoji: getSubjectEmoji(task?.subject ?? ""),
    name: getSubjectName(task?.subject ?? "")
  }

  const setAsDone = async (done: boolean) => {
    if (!task) return;
    // Optimiste : la case se coche immédiatement. L'ancien code attendait le
    // retour réseau (setHomeworkCompletion) avant setIsDone, donc un service
    // en lecture seule / hors-ligne donnait l'impression que « cocher ne
    // fonctionne pas ». Le cache local fait foi, la synchro distante suit.
    setIsDone(done);
    try {
      await updateHomeworkIsDone(id, done);
    } catch (error) {
      // Rollback visuel : le cache n'a pas pu suivre, on restaure l'état.
      setIsDone(!done);
      if (Platform.OS === "web") window.alert(`Ce devoir n’a pas pu être mis à jour.\n\n${String(error)}`);
      else Alert.alert("Mise à jour impossible", "Ce devoir n’a pas pu être mis à jour.");
      return;
    }
    if (!task.custom) {
      try {
        await getManager()?.setHomeworkCompletion(task, done);
      } catch {
        // Completion stays saved locally when the school service is read-only.
      }
    }
  }

  const deletePersonalTask = () => {
    const remove = async () => {
      if (!task || !activeAccountId) return;
      try {
        // Les devoirs persos sont toujours supprimables : on cherche le record
        // avec l'id de route réel (getHomeworkRouteId pour custom = id), et on
        // retombe sur l'id d'URL si la route a été construite autrement.
        const { getHomeworkRouteId } = await import("@/database/useHomework");
        const routeId = getHomeworkRouteId(task);
        const candidates = [routeId, id];
        let lastError: unknown = null;
        for (const candidate of candidates) {
          try {
            await deleteCustomHomeworkFromDatabase(candidate, activeAccountId);
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
          }
        }
        if (lastError) throw lastError;
        if (router.canGoBack()) router.back();
        else router.replace("/(tabs)/tasks");
      } catch (error) {
        if (Platform.OS === "web") window.alert(String(error));
        else Alert.alert("Suppression impossible", String(error));
      }
    };

    if (Platform.OS === "web") {
      if (window.confirm("Supprimer définitivement ce devoir personnel ?")) void remove();
      return;
    }
    Alert.alert("Supprimer ce devoir ?", "Ce devoir personnel sera supprimé de ce compte.", [
      { text: "Annuler", style: "cancel" },
      { text: "Supprimer", style: "destructive", onPress: () => void remove() },
    ]);
  };

  const insets = useSafeAreaInsets();
  const { paddingLeft: contentPaddingLeft, paddingRight: contentPaddingRight } = useSafeHorizontalPadding(16);
  const finalHeaderHeight = Platform.select({
    android: insets.top + 32,
    default: 0
  });

  if (loading) {
    return <>{backHeader}<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View></>;
  }

  if (!task) {
    return <>{backHeader}<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Typography variant="title">{t("Tab_Tasks")}</Typography></View></>;
  }

  return (
    <>
      {backHeader}

      {Platform.OS !== "android" && (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: theme.colors.overground, zIndex: -10 }}>
        <LinearGradient
          colors={[subjectInfo.color, theme.colors.overground]}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 300,
            width: "100%",
            zIndex: -9,
            opacity: 0.4,
          }}
        />
        </View>
      )}

      <List
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <ModalOverhead
            emoji={subjectInfo.emoji}
            subject={subjectInfo.name}
            overtitle={task.custom ? "Devoir perso" : undefined}
            subjectVariant="header"
            color={Platform.OS === "ios" ? subjectInfo.color : colors.primary}
            date={new Date(task.dueDate)}
            style={{
              marginVertical: 0,
              paddingTop: finalHeaderHeight,
            }}
          />
        }
        style={{
          backgroundColor: "transparent",
        }}
        contentContainerStyle={{
          padding: 16,
          paddingLeft: contentPaddingLeft,
          paddingRight: contentPaddingRight,
        }}
      >
        <List.Section>
          <List.SectionTitle>
            <List.Label>{t("Modal_Task_Status")}</List.Label>
          </List.SectionTitle>

          <List.Item>
            <List.Leading>
              <AnimatedPressable onPress={() => setAsDone(!isDone)}>
                <Stack
                  backgroundColor={
                    isDone
                      ? Platform.OS === "ios"
                        ? subjectInfo.color
                        : theme.colors.primary
                      : theme.colors.card
                  }
                  card
                  radius={100}
                  width={28}
                  height={28}
                  vAlign="center"
                  hAlign="center"
                >
                  {isDone && <Papicons name="check" size={22} color="white" />}
                </Stack>
              </AnimatedPressable>
            </List.Leading>
            <Typography variant="title">
              {isDone ? t("Task_Done") : t("Task_Undone")}
            </Typography>
          </List.Item>
        </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>{t("Modal_Task_Description")}</List.Label>
          </List.SectionTitle>

          <List.Item>
            <Typography>{formatedTask}</Typography>
          </List.Item>
        </List.Section>
        {task.attachments.length > 0 && (
          <List.Section>
            <List.SectionTitle>
              <List.Label>{t("Modal_Task_Attachments")}</List.Label>
            </List.SectionTitle>

            {task.attachments.map(attachment => (
              <List.Item
                onPress={() =>
                  WebBrowser.openBrowserAsync(attachment.url, {
                    presentationStyle: "formSheet",
                  })
                }
              >
                <List.Leading>
                  <Icon>
                    <Papicons name={getAttachmentIcon(attachment)} />
                  </Icon>
                </List.Leading>
                <Typography variant="title" numberOfLines={1}>
                  {attachment.name || attachment.url}
                </Typography>
                <Typography
                  variant="body1"
                  color="textSecondary"
                  numberOfLines={1}
                >
                  {attachment.url}
                </Typography>
              </List.Item>
            ))}
          </List.Section>
        )}
        {task.custom && (
          <List.Section>
            <List.Item onPress={deletePersonalTask}>
              <List.Leading><Icon><Papicons name="Trash" color="#E5484D" /></Icon></List.Leading>
              <Typography variant="title" style={{ color: "#E5484D" }}>Supprimer ce devoir perso</Typography>
            </List.Item>
          </List.Section>
        )}
      </List>
    </>
  );
};
export default Task;
