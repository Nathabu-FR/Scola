import { Papicons } from "@getpapillon/papicons";
import { useTheme } from "expo-router/react-navigation";
import { router } from "expo-router";
import React from "react";
import { useTranslation } from "react-i18next";
import { Alert, Platform, View } from "react-native";

import { useAccountStore } from "@/stores/account";
import Icon from "@/ui/components/Icon";
import {
  NativeHeaderPressable,
  NativeHeaderSide,
} from "@/ui/components/NativeHeader";
import Stack from "@/ui/components/Stack";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { useSafeHorizontalPadding } from "@/ui/hooks/useSafeHorizontalPadding";
import { useTimetableWidgetData } from "@/app/(tabs)/index/hooks/useTimetableWidgetData";
import { cleanSubjectName, getSubjectFormat } from "@/utils/subjects/utils";
import { Colors } from "@/utils/subjects/colors";

export default function SubjectPersonalization() {
  const safePadding = useSafeHorizontalPadding(16);
  const { colors } = useTheme();

  const accounts = useAccountStore(state => state.accounts);
  const lastUsedAccount = useAccountStore(state => state.lastUsedAccount);
  const store = useAccountStore.getState();

  const account = accounts.find(a => a.id === lastUsedAccount);
  const savedSubjects = account?.customisation?.subjects ?? {};
  const { upcomingDays } = useTimetableWidgetData();
  const subjects = React.useMemo(() => {
    const byId = new Map<string, { id: string; name: string; emoji: string; color: string }>();

    for (const day of upcomingDays) {
      for (const course of day.courses) {
        const courseSubject = course.subject?.trim();
        if (!courseSubject) {
          continue;
        }

        const id = cleanSubjectName(courseSubject);
        if (!id || byId.has(id)) {
          continue;
        }

        const saved = savedSubjects[id];
        const format = getSubjectFormat(courseSubject);
        byId.set(id, {
          id,
          name: saved?.name || format?.pretty || courseSubject,
          emoji: saved?.emoji || format?.emoji || "🤓",
          color: saved?.color || Colors[byId.size % Colors.length],
        });
      }
    }

    // Keep saved entries visible even when the subject has no upcoming course.
    for (const [id, saved] of Object.entries(savedSubjects)) {
      if (byId.has(id) || !saved.name) {
        continue;
      }

      byId.set(id, {
        id,
        name: saved.name,
        emoji: saved.emoji || "🤓",
        color: saved.color || Colors[byId.size % Colors.length],
      });
    }

    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, "fr"));
  }, [upcomingDays, savedSubjects]);

  const resetAllSubjects = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      if (window.confirm(
        t("Settings_Subjects_Reset_Title") + " " + t("Settings_Subjects_Reset_Message")
      )) {
        useAccountStore.getState().setSubjects({});
      }
      return;
    }

    Alert.alert(
      t("Settings_Subjects_Reset_Title"),
      t("Settings_Subjects_Reset_Message"),
      [
        {
          text: t("CANCEL_BTN"),
          style: "cancel",
        },
        {
          text: t("Settings_Subjects_Reset_Button"),
          style: "destructive",
          onPress: () => {
            store.setSubjects({});
          },
        },
      ]
    );
  };

  function renderItem(emoji: string, name: string, id: string, color: string) {
    return (
      <List.Item key={id}
        onPress={() => {
          router.push({
            pathname: "/(settings)/edit_subject",
            params: {
              id,
              emoji,
              color,
              name,
            },
          });
        }}
      >
        <List.Leading>
          <Stack
            backgroundColor={color + "20"}
            style={{
              width: 40,
              height: 40,
              borderRadius: 40,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography
              style={{
                fontSize: 25,
                lineHeight: 32,
              }}
            >
              {emoji}
            </Typography>
          </Stack>
        </List.Leading>
        <Typography variant={"title"}>{name}</Typography>
        <List.Trailing>
          <Icon>
            <Papicons name="ChevronRight" opacity={0.7} />
          </Icon>
        </List.Trailing>
      </List.Item>
    );
  }

  const { t } = useTranslation();

  return (
    <>
      <NativeHeaderSide side="Right">
        <NativeHeaderPressable onPress={() => resetAllSubjects()}>
          <Icon>
            <Papicons name="Trash" />
          </Icon>
        </NativeHeaderPressable>
      </NativeHeaderSide>

      <List
        style={{ flex: 1, backgroundColor: colors.overground }}
        contentContainerStyle={{ padding: 16, ...safePadding }}
        contentInsetAdjustmentBehavior="automatic"
      >
        <List.Item
          onPress={() => {
            router.push({
              pathname: "/(settings)/edit_subject",
              params: { mode: "create" },
            });
          }}
        >
          <List.Leading>
            <Stack
              backgroundColor={colors.primary + "20"}
              style={{ width: 40, height: 40, borderRadius: 40, alignItems: "center", justifyContent: "center" }}
            >
              <Icon><Papicons name="Add" color={colors.primary} /></Icon>
            </Stack>
          </List.Leading>
          <Typography variant="title">Ajouter une matière</Typography>
          <List.Trailing><Icon><Papicons name="ChevronRight" opacity={0.7} /></Icon></List.Trailing>
        </List.Item>
        {subjects.length > 0 ? (
          subjects.map(item =>
            renderItem(item.emoji, item.name, item.id, item.color)
          )
        ) : (
          <List.View>
            <Stack hAlign="center" vAlign="center" margin={16} gap={16}>
              <View
                style={{
                  alignItems: "center",
                }}
              >
                <Icon
                  papicon
                  opacity={0.5}
                  size={32}
                  style={{ marginBottom: 3 }}
                >
                  <Papicons name={"Alert"} />
                </Icon>
                <Typography variant="h4" color="textPrimary" align="center">
                  {t("Settings_Subjects_None_Title")}
                </Typography>
                <Typography
                  variant="body2"
                  color="textSecondary"
                  align="center"
                >
                  {t("Settings_Subjects_None_Description")}
                </Typography>
              </View>
            </Stack>
          </List.View>
        )}
      </List>
    </>
  );
}
