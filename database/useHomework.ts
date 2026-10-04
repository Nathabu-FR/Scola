import { Model, Q } from "@nozbe/watermelondb";
import { useEffect, useState } from "react";

import { Attachment } from "@/services/shared/attachment";
import { Homework as SharedHomework } from "@/services/shared/homework";
import { generateId } from "@/utils/generateId";
import { warn } from "@/utils/logger/logger";

import { getDatabaseInstance, useDatabase } from "./DatabaseProvider";
import Homework from "./models/Homework";
import { getActiveAccountDataSourceIds, useActiveAccountDataSourceIds } from "./accountScope";
import { safeWrite } from "./utils/safeTransaction";

function mapHomeworkToShared(homework: Homework): SharedHomework {
  return {
    id: homework.homeworkId,
    subject: homework.subject,
    content: homework.content,
    dueDate: new Date(homework.dueDate),
    isDone: homework.isDone,
    returnFormat: homework.returnFormat,
    attachments: parseJsonArray(homework.attachments) as Attachment[],
    evaluation: homework.evaluation,
    custom: homework.custom,
    createdByAccount: homework.createdByAccount,
    kidName: homework.kidName,
    fromCache: true,
  };
}

export function getHomeworkRouteId(homework: SharedHomework): string {
  if (homework.custom && homework.id) return homework.id;
  return generateId(
    homework.subject +
      homework.content +
      homework.createdByAccount +
      homework.dueDate.toDateString()
  );
}

export async function getHomeworkById(id: string): Promise<SharedHomework | undefined> {
  const database = getDatabaseInstance();
  const sourceIds = getActiveAccountDataSourceIds();
  if (sourceIds.length === 0) return undefined;
  let records = await database
    .get<Homework>("homework")
    .query(Q.where("homeworkId", id), Q.where("createdByAccount", Q.oneOf(sourceIds)))
    .fetch();
  if (records.length === 0) {
    // Cache keys changed across releases. Keep old task links valid by
    // resolving the currently active profile's rows against their route key.
    const accountRecords = await database
      .get<Homework>("homework")
      .query(Q.where("createdByAccount", Q.oneOf(sourceIds)))
      .fetch();
    records = accountRecords.filter(record => {
      const homework = mapHomeworkToShared(record);
      return getHomeworkRouteId(homework) === id || record.homeworkId === id;
    }).slice(0, 1);
  }
  const cachedHomework = records[0] ? mapHomeworkToShared(records[0]) : undefined;

  if (!cachedHomework) return undefined;

  try {
    const { getManager } = await import("@/services/shared");
    const manager = getManager();
    const freshHomeworks = await manager?.getHomeworks(
      getWeekNumberFromDate(cachedHomework.dueDate)
    );
    const activeSourceIds = getActiveAccountDataSourceIds();
    const freshHomework = freshHomeworks?.find(homework =>
      activeSourceIds.includes(homework.createdByAccount) && getHomeworkRouteId(homework) === id
    );
    const cachedItem = activeSourceIds.includes(cachedHomework.createdByAccount)
      ? cachedHomework
      : undefined;
    return freshHomework ?? cachedItem;
  } catch (error) {
    warn(`Unable to refresh homework ${id}: ${String(error)}`);
    return getActiveAccountDataSourceIds().includes(cachedHomework.createdByAccount)
      ? cachedHomework
      : undefined;
  }
}

export function useHomeworkForWeek(weekNumber: number, refresh = 0) {
  const database = useDatabase();
  const sourceIds = useActiveAccountDataSourceIds();
  const [homeworks, setHomeworks] = useState<SharedHomework[]>([]);

  useEffect(() => {
    setHomeworks([]);
    let cancelled = false;
    const fetchHomeworks = async () => {
      const homeworksFetched = await getHomeworksFromCache(weekNumber, sourceIds);
      if (!cancelled) setHomeworks(homeworksFetched);
    };
    if (sourceIds.length > 0) {
      void fetchHomeworks();
    }
    return () => { cancelled = true; };
  }, [weekNumber, refresh, database, sourceIds]);

  return homeworks;
}

// Reads several weeks in one pass so a pager can render neighbouring weeks
// without waiting for their own effect to run. Weeks that drop out of the
// requested window are kept for one step, so scrolling back does not flash an
// empty page before the query resolves.
export function useHomeworkForWeeks(weekNumbers: number[], refresh = 0) {
  const database = useDatabase();
  const sourceIds = useActiveAccountDataSourceIds();
  const [homeworks, setHomeworks] = useState<Record<number, SharedHomework[]>>({});
  const weeksKey = weekNumbers.join(",");

  useEffect(() => {
    setHomeworks({});
    const weeks = weeksKey.length > 0 ? weeksKey.split(",").map(Number) : [];
    if (weeks.length === 0 || sourceIds.length === 0) {
      setHomeworks({});
      return;
    }

    let cancelled = false;
    const subscriptions = weeks.map(week => {
      const { start, end } = getDateRangeOfWeek(week);
      return database
        .get<Homework>("homework")
        .query(
          Q.where("dueDate", Q.between(start.getTime(), end.getTime())),
          Q.where("createdByAccount", Q.oneOf(sourceIds))
        )
        .observeWithColumns([
          "homeworkId",
          "subject",
          "content",
          "dueDate",
          "isDone",
          "returnFormat",
          "attachments",
          "evaluation",
          "custom",
          "createdByAccount",
          "kidName",
        ])
        .subscribe(records => {
          if (cancelled) return;
          const list = records
            .map(mapHomeworkToShared)
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
          setHomeworks(previous => ({ ...previous, [week]: list }));
        });
    });

    return () => {
      cancelled = true;
      subscriptions.forEach(subscription => subscription.unsubscribe());
    };
  }, [weeksKey, refresh, database, sourceIds]);

  return homeworks;
}

/** Observe every cached assignment so the home screen can rank open work across week boundaries. */
export function useAllHomeworkFromCache(options: { upcomingOnly?: boolean } = {}) {
  const database = useDatabase();
  const sourceIds = useActiveAccountDataSourceIds();
  const [homeworks, setHomeworks] = useState<SharedHomework[]>([]);
  const upcomingOnly = options.upcomingOnly ?? false;

  useEffect(() => {
    setHomeworks([]);
    if (sourceIds.length === 0) {
      setHomeworks([]);
      return;
    }
    const query = database.get<Homework>("homework").query(
      Q.where("createdByAccount", Q.oneOf(sourceIds)),
      ...(upcomingOnly
        ? [
            Q.where("isDone", false),
            Q.where("dueDate", Q.gte(Date.now() - 30 * 24 * 60 * 60 * 1000)),
            Q.sortBy("dueDate", Q.asc),
            Q.take(100),
          ]
        : [])
    );
    const subscription = query
      .observeWithColumns([
        "homeworkId",
        "subject",
        "content",
        "dueDate",
        "isDone",
        "returnFormat",
        "attachments",
        "evaluation",
        "custom",
        "createdByAccount",
        "kidName",
      ])
      .subscribe(records => {
        setHomeworks(
          records
            .map(mapHomeworkToShared)
            .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
        );
      });

    return () => subscription.unsubscribe();
  }, [database, sourceIds, upcomingOnly]);

  return homeworks;
}

export async function getHomeworksFromCache(
  weekNumber: number,
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedHomework[]> {
  try {
    const database = getDatabaseInstance();
    const { start, end } = getDateRangeOfWeek(weekNumber);
    const homeworks = await database
      .get<Homework>("homework")
      .query(
        Q.where("dueDate", Q.between(start.getTime(), end.getTime())),
        Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__")
      )
      .fetch();

    return homeworks
      .map(mapHomeworkToShared)
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
  } catch (e) {
    warn(String(e));
    return [];
  }
}

export async function addHomeworkToDatabase(homeworks: SharedHomework[]) {
  if (homeworks.length === 0) return;
  const db = getDatabaseInstance();

  const weekNumber = getWeekNumberFromDate(homeworks[0].dueDate);
  const { start, end } = getDateRangeOfWeek(weekNumber);
  const dbHomeworks = await db.get<Homework>("homework")
    .query(Q.where("dueDate", Q.between(start.getTime(), end.getTime())))
    .fetch();

  const homeworkIds: string[] = [];
  const refreshedServiceIds = new Set(
    homeworks.map(homework => homework.createdByAccount)
  );
  for (const hw of homeworks) {
    const oldId = generateId(hw.subject + hw.content + hw.createdByAccount);
    const id = getHomeworkRouteId(hw);

    homeworkIds.push(oldId, id);
  }

  const homeworksToDelete = dbHomeworks.filter(
    dbHomework =>
      refreshedServiceIds.has(dbHomework.createdByAccount) &&
      !homeworkIds.includes(dbHomework.homeworkId)
  );

  // Batch WatermelonDB : markAsDeleted() doit rester dans le Writer synchrone.
  // On prépare hors writer puis on batch, plutôt que d'appeler en boucle
  // des sub-writers (le log « can only be called from inside of a Writer »
  // venait d'écritures concurrentes imbriquées).
  if (homeworksToDelete.length > 0) {
    await safeWrite(
      db,
      async () => {
        await db.batch(
          ...homeworksToDelete.map(homework => homework.prepareMarkAsDeleted())
        );
      },
      10000,
      "removeStaleHomeworks"
    );
  }

  for (const hw of homeworks) {
    const oldId = generateId(hw.subject + hw.content + hw.createdByAccount);
    const id = getHomeworkRouteId(hw);

    const existing = await db
      .get("homework")
      .query(Q.where("homeworkId", id), Q.where("createdByAccount", hw.createdByAccount))
      .fetch();
    const oldExisting = await db
      .get("homework")
      .query(Q.where("homeworkId", oldId), Q.where("createdByAccount", hw.createdByAccount))
      .fetch();

    if (oldExisting.length > 0) {
      await safeWrite(
        db,
        async () => {
          await db.batch(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...oldExisting.map(oldRecord => (oldRecord as any).prepareMarkAsDeleted())
          );
        },
        10000,
        "removeMigratedHomework"
      );
    }

    if (existing.length === 0) {
      await safeWrite(
        db,
        async () => {
          await db.get("homework").create((record: Model) => {
            const homework = record as Homework;
            Object.assign(homework, {
              homeworkId: id,
              subject: hw.subject,
              content: hw.content,
              dueDate: hw.dueDate.getTime(),
              isDone: hw.isDone,
              returnFormat: hw.returnFormat,
              attachments: JSON.stringify(hw.attachments),
              evaluation: hw.evaluation,
              custom: hw.custom,
              createdByAccount: hw.createdByAccount,
              kidName: hw.kidName,
              fromCache: true,
            });
          });
        },
        10000,
        "addHomeworkToDatabase"
      );
    } else {
      const recordToUpdate = existing[0];
      await safeWrite(
        db,
        async () => {
          await recordToUpdate.update((record: Model) => {
            const homework = record as Homework;
            Object.assign(homework, {
              subject: hw.subject,
              content: hw.content,
              dueDate: hw.dueDate.getTime(),
              isDone: hw.isDone,
              returnFormat: hw.returnFormat,
              attachments: JSON.stringify(hw.attachments),
              evaluation: hw.evaluation,
              custom: hw.custom,
              createdByAccount: hw.createdByAccount,
              kidName: hw.kidName,
              fromCache: true,
            });
          });
        },
        10000,
        "updateHomeworkToDatabase"
      );
    }
  }
}

export async function addCustomHomeworkToDatabase(homework: SharedHomework) {
  const db = getDatabaseInstance();
  const id = homework.id || getHomeworkRouteId(homework);
  // Lecture HORS writer : un await dans le writer WatermelonDB fait perdre
  // le contexte (« can only be called from inside of a Writer »).
  const existing = await db
    .get<Homework>("homework")
    .query(
      Q.where("homeworkId", id),
      Q.where("createdByAccount", homework.createdByAccount)
    )
    .fetch();

  await safeWrite(db, async () => {
    const assignHomework = (record: Model) => {
      const row = record as Homework;
      Object.assign(row, {
        homeworkId: id,
        subject: homework.subject,
        content: homework.content,
        dueDate: homework.dueDate.getTime(),
        isDone: homework.isDone,
        returnFormat: homework.returnFormat,
        attachments: JSON.stringify(homework.attachments),
        evaluation: false,
        custom: true,
        createdByAccount: homework.createdByAccount,
        kidName: homework.kidName,
        fromCache: true,
      });
    };

    if (existing.length > 0) {
      await existing[0].update(assignHomework);
    } else {
      await db.get("homework").create(assignHomework);
    }
  }, 10000, "addCustomHomeworkToDatabase");
}

export async function updateHomeworkIsDone(
  homeworkId: string,
  isDone: boolean
) {
  const db = getDatabaseInstance();
  const sourceIds = getActiveAccountDataSourceIds();
  if (sourceIds.length === 0) {
    throw new Error("Aucun compte actif pour modifier ce devoir.");
  }

  // Lecture HORS writer (même raison que ci-dessus : pas d'await dans le writer).
  const existing = await db
    .get<Homework>("homework")
    .query(
      Q.where("homeworkId", homeworkId),
      Q.where("createdByAccount", Q.oneOf(sourceIds))
    )
    .fetch();

  if (existing.length === 0) {
    const message = `Homework with ID ${homeworkId} not found`;
    warn(message);
    throw new Error(message);
  }

  const recordToUpdate = existing[0];

  await safeWrite(
    db,
    async () => {
      await recordToUpdate.update((record: Model) => {
        const homework = record as Homework;
        homework.isDone = isDone;
      });
    },
    10000,
    "updateHomeworkIsDone"
  );
}

export async function deleteCustomHomeworkFromDatabase(
  homeworkId: string,
  accountId: string
) {
  const db = getDatabaseInstance();
  const records = await db
    .get<Homework>("homework")
    .query(Q.where("homeworkId", homeworkId), Q.where("createdByAccount", accountId))
    .fetch();
  const record = records[0];
  if (!record || !record.custom) {
    throw new Error("Ce devoir personnel n’existe plus pour ce compte.");
  }

  // deleteCustomHomework passé en batch préparé : le markAsDeleted() direct
  // dans le writer levait « can only be called from inside of a Writer »
  // quand une autre écriture tournait en parallèle.
  await safeWrite(db, async () => {
    await db.batch(record.prepareMarkAsDeleted());
  }, 10000, "deleteCustomHomework");
}

export function getDateRangeOfWeek(
  weekNumber: number,
  year = new Date().getFullYear()
) {
  const janFirst = new Date(year, 0, 1);
  const daysOffset = (weekNumber - 1) * 7;
  const weekStart = new Date(janFirst.setDate(janFirst.getDate() + daysOffset));
  const day = weekStart.getDay();
  const diff = weekStart.getDate() - day + (day <= 4 ? 1 : 8);
  const start = new Date(weekStart.setDate(diff));
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function parseJsonArray(s: string): unknown[] {
  try {
    const result = JSON.parse(s);
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export function getWeekNumberFromDate(date: Date): number {
  const firstWeekStart = getDateRangeOfWeek(1, date.getFullYear()).start;
  const startDay = Date.UTC(
    firstWeekStart.getFullYear(),
    firstWeekStart.getMonth(),
    firstWeekStart.getDate()
  );
  const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.floor((dateDay - startDay) / (7 * 24 * 60 * 60 * 1000));
  return days + 1;
}
