import { Database, Model, Q } from "@nozbe/watermelondb";
import React, { createContext, useContext } from 'react';

import { error, info } from "@/utils/logger/logger";

import { database } from './index';
import { Absence, Attendance, Delay, Observation, Punishment } from "./models/Attendance";
import { Balance } from "./models/Balance";
import CanteenHistoryItem from "./models/CanteenHistory";
import CanteenMenu from "./models/CanteenMenu";
import { Chat, Message, Recipient } from "./models/Chat";
import { Grade, Period, PeriodGrades } from "./models/Grades";
import Homework from "./models/Homework";
import Kid from "./models/Kid";
import News from "./models/News";
import Subject from "./models/Subject";
import Course from "./models/Timetable";
import { batchOperations, safeWrite } from "./utils/safeTransaction";
const _db: Database = database;

export const getDatabaseInstance = (): Database => _db;
const DatabaseContext = createContext(database);

export const DatabaseProvider = ({ children }: { children: React.ReactNode }) => (
  <DatabaseContext.Provider value={database}>{children}</DatabaseContext.Provider>
);

export const useDatabase = () => useContext(DatabaseContext);

export async function ClearDatabaseForAccount(accountId: string) {
  const db = getDatabaseInstance();
  const tablesWithAccount = [
    "homework",
    "news",
    "periods",
    "grades",
    "periodgrades",
    "attendance",
    "canteenmenus",
    "chats",
    "courses",
    "kids",
    "balances",
    "canteentransactions",
  ];

  // 1) Lectures HORS writer : tout await reste ici, jamais dans le batch.
  // Les await (relation.fetch()…) DANS le writer perdaient le contexte et
  // produisaient « markAsDeleted() can only be called from inside of a Writer ».
  const attendanceRecords = await db.get<Attendance>("attendance")
    .query(Q.where("createdByAccount", accountId))
    .fetch();
  const attendanceChildren: Model[] = [];
  for (const attendance of attendanceRecords) {
    const [delays, absences, observations, punishments] = await Promise.all([
      attendance.delays.fetch(),
      attendance.absences.fetch(),
      attendance.observations.fetch(),
      attendance.punishments.fetch(),
    ]);
    attendanceChildren.push(...delays, ...absences, ...observations, ...punishments);
  }

  const accountChats = await db.get<Chat>("chats")
    .query(Q.where("createdByAccount", accountId))
    .fetch();
  const chatIds = accountChats.map(chat => chat.chatId);
  const chatChildren: Model[] = chatIds.length > 0
    ? await Promise.all([
      db.get<Message>("messages").query(Q.where("chatId", Q.oneOf(chatIds))).fetch(),
      db.get<Recipient>("recipients").query(Q.where("chatId", Q.oneOf(chatIds))).fetch(),
    ]).then(([messages, recipients]) => [...messages, ...recipients])
    : [];

  const periodGradeRecords = await db.get<PeriodGrades>("periodgrades")
    .query(Q.where("createdByAccount", accountId))
    .fetch();
  const gradeChildren: Model[] = [];
  for (const periodGrade of periodGradeRecords) {
    const subjects = await db.get<Subject>("subjects")
      .query(Q.where("periodGradeId", periodGrade.id))
      .fetch();
    for (const subject of subjects) {
      const grades = await db.get<Grade>("grades")
        .query(Q.where("subjectId", subject.id))
        .fetch();
      gradeChildren.push(...grades);
    }
    gradeChildren.push(...subjects);
  }

  const tableRecords: Model[] = [];
  for (const table of tablesWithAccount) {
    try {
      const collection = db.get(table);
      const records = await collection
        .query(Q.where("createdByAccount", accountId))
        .fetch();

      if (records.length > 0) {
        tableRecords.push(...records);
      }
    } catch (err) {
      error(String(err))
    }
  }

  // 2) Un seul batch de destroyPermanently préparés : destroy est lui-même
  // un sub-writer, l'appeler en boucle avec des awaits concurrents sortait
  // du writer parent.
  // Grade rows may also be reached through their subject relation. Keep only
  // one prepared delete per Watermelon row.
  const allToDestroy = [...new Map(
    [...attendanceChildren, ...chatChildren, ...gradeChildren, ...tableRecords]
      .map(record => [record.id, record])
  ).values()];
  if (allToDestroy.length === 0) return;
  await safeWrite(db, async () => {
    await db.batch(...allToDestroy.map(record => record.prepareDestroyPermanently()));
  }, 30000, 'ClearDatabaseForAccount');
}

export async function removeAllDuplicates() {
  const db = getDatabaseInstance();

  try {
    const ownedKey = <T extends { createdByAccount?: string }>(key: (record: T) => string) =>
      (record: T) => `${record.createdByAccount ?? ""}:${key(record)}`;

    const uniqueKeys = {
      subjects: (r: Subject) => `${r.name}-${r.periodGradeId || ''}`,
      homework: ownedKey((r: Homework) => r.homeworkId),
      news: ownedKey((r: News) => r.newsId),
      periods: ownedKey((r: Period) => r.periodId),
      grades: ownedKey((r: Grade) => r.gradeId),
      attendance: ownedKey((r: Attendance) => r.attendanceId),
      delays: (r: Delay) => `${r.attendanceId}-${r.givenAt}`,
      observations: (r: Observation) => `${r.attendanceId}-${r.givenAt}`,
      absences: (r: Absence) => `${r.attendanceId}-${r.from}-${r.to}`,
      punishments: (r: Punishment) => `${r.attendanceId}-${r.givenAt}`,
      canteenmenus: ownedKey((r: CanteenMenu) => r.menuId),
      chats: ownedKey((r: Chat) => r.chatId),
      recipients: (r: Recipient) => r.recipientId,
      messages: (r: Message) => r.messageId,
      courses: ownedKey((r: Course) => r.courseId),
      kids: ownedKey((r: Kid) => r.kidId),
      balances: ownedKey((r: Balance) => r.balanceId),
      canteentransactions: ownedKey((r: CanteenHistoryItem) => r.transactionId),
    };
    let totalDuplicatesFound = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const allDuplicatesToDelete: any[] = [];
    for (const [tableName, keyFn] of Object.entries(uniqueKeys)) {
      const tableDuplicates = await findTableDuplicates(db, tableName, keyFn);
      if (tableDuplicates.length > 0) {
        allDuplicatesToDelete.push(...tableDuplicates);
        totalDuplicatesFound += tableDuplicates.length;
      }
    }

    if (allDuplicatesToDelete.length > 0) {

      // prepareMarkAsDeleted + batch séquentiels : les markAsDeleted() en
      // Promise.all() dans le writer perdaient le contexte Writer.
      const batches = batchOperations(allDuplicatesToDelete, 100);

      for (const batch of batches) {
        await safeWrite(db, async () => {
          await db.batch(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            ...(batch as any[]).map((record: any) => record.prepareMarkAsDeleted())
          );
        }, 30000, 'removeAllDuplicates');
      }

      info(`🍉 Duplicate removal completed successfully`);
    } else {
      info("🍉 No duplicates found");
    }

  } catch (err) {
    error(`Failed to remove duplicates: ${err}`);
    throw err;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function findTableDuplicates(db: Database, tableName: string, keyFn: (record: any) => string): Promise<any[]> {
  try {
    const collection = db.collections.get(tableName);
    const all = await collection.query().fetch();
    const seen = new Map();
    const duplicates = [];

    for (const record of all) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const key = keyFn(record as any);
      if (seen.has(key)) {
        duplicates.push(record);
      } else {
        seen.set(key, record);
      }
    }

    return duplicates;
  } catch (err) {
    error(`Failed to process table ${tableName}: ${err}`);
    return [];
  }
}
