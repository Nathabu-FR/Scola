import { ActualitiesResponse } from "esup-multi.js";
import { NewsInformation, NewsSurvey } from "@blockshub/pawnote-lts";
import { News as SkolengoNews } from "skolengojs";

import { Attachment } from "@/services/shared/attachment";
import { GenericInterface } from "@/services/shared/types";

/**
 * This interface defines the general structure of a news item.
 * @property {string} id - Unique Identifier for each news item.
 * @property {string} title - The title of the news item.
 * @property {Date} createdAt - The date when the news item was created.
 * @property {boolean} acknowledged - Indicates whether the news item has been acknowledged by the user.
 * @property {Array<Attachment>} attachments - List of attachments related to the news item.
 * @property {string} content - The content or description of the news item in HTML.
 * @property {string} author - The author of the news item.
 * @property {string} category - The category of the news item.
 */
export interface News extends GenericInterface {
  id: string;
  title?: string;
  createdAt: Date;
  acknowledged: boolean;
  attachments: Attachment[];
  content: string;
  author: string;
  category: string;
  question?: boolean;
  survey?: NewsSurveyData;
  ref?: NewsInformation | NewsSurvey | SkolengoNews | ActualitiesResponse;
}

export interface NewsSurveyChoice {
  value: string;
  position: number;
  isTextInput: boolean;
}

export interface NewsSurveyQuestion {
  id: string;
  position: number;
  kind: number;
  fullTitle: string;
  title: string;
  content: string;
  shouldAnswer: boolean;
  answered: boolean;
  selectedAnswers?: number[];
  textInputAnswer?: string;
  shouldRespectMaximumChoices: boolean;
  maximumChoices: number;
  maximumLength: number;
  choices: NewsSurveyChoice[];
  attachments: Attachment[];
}

/** Safe, cacheable display data for a Pronote survey. */
export interface NewsSurveyData {
  isAnonymous: boolean;
  questions: NewsSurveyQuestion[];
}

export interface NewsSurveyAnswer {
  selectedAnswers?: number[];
  textInputAnswer?: string;
}

export type NewsSurveyAnswers = Record<string, NewsSurveyAnswer>;
