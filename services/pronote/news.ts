import {
  news as PawnoteNews,
  NewsInformation,
  NewsQuestion,
  NewsSurvey,
  newsInformationAcknowledge,
  newsQuestionLocalMutate,
  newsRead,
  newsSurveySend,
  SessionHandle,
} from "@blockshub/pawnote-lts";

import { News, NewsSurveyAnswers, NewsSurveyData } from "@/services/shared/news";
import { error } from "@/utils/logger/logger";

/**
 * Fetches news from PRONOTE.
 * @param {SessionHandle} session - The session handle for the PRONOTE account.
 * @param {string} accountId - The ID of the account requesting the homeworks.
 * @returns {Promise<News[]>} A promise that resolves to an array of News objects.
 */
export async function fetchPronoteNews(session: SessionHandle, accountId: string): Promise<News[]> {
  const response = await PawnoteNews(session);
  return (Array.isArray(response?.items) ? response.items : []).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const isSurvey = item.is === "survey";
    const informationQuestion = !isSurvey && "question" in item ? item.question : undefined;
    const questions = isSurvey
      ? (Array.isArray(item.questions) ? item.questions : [])
      : informationQuestion && informationQuestion.kind !== 0 ? [informationQuestion] : [];
    const attachments = [
      ...(isSurvey ? [] : item.attachments ?? []),
      ...questions.flatMap(question => question.attachments ?? []),
    ];

    return [{
      id: item.id,
      title: item.title,
      createdAt: item.creationDate,
      acknowledged: item.read,
      attachments: attachments.map((attachment) => ({
        type: attachment.kind,
        name: attachment.name,
        url: attachment.url,
        createdByAccount: accountId
      })),
      content: isSurvey
        ? questions.map(question => question.content).filter(Boolean).join("<br />")
        : item.content,
      author: item.author,
      category: item.category?.name ?? (isSurvey ? "Sondage" : "Actualité"),
      ref: item,
      createdByAccount: accountId,
      question: isSurvey || Boolean(informationQuestion && informationQuestion.kind !== 0),
      survey: questions.length > 0
        ? { isAnonymous: isSurvey ? item.isAnonymous : false, questions: questions.map(serializeQuestion) }
        : undefined,
    }];
  });
}

export async function setPronoteNewsAsAcknowledged(
  session: SessionHandle,
  news: News
): Promise<News> {
  let reference = news.ref && "is" in news.ref
    ? news.ref as NewsInformation | NewsSurvey
    : undefined;

  if (!reference) {
    const response = await PawnoteNews(session);
    reference = response.items.find(item => item.id === news.id);
  }

  if (!reference) {
    throw error("Reference for news item is missing.", "setPronoteNewsAsAcknowledged");
  }

  if (reference.is === "survey") {
    await newsRead(session, reference, true);
  } else {
    await newsInformationAcknowledge(session, reference as NewsInformation);
  }
  return { ...news, acknowledged: true };
}

export async function answerPronoteNewsSurvey(
  session: SessionHandle,
  item: News,
  answers: NewsSurveyAnswers
): Promise<void> {
  let reference = item.ref && "is" in item.ref
    ? item.ref as NewsInformation | NewsSurvey
    : undefined;

  if (!reference) {
    const response = await PawnoteNews(session);
    reference = response.items.find(news => news.id === item.id);
  }

  if (!reference) {
    throw error("Survey is no longer available.", "answerPronoteNewsSurvey");
  }

  const questions = reference.is === "survey" ? reference.questions : [reference.question];
  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer) continue;
    newsQuestionLocalMutate(
      question,
      answer.selectedAnswers ?? [],
      answer.textInputAnswer
    );
  }

  if (reference.is === "survey") {
    await newsSurveySend(session, reference, true);
  } else {
    await newsInformationAcknowledge(session, reference, true);
  }
}

function serializeQuestion(question: NewsQuestion): NewsSurveyData["questions"][number] {
  return {
      id: question.id,
      position: question.position,
      kind: question.kind,
      fullTitle: question.fullTitle,
      title: question.title,
      content: question.content,
      shouldAnswer: question.shouldAnswer,
      answered: question.answered,
      selectedAnswers: question.selectedAnswers,
      textInputAnswer: question.textInputAnswer,
      shouldRespectMaximumChoices: question.shouldRespectMaximumChoices,
      maximumChoices: question.maximumChoices,
      maximumLength: question.maximumLength,
      choices: (Array.isArray(question.choices) ? question.choices : []).map(choice => ({
        value: choice.value,
        position: choice.position,
        isTextInput: choice.isTextInput,
      })),
      attachments: (Array.isArray(question.attachments) ? question.attachments : []).map(attachment => ({
        type: attachment.kind,
        name: attachment.name,
        url: attachment.url,
        createdByAccount: "",
      })),
  };
}
