import { Papicons } from '@getpapillon/papicons';
import { useTheme } from "expo-router/react-navigation";
import { useLocalSearchParams, useRouter } from "expo-router";
import { formatDistanceStrict, formatDistanceToNow } from 'date-fns'
import * as DateLocale from 'date-fns/locale';
import i18n, { t } from "i18next";
import React, { useEffect, useState } from "react";
import { Alert, Platform, Pressable, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";

import ModalOverhead from "@/components/ModalOverhead";
import { getCourseById, getCourseRouteId, updateCourseCustomStatus } from "@/database/useTimetable";
import { getManager, initializeAccountManager } from "@/services/shared";
import { Attachment } from "@/services/shared/attachment";
import { COURSE_CANCELLED_LABEL, COURSE_TEACHER_ABSENT_LABEL, Course as SharedCourse, CourseResource } from "@/services/shared/timetable";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import Icon from "@/ui/components/Icon";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { NativeHeaderPressable, NativeHeaderSide } from "@/ui/components/NativeHeader";
import { getSubjectName } from '@/utils/subjects/name';
import { getSubjectColor } from '@/utils/subjects/colors';
import { getSubjectEmoji } from '@/utils/subjects/emoji';
import { useSafeHorizontalPadding } from "@/ui/hooks/useSafeHorizontalPadding";

import { getStatusText } from "../../(tabs)/calendar/components/CalendarDay";
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getAttachmentIcon } from "@/utils/news/getAttachmentIcon";

interface SubjectInfo {
  name: string;
  originalName: string;
  emoji: string;
  color: string;
}

export default function CourseModal() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { paddingLeft: contentPaddingLeft, paddingRight: contentPaddingRight } = useSafeHorizontalPadding(16);
  const finalHeaderHeight = Platform.select({
    android: insets.top + 32,
    default: 0
  });
  const [course, setCourse] = useState<SharedCourse>();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"details" | "content">("details");
  const [sessionContents, setSessionContents] = useState<CourseResource[]>([]);
  const [loadingContents, setLoadingContents] = useState(false);
  const [contentsError, setContentsError] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const backHeader = (Platform.OS === "android" || Platform.OS === "web") ? (
    <NativeHeaderSide side="Left">
      <NativeHeaderPressable onPress={() => router.canGoBack() ? router.back() : router.replace("/")}>
        <Icon size={28}><Papicons name="ArrowLeft" color={colors.primary} /></Icon>
      </NativeHeaderPressable>
    </NativeHeaderSide>
  ) : null;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getCourseById(id)
      .then(result => {
        if (cancelled || !result) return;
        // Restaure le statut manuel posé sur un cours iCal (localStorage web).
        if (result.createdByAccount.startsWith("ical_") && Platform.OS === "web" && typeof window !== "undefined") {
          try {
            const saved = window.localStorage.getItem(`ical-course-status:${result.id}`);
            if (saved !== null) {
              result.customStatus = saved || undefined;
            }
          } catch { /* stockage indisponible : on garde le statut réseau */ }
        }
        if (!cancelled) setCourse(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!course?.resourceId) {
      setSessionContents([]);
      setLoadingContents(false);
      setContentsError(false);
      return;
    }

    let cancelled = false;
    setLoadingContents(true);
    setContentsError(false);

    void (async () => {
      try {
        const manager = getManager(true) ?? await initializeAccountManager();
        const contents = await manager.getCourseResources(course);
        if (!cancelled) setSessionContents(contents);
      } catch {
        if (!cancelled) {
          setSessionContents([]);
          setContentsError(true);
        }
      } finally {
        if (!cancelled) setLoadingContents(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [course]);

  if (loading) {
    return <>{backHeader}<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View></>;
  }

  if (!course) {
    return <>{backHeader}<View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Typography variant="title">{t("Tab_Calendar")}</Typography></View></>;
  }

  const subjectInfo: SubjectInfo = {
    name: getSubjectName(course.subject),
    originalName: course.subject,
    emoji: getSubjectEmoji(course.subject),
    color: getSubjectColor(course.subject),
  };
  const item = course;
  const startTime = Math.floor(course.from.getTime() / 1000);
  const endTime = Math.floor(course.to.getTime() / 1000);
  const openAttachment = (attachment: Attachment) => {
    if (!attachment.url) return;
    void WebBrowser.openBrowserAsync(attachment.url, {
      presentationStyle: "formSheet",
    });
  };
  const setManualCourseStatus = async (customStatus?: string) => {
    // Les cours iCal n'ont pas de record modifiable : on persiste le statut
    // en paramètre local plutôt que de quitter silencieusement (le `return`
    // précédent donnait l'impression que les boutons « annulé / prof absent »
    // ne fonctionnaient pas sur les cours iCal).
    if (!course) return;
    setUpdatingStatus(true);
    try {
      if (course.createdByAccount.startsWith("ical_")) {
        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.localStorage.setItem(`ical-course-status:${course.id}`, customStatus ?? "");
        }
        setCourse({ ...course, customStatus });
        return;
      }
      await updateCourseCustomStatus(getCourseRouteId(course), customStatus);
      setCourse({ ...course, customStatus });
    } catch (error) {
      if (Platform.OS === "web") window.alert(String(error));
      else Alert.alert("Mise à jour impossible", String(error));
    } finally {
      setUpdatingStatus(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.overground }}>
      {backHeader}

      {Platform.OS !== "android" && (
        <LinearGradient
          colors={[subjectInfo.color, `${subjectInfo.color}00`]}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 500,
            width: "100%",
            zIndex: 0,
            opacity: 0.6,
          }}
        />
      )}

      <List
        contentInsetAdjustmentBehavior="automatic"
        ListHeaderComponent={
          <ModalOverhead
            subject={getSubjectName(item.subject)}
            title={item.customStatus || getStatusText(item.status)}
            color={Platform.OS === "ios" ? subjectInfo.color : colors.primary}
            emoji={subjectInfo.emoji}
            subjectVariant="h3"
            date={new Date(startTime * 1000)}
            dateFormat={{
              day: "numeric",
              month: "long",
              year: "numeric",
              hour: "numeric",
              minute: "numeric",
            }}
            style={{
              marginBottom: 24,
              paddingTop: finalHeaderHeight,
            }}
          />
        }
        style={{ backgroundColor: "transparent", zIndex: 2 }}
        contentContainerStyle={{ padding: 16, paddingLeft: contentPaddingLeft, paddingRight: contentPaddingRight }}
      >
        <View
          accessibilityRole="tablist"
          style={{
            flexDirection: "row",
            gap: 6,
            padding: 4,
            marginBottom: 16,
            borderRadius: 16,
            backgroundColor: colors.card,
          }}
        >
          {([
            ["details", "Cours"],
            ["content", "Contenu de séance"],
          ] as const).map(([tab, label]) => {
            const selected = activeTab === tab;
            return (
              <Pressable
                key={tab}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setActiveTab(tab)}
                style={{
                  flex: 1,
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: 40,
                  paddingHorizontal: 10,
                  borderRadius: 12,
                  backgroundColor: selected ? colors.primary : "transparent",
                }}
              >
                <Typography
                  variant="body1"
                  weight="semibold"
                  align="center"
                  style={{ color: selected ? colors.background : colors.text }}
                >
                  {label}
                </Typography>
              </Pressable>
            );
          })}
        </View>

        {activeTab === "details" ? <>
        {getStatusText(course.status) ? (
          <List.Section>
            <List.Item>
              <List.Leading>
                <Icon>
                  <Papicons name="Info" />
                </Icon>
              </List.Leading>
              <Typography variant="title">
                {getStatusText(course.status)}
              </Typography>
            </List.Item>
          </List.Section>
        ) : null}

        <List.Section>
            <List.SectionTitle><List.Label>Signaler un changement</List.Label></List.SectionTitle>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
              {[
                { label: COURSE_CANCELLED_LABEL, value: COURSE_CANCELLED_LABEL },
                { label: COURSE_TEACHER_ABSENT_LABEL, value: COURSE_TEACHER_ABSENT_LABEL },
                { label: "Effacer", value: undefined },
              ].map(option => {
                const selected = course.customStatus === option.value;
                return (
                  <Pressable
                    key={option.label}
                    accessibilityRole="button"
                    accessibilityState={{ selected, disabled: updatingStatus }}
                    disabled={updatingStatus}
                    onPress={() => void setManualCourseStatus(option.value)}
                    style={{ borderRadius: 999, borderWidth: 1, borderColor: selected ? colors.primary : colors.border, backgroundColor: selected ? colors.primary : colors.card, paddingHorizontal: 12, paddingVertical: 8, opacity: updatingStatus ? 0.6 : 1 }}
                  >
                    <Typography variant="body2" weight="semibold" selectable={false} style={{ color: selected ? colors.background : colors.text }}>{option.label}</Typography>
                  </Pressable>
                );
              })}
            </View>
            {course.createdByAccount.startsWith("ical_") ? (
              <Typography variant="caption" color="textSecondary" style={{ paddingHorizontal: 12, paddingBottom: 12 }}>
                Cours importé d’un agenda externe : ce statut reste local à cet appareil.
              </Typography>
            ) : null}
          </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>{t("Modal_Course_Time")}</List.Label>
          </List.SectionTitle>

          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="Logout" />
              </Icon>
            </List.Leading>
            <Typography variant="title">{t("Modal_Course_Start")}</Typography>
            <Typography variant="body1" color="textSecondary">
              {formatDistanceToNow(startTime * 1000, {
                locale:
                  DateLocale[i18n.language as keyof typeof DateLocale] ||
                  DateLocale.enUS,
                addSuffix: true,
              })}
            </Typography>
            <List.Trailing>
              <Typography variant="title">
                {new Date(startTime * 1000).toLocaleString(undefined, {
                  hour: "numeric",
                  minute: "numeric",
                })}
              </Typography>
            </List.Trailing>
          </List.Item>

          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="Login" />
              </Icon>
            </List.Leading>
            <Typography variant="title">{t("Modal_Course_End")}</Typography>
            <List.Trailing>
              <Typography variant="title">
                {new Date(endTime * 1000).toLocaleString(undefined, {
                  hour: "numeric",
                  minute: "numeric",
                })}
              </Typography>
            </List.Trailing>
          </List.Item>
        </List.Section>

        <List.Section>
          <List.SectionTitle>
            <List.Label>{t("Modal_Course_Details")}</List.Label>
          </List.SectionTitle>

          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="User" />
              </Icon>
            </List.Leading>
            <Typography variant="title">{t("Modal_Course_Teacher")}</Typography>
            <Typography variant="body1" color="textSecondary">
              {item.teacher}
            </Typography>
          </List.Item>

          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="MapPin" />
              </Icon>
            </List.Leading>
            <Typography variant="title">{t("Modal_Course_Room")}</Typography>
            <Typography variant="body1" color="textSecondary">
              {item.room || t("No_Course_Room")}
            </Typography>
          </List.Item>

          <List.Item>
            <List.Leading>
              <Icon>
                <Papicons name="Clock" />
              </Icon>
            </List.Leading>
            <Typography variant="title">
              {t("Modal_Course_Duration")}
            </Typography>
            <Typography variant="body1" color="textSecondary">
              {formatDistanceStrict(startTime * 1000, endTime * 1000, {
                locale:
                  DateLocale[i18n.language as keyof typeof DateLocale] ||
                  DateLocale.enUS,
              })}
            </Typography>
          </List.Item>
        </List.Section>
        </> : (
          <List.Section>
            <List.SectionTitle>
              <List.Label>Contenu de séance</List.Label>
            </List.SectionTitle>

            {loadingContents ? (
              <List.Item>
                <List.Leading><ActivityIndicator /></List.Leading>
                <Typography variant="title">Chargement du contenu…</Typography>
              </List.Item>
            ) : contentsError ? (
              <List.Item>
                <Typography variant="body1" color="textSecondary">
                  Le contenu de cette séance n’a pas pu être récupéré. Réessaie lorsque la connexion Pronote sera disponible.
                </Typography>
              </List.Item>
            ) : sessionContents.length === 0 ? (
              <List.Item>
                <Typography variant="body1" color="textSecondary">
                  Aucun contenu de séance n’est disponible pour ce cours.
                </Typography>
              </List.Item>
            ) : sessionContents.map((resource, index) => {
              const description = (resource.description ?? "")
                .replace(/<br\s*\/?\s*>/gi, "\n")
                .replace(/<[^>]+>/g, " ")
                .replace(/&nbsp;/g, " ")
                .trim();

              return (
                <View key={`${resource.title ?? resource.category}-${index}`} style={{ gap: 4, marginBottom: 12 }}>
                  <Typography variant="title">
                    {resource.title || `Séance ${index + 1}`}
                  </Typography>
                  {description ? (
                    <Typography variant="body1" color="textSecondary">
                      {description}
                    </Typography>
                  ) : null}
                  {resource.attachments.map((attachment, attachmentIndex) => (
                    <List.Item
                      key={`${attachment.url}-${attachmentIndex}`}
                      onPress={() => openAttachment(attachment)}
                    >
                      <List.Leading>
                        <Icon><Papicons name={getAttachmentIcon(attachment)} /></Icon>
                      </List.Leading>
                      <Typography variant="title" numberOfLines={1}>
                        {attachment.name || attachment.url}
                      </Typography>
                      <Typography variant="body1" color="textSecondary" numberOfLines={1}>
                        {attachment.url}
                      </Typography>
                    </List.Item>
                  ))}
                </View>
              );
            })}
          </List.Section>
        )}
      </List>
    </View>
  );
}
