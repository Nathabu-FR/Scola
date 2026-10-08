import { getManager, initializeAccountManager } from "@/services/shared";
import { News } from "@/services/shared/news";
import { getNewsById } from "@/database/useNews";
import { useAccountStore } from "@/stores/account";
import { Services } from "@/stores/account/types";
import Stack from "@/ui/components/Stack";
import TypographyLegacy, { VARIANTS } from "@/ui/components/Typography";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Attachment, News as SkolengoNews } from "skolengojs";
import { NewsQuestionKind } from "@blockshub/pawnote-lts";
import { CheckSquare, Circle, CircleCheck, Square } from "lucide-react-native";

import HTMLView from "react-native-htmlview";
import { HeaderBackButton, useTheme } from "expo-router/react-navigation";
import { NativeHeaderSide } from "@/ui/components/NativeHeader";
import Icon from "@/ui/components/Icon";
import { t } from "i18next";
import ListLegacy from "@/ui/components/List";
import Item, { Leading } from "@/ui/components/Item";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { cleanHtmlForArticle } from "@/utils/news/cleanUpHTMLNews";
import Avatar from "@/ui/components/Avatar";
import { getInitials } from "@/utils/chats/initials";
import { runsIOS26 } from "@/ui/utils/IsLiquidGlass";
import { Papicons } from "@getpapillon/papicons";
import { getAttachmentIcon } from "@/utils/news/getAttachmentIcon";
import List from "@/ui/new/List";
import Typography from "@/ui/new/Typography";
import { useFont } from "@/utils/theme/fonts";
import ActivityIndicator from "@/ui/components/ActivityIndicator";
import { useSafeHorizontalPadding } from "@/ui/hooks/useSafeHorizontalPadding";
import { warn } from "@/utils/logger/logger";
import { NewsSurveyAnswers } from "@/services/shared/news";
import { openAttachment as openDocumentAttachment } from "@/utils/attachments/openAttachment";

const NewsPage = () => {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [news, setNews] = useState<News>();
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const safePadding = useSafeHorizontalPadding(20);
  const router = useRouter()
  const { colors } = useTheme();
  const font = useFont();
  const [HTMLCleanupEnabled, setHTMLCleanupEnabled] = useState(true)
  const [surveyAnswers, setSurveyAnswers] = useState<NewsSurveyAnswers>({});
  const [surveySubmitting, setSurveySubmitting] = useState(false);
  const [surveySubmitted, setSurveySubmitted] = useState(false);
  const [surveyError, setSurveyError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getNewsById(id)
      .then(result => {
        if (!cancelled) setNews(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!news) return;
    const acknowledgeNews = async () => {
      if (!news.acknowledged) {
        const manager = getManager();

        const store = useAccountStore.getState()
        const account = store.accounts.find(account => account.id === store.lastUsedAccount)
        const service = account?.services.find(service => service.id === news.createdByAccount)

        if (service?.serviceId === Services.SKOLENGO) {
          const attachment = new Attachment("", "", "")

          news.ref = new SkolengoNews(
            news.id,
            news.createdAt,
            news.title ?? "",
            news.content,
            news.content,
            {
              id: "",
              name: "",
            },
            "",
            attachment
          );
        }

        try {
          await manager?.setNewsAsDone(news);
        } catch (error) {
          warn(`Unable to mark news ${news.id} as read: ${String(error)}`);
        }
      }
    };

    acknowledgeNews();
  }, [news])

  const stylesheet = StyleSheet.create({
    ...VARIANTS,
    p: {
      ...VARIANTS.body1,
      fontFamily: font("medium"),
      color: colors.text,
      flexShrink: 1,
    },
    div: {
      ...VARIANTS.body1,
      fontFamily: font("medium"),
      color: colors.text,
      flexShrink: 1,
    },
    a: {
      color: colors.primary,
      textDecorationLine: 'underline',
    },
    ul: {
      ...VARIANTS.body1,
      fontFamily: font("medium"),
      paddingHorizontal: 4,
      color: colors.text,
    },
  });

  if (loading) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator /></View>;
  }

  if (!news) {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><Typography variant="title">{t("News_Empty_Title")}</Typography></View>;
  }

  const cleanedContent = HTMLCleanupEnabled ? cleanHtmlForArticle(news.content) : news.content
  const surveyQuestions = news.survey?.questions ?? [];

  const getQuestionAnswer = (question: (typeof surveyQuestions)[number]) =>
    surveyAnswers[question.id] ?? {
      selectedAnswers: question.selectedAnswers ?? [],
      textInputAnswer: question.textInputAnswer ?? "",
    };

  const toggleSurveyChoice = (question: (typeof surveyQuestions)[number], position: number) => {
    const current = getQuestionAnswer(question);
    const selected = current.selectedAnswers ?? [];
    let next: number[];
    if (question.kind === NewsQuestionKind.UniqueChoice) {
      next = selected.includes(position) ? [] : [position];
    } else if (selected.includes(position)) {
      next = selected.filter(value => value !== position);
    } else {
      next = [...selected, position];
      if (question.shouldRespectMaximumChoices && question.maximumChoices > 0) {
        next = next.slice(-question.maximumChoices);
      }
    }
    setSurveyAnswers(previous => ({
      ...previous,
      [question.id]: { ...current, selectedAnswers: next },
    }));
    setSurveyError("");
  };

  const canSubmitSurvey = surveyQuestions
    .filter(question => question.shouldAnswer && !question.answered)
    .every(question => {
      const answer = getQuestionAnswer(question);
      if (question.kind === NewsQuestionKind.TextInput) {
        return Boolean(answer.textInputAnswer?.trim());
      }
      if ((answer.selectedAnswers?.length ?? 0) === 0) return false;
      const selectedTextInput = question.choices.some(choice =>
        choice.isTextInput && answer.selectedAnswers?.includes(choice.position)
      );
      return !selectedTextInput || Boolean(answer.textInputAnswer?.trim());
    });

  const submitSurvey = async () => {
    if (!news || !canSubmitSurvey || surveySubmitting) return;
    setSurveySubmitting(true);
    setSurveyError("");
    try {
      const manager = getManager(true) ?? await initializeAccountManager();
      const answers = Object.fromEntries(
        surveyQuestions
          .filter(question => question.shouldAnswer && !question.answered)
          .map(question => [question.id, getQuestionAnswer(question)])
      );
      await manager.answerNewsSurvey(news, answers);
      setSurveySubmitted(true);
    } catch (error) {
      setSurveyError(`La réponse n’a pas pu être envoyée. ${String(error)}`);
    } finally {
      setSurveySubmitting(false);
    }
  };

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1 }}
      contentContainerStyle={{
        ...safePadding,
        paddingTop: 20,
        paddingBottom: 20 + insets.bottom,
        gap: 24
      }}
    >
      <NativeHeaderSide side="Left">
        <HeaderBackButton
          tintColor={runsIOS26 ? colors.text : colors.primary}
          onPress={() => router.back()}

          style={{
            marginLeft: Platform.OS === 'ios' ? (runsIOS26 ? 3 : -32) : 0,
          }}
        />
      </NativeHeaderSide>

      <Stack gap={10}>
        <Stack padding={[10, 4]} radius={200} backgroundColor={colors.text + "16"}>
          <TypographyLegacy variant="body2">
            {news.category}
          </TypographyLegacy>
        </Stack>

        <TypographyLegacy variant="h3">
          {news.title}
        </TypographyLegacy>

        <Stack direction="horizontal" hAlign="center">
          <Stack direction="horizontal" gap={8} inline flex hAlign="center" style={{ flexWrap: "wrap", minWidth: 0 }}>
            <Avatar initials={getInitials(news.author)} size={28} />
            <TypographyLegacy variant="body2" style={{ flexShrink: 1 }}>
              {news.author}
            </TypographyLegacy>
          </Stack>

          <TypographyLegacy variant="body2" color="secondary" style={{ flexShrink: 1 }}>
            {new Date(news.createdAt).toLocaleDateString(undefined, {
              day: '2-digit',
              month: 'short',
              year: 'numeric'
            })}
          </TypographyLegacy>
        </Stack>
      </Stack>

      {news.question && surveyQuestions.length === 0 ? (
        <List scrollEnabled={false}>
          <List.Item>
            <List.Leading>
              <Icon><Papicons name="pie" /></Icon>
            </List.Leading>
            <Typography variant="title">Cette actualité contient un formulaire</Typography>
            <Typography variant="body1" color="textSecondary">
              Le formulaire n’a pas pu être récupéré pour le moment. Actualise les actualités lorsque la connexion Pronote sera disponible.
            </Typography>
          </List.Item>
        </List>
      ) : null}

      {surveyQuestions.length > 0 ? (
        <View style={{ gap: 12, width: "100%", minWidth: 0 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Icon><Papicons name="pie" /></Icon>
            <Typography variant="title" style={{ flex: 1, minWidth: 0 }}>
              {news.survey?.isAnonymous ? "Sondage anonyme" : "Sondage nominatif"}
            </Typography>
          </View>

          {surveyQuestions.map(question => {
            const answer = getQuestionAnswer(question);
            const answered = question.answered || surveySubmitted;
            const isMultiple = question.kind === NewsQuestionKind.MultipleChoice;
            const hasTextAnswer = question.kind === NewsQuestionKind.TextInput ||
              question.choices.some(choice => choice.isTextInput && answer.selectedAnswers?.includes(choice.position));

            return (
              <View
                key={question.id}
                style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card }}
              >
                <Typography variant="title" style={{ flexShrink: 1 }}>
                  {question.title || question.fullTitle || "Question"}
                </Typography>
                {question.content ? (
                  <HTMLView
                    value={HTMLCleanupEnabled ? cleanHtmlForArticle(question.content) : question.content}
                    stylesheet={stylesheet}
                    style={{ maxWidth: "100%" }}
                    paragraphBreak="\n"
                  />
                ) : null}

                {question.choices.filter(choice => !choice.isTextInput || question.kind !== NewsQuestionKind.TextInput).map(choice => {
                  const selected = answer.selectedAnswers?.includes(choice.position) ?? false;
                  return (
                    <Pressable
                      key={`${question.id}-${choice.position}`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected, disabled: answered || surveySubmitting }}
                      disabled={answered || surveySubmitting}
                      onPress={() => toggleSurveyChoice(question, choice.position)}
                      style={{ flexDirection: "row", alignItems: "flex-start", gap: 10, minHeight: 40, paddingVertical: 8 }}
                    >
                      {isMultiple
                        ? selected ? <CheckSquare size={20} color={colors.primary} /> : <Square size={20} color={colors.text + "88"} />
                        : selected ? <CircleCheck size={20} color={colors.primary} /> : <Circle size={20} color={colors.text + "88"} />}
                      <Typography variant="body1" style={{ flex: 1, minWidth: 0, flexShrink: 1 }}>
                        {choice.value}
                      </Typography>
                    </Pressable>
                  );
                })}

                {hasTextAnswer ? (
                  <TextInput
                    value={answer.textInputAnswer ?? ""}
                    onChangeText={text => setSurveyAnswers(previous => ({
                      ...previous,
                      [question.id]: { ...getQuestionAnswer(question), textInputAnswer: text },
                    }))}
                    editable={!answered && !surveySubmitting}
                    multiline
                    maxLength={question.maximumLength > 0 ? question.maximumLength : undefined}
                    placeholder="Ta réponse"
                    placeholderTextColor={colors.text + "80"}
                    style={{ minHeight: 48, maxWidth: "100%", padding: 12, borderRadius: 12, color: colors.text, backgroundColor: colors.overground, fontSize: 16, textAlignVertical: "top" }}
                  />
                ) : null}

                {answered ? (
                  <Typography variant="caption" color="textSecondary">Réponse déjà enregistrée</Typography>
                ) : null}
              </View>
            );
          })}

          {surveySubmitted ? (
            <Typography variant="body1" color="primary">Ta réponse a bien été envoyée.</Typography>
          ) : surveyQuestions.some(question => question.shouldAnswer && !question.answered) ? (
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmitSurvey || surveySubmitting}
              onPress={() => void submitSurvey()}
              style={{ minHeight: 48, alignItems: "center", justifyContent: "center", paddingHorizontal: 18, borderRadius: 14, backgroundColor: colors.primary, opacity: !canSubmitSurvey || surveySubmitting ? 0.55 : 1 }}
            >
              {surveySubmitting
                ? <ActivityIndicator />
                : <Typography variant="body1" weight="semibold" style={{ color: "#FFFFFF" }}>Envoyer ma réponse</Typography>}
            </Pressable>
          ) : null}

          {surveyError ? <Typography variant="body2" color="#D60046">{surveyError}</Typography> : null}
        </View>
      ) : null}

      {!surveyQuestions.length && cleanedContent ? (
        <HTMLView
          value={cleanedContent}
          stylesheet={stylesheet}
          style={{ gap: 12, width: "100%" }}
          paragraphBreak="\n"
          bullet="  •  "
        />
      ) : null}

      {news.attachments.length > 0 && (
        <ListLegacy>
          {news.attachments.map((attachment, index) => (
            <Item key={index} onPress={() => {
              void openDocumentAttachment(attachment).catch(error => {
                if (Platform.OS === "web") window.alert(`Document indisponible : ${String(error)}`);
                else Alert.alert("Document indisponible", String(error));
              });
            }}>
              <Leading>
                <Icon size={28}>
                  <Papicons name={getAttachmentIcon(attachment)} />
                </Icon>
              </Leading>
              <TypographyLegacy variant="title">
                {attachment.name}
              </TypographyLegacy>
              <TypographyLegacy variant="body1" color="secondary" style={{ flexShrink: 1, ...(Platform.OS === "web" ? { overflowWrap: "anywhere" } : {}) }}>
                {attachment.url}
              </TypographyLegacy>
            </Item>
          ))}
        </ListLegacy>
      )}

      <Stack gap={0} style={{ opacity: 0.4 }}>
        <TypographyLegacy variant="caption">
          Si cette actualité ne s'affiche pas correctement,
        </TypographyLegacy>
        <TypographyLegacy variant="caption" style={{
          textDecorationLine: 'underline'
        }} onPress={() => setHTMLCleanupEnabled(!HTMLCleanupEnabled)}>
          {HTMLCleanupEnabled ? "désactiver" : "activer"} le formattage automatique
        </TypographyLegacy>
      </Stack>
    </ScrollView >
  );
};

export default NewsPage;
