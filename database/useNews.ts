import { Model, Q } from "@nozbe/watermelondb";
import { useEffect, useMemo, useState } from "react";

import { Attachment } from "@/services/shared/attachment";
import { News as SharedNews } from "@/services/shared/news";
import { useAccountStore } from "@/stores/account";
import { generateId } from "@/utils/generateId";
import { info,warn } from "@/utils/logger/logger";

import { getDatabaseInstance, useDatabase } from "./DatabaseProvider";
import News from "./models/News";
import { getAccountDataSourceIds, getActiveAccountDataSourceIds } from "./accountScope";
import { parseJsonArray } from "./useHomework";
import { safeWrite } from "./utils/safeTransaction";

export function useNews(refresh = 0) {
  const database = useDatabase();
  const accounts = useAccountStore(state => state.accounts);
  const activeAccountId = useAccountStore(state => state.lastUsedAccount);
  const sourceIds = useMemo(
    () => getAccountDataSourceIds(accounts.find(account => account.id === activeAccountId)),
    [accounts, activeAccountId]
  );
  const sourceKey = sourceIds.join("\u0000");
  const [news, setNews] = useState<SharedNews[]>([]);

  useEffect(() => {
    setNews([]);
    const query = database.get<News>('news').query(
      Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__")
    );

    const sub = query.observe().subscribe(news =>
      setNews(
        news.map(mapNewsToShared).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      )
    );

    return () => sub.unsubscribe();
  }, [refresh, database, sourceIds, sourceKey]);

  return news.filter(item => sourceIds.includes(item.createdByAccount));
}

export function getNewsRouteId(item: SharedNews): string {
  return generateId(item.author + item.title + item.createdByAccount);
}

export async function getNewsById(id: string): Promise<SharedNews | undefined> {
  const database = getDatabaseInstance();
  const sourceIds = getActiveAccountDataSourceIds();
  if (sourceIds.length === 0) return undefined;
  const records = await database
    .get<News>('news')
    .query(Q.where("newsId", id), Q.where("createdByAccount", Q.oneOf(sourceIds)))
    .fetch();
  const cachedNews = records[0] ? mapNewsToShared(records[0]) : undefined;
  const activeSourceIds = getActiveAccountDataSourceIds();
  const cachedItem = cachedNews && activeSourceIds.includes(cachedNews.createdByAccount)
    ? cachedNews
    : undefined;

  // The list already came from this cache. Never hold the detail screen behind
  // a second full-feed request; on slow school servers that could take minutes.
  if (cachedItem) return cachedItem;

  try {
    const { getManager } = await import("@/services/shared");
    const freshNews = await getManager()?.getNews();
    const currentSourceIds = getActiveAccountDataSourceIds();
    return freshNews?.find(item =>
      currentSourceIds.includes(item.createdByAccount) && getNewsRouteId(item) === id
    );
  } catch (error) {
    warn(`Unable to refresh news ${id}: ${String(error)}`);
    return undefined;
  }
}

export async function addNewsToDatabase(news: SharedNews[]) {
  const db = getDatabaseInstance();

  const itemsToCreate: Array<{ id: string; item: SharedNews }> = [];
  const itemsToUpdate: Array<{ record: Model; item: SharedNews }> = [];

  for (const item of news) {
    const id = getNewsRouteId(item);

    const existingRecords = await db.get('news')
      .query(
        Q.where("newsId", id),
        Q.where("createdByAccount", item.createdByAccount ?? "")
      )
      .fetch();

    if (existingRecords.length === 0) {
      itemsToCreate.push({ id, item });
    } else {
      itemsToUpdate.push({ record: existingRecords[0], item });
    }
  }

  if (itemsToCreate.length > 0 || itemsToUpdate.length > 0) {
    await safeWrite(
      db,
      async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const prepared: any[] = [];
        for (const { id, item } of itemsToCreate) {
          prepared.push(db.get('news').prepareCreate((record: Model) => {
            const newsModel = record as News;
            newsModel.newsId = id;
            newsModel.title = item.title ?? "";
            newsModel.createdAt = item.createdAt.getTime();
            newsModel.acknowledged = item.acknowledged;
            newsModel.attachments = JSON.stringify(item.attachments ?? []);
            newsModel.content = item.content ?? "";
            newsModel.author = item.author ?? "";
            newsModel.category = item.category ?? "";
            newsModel.createdByAccount = item.createdByAccount ?? "";
            newsModel.question = item.question ?? false;
            newsModel.surveyRaw = item.survey ? JSON.stringify(item.survey) : "";
          }));
        }

        for (const { record, item } of itemsToUpdate) {
          prepared.push(record.prepareUpdate((model: Model) => {
            const newsModel = model as News;
            newsModel.title = item.title ?? newsModel.title;
            newsModel.createdAt = item.createdAt.getTime();
            newsModel.acknowledged = item.acknowledged;
            newsModel.attachments = JSON.stringify(item.attachments ?? []);
            newsModel.content = item.content ?? newsModel.content;
            newsModel.author = item.author ?? newsModel.author;
            newsModel.category = item.category ?? newsModel.category;
            newsModel.createdByAccount = item.createdByAccount ?? newsModel.createdByAccount;
            newsModel.question = item.question ?? newsModel.question;
            newsModel.surveyRaw = item.survey ? JSON.stringify(item.survey) : "";
          }));
        }

        // prepare + un seul batch : les create/update en Promise.all() dans le
        // writer perdaient le contexte (« can only be called from inside of a Writer »).
        await db.batch(...prepared);
      },
      10000,
      `add_news_${itemsToCreate.length}_create_${itemsToUpdate.length}_update`
    );
  } else {
    info(`🍉 No news items to process`);
  }
}


export async function getNewsFromCache(
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedNews[]> {
  try {
    const database = getDatabaseInstance();

    const news = await database
      .get<News>('news')
      .query(Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__"))
      .fetch();

    return news
      .map(mapNewsToShared)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  } catch (e) {
    warn(String(e));
    return [];
  }
}

function mapNewsToShared(news: News): SharedNews {
  let survey: SharedNews["survey"];
  try {
    survey = news.surveyRaw ? JSON.parse(news.surveyRaw) as SharedNews["survey"] : undefined;
  } catch {
    survey = undefined;
  }

  return {
    id: news.newsId,
    title: news.title,
    createdAt: new Date(news.createdAt),
    acknowledged: news.acknowledged,
    attachments: parseJsonArray(news.attachments) as Attachment[],
    content: news.content,
    author: news.author,
    category: news.category,
    createdByAccount: news.createdByAccount,
    fromCache: true,
    question: news.question,
    survey,
  };
}
