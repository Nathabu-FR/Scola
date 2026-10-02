import { Model, Q } from "@nozbe/watermelondb";
import { useEffect, useMemo, useState } from "react";

import { getICalCourseById, getICalEventsForWeek } from "@/services/local/ical";
import { Course as SharedCourse,CourseDay as SharedCourseDay } from "@/services/shared/timetable"
import { generateId } from "@/utils/generateId";
import { warn } from "@/utils/logger/logger";

import { getDatabaseInstance, useDatabase } from "./DatabaseProvider"
import { getAccountDataSourceIds, getActiveAccountDataSourceIds } from "./accountScope";
import { mapCourseToShared } from "./mappers/course";
import Course from "./models/Timetable";
import { getDateRangeOfWeek } from "./useHomework";
import { safeWrite } from "./utils/safeTransaction";
import { useAccountStore } from "@/stores/account";

export function getCourseRouteId(course: SharedCourse): string {
  // Les identifiants fournis par les services scolaires sont stables.
  // L'ancienne version reconstruisait l'ID avec l'horaire, la matière et le
  // professeur : un changement de professeur créait donc un nouveau cours et
  // faisait disparaître les statuts ajoutés localement.
  if (course.createdByAccount.startsWith('ical_')) return course.id;
  return generateId(course.createdByAccount + ':' + course.id);
}

export async function getCourseById(id: string): Promise<SharedCourse | undefined> {
  try {
    const sourceIds = getActiveAccountDataSourceIds();
    if (sourceIds.length === 0) return await getICalCourseById(id);
    const courses = await getDatabaseInstance()
      .get<Course>('courses')
      .query(Q.where('courseId', id), Q.where("createdByAccount", Q.oneOf(sourceIds)))
      .fetch();
    const course = courses[0] ? mapCourseToShared(courses[0]) : undefined;
    return course && getActiveAccountDataSourceIds().includes(course.createdByAccount)
      ? course
      : await getICalCourseById(id);
  } catch {
    return getICalCourseById(id);
  }
}

export async function updateCourseCustomStatus(courseId: string, customStatus?: string) {
  const db = getDatabaseInstance();
  const sourceIds = getActiveAccountDataSourceIds();
  if (sourceIds.length === 0) throw new Error("Aucun compte actif.");
  const records = await db.get<Course>("courses")
    .query(Q.where("courseId", courseId), Q.where("createdByAccount", Q.oneOf(sourceIds)))
    .fetch();
  if (!records[0]) throw new Error("Ce cours n’est plus disponible dans ce compte.");

  await safeWrite(db, async () => {
    await records[0].update((record: Model) => {
      (record as Course).customStatus = customStatus;
    });
  }, 10000, "updateCourseCustomStatus");
}

export function useTimetable(refresh = 0, weekNumber: number | number[] = 0, date: Date = new Date()) {
  const database = useDatabase();
  const accounts = useAccountStore(state => state.accounts);
  const activeAccountId = useAccountStore(state => state.lastUsedAccount);
  const sourceIds = useMemo(
    () => getAccountDataSourceIds(accounts.find(account => account.id === activeAccountId)),
    [accounts, activeAccountId]
  );
  const [timetable, setTimetable] = useState<SharedCourseDay[]>([]);

  const weeks = Array.isArray(weekNumber) ? weekNumber : [weekNumber];
  // Create a stable key for the weeks array to use in dependency arrays
  const weeksKey = weeks.join(',');

  useEffect(() => {
    setTimetable([]);
    let cancelled = false;
    let requestId = 0;
    const year = date.getFullYear();

    const fetchTimetable = async () => {
      const currentRequest = ++requestId;
      const timetableFetched = await getCoursesFromCache(weeks, year, sourceIds);
      if (!cancelled && currentRequest === requestId) {
        setTimetable(timetableFetched);
      }
    };

    // Courses written by a sync (e.g. right after adding an account) must show up
    // without the caller having to bump `refresh`.
    const { start, end } = getWeeksRange(weeks, year);
    const courseSubscription = database
      .get('courses')
      .query(Q.where('from', Q.between(start.getTime(), end.getTime())))
      .observe()
      .subscribe(fetchTimetable);
    const icalSubscription = database.get('icals').query().observe().subscribe(fetchTimetable);

    return () => {
      cancelled = true;
      courseSubscription.unsubscribe();
      icalSubscription.unsubscribe();
    };
  }, [refresh, database, weeksKey, date.getFullYear(), sourceIds]);

  return timetable;
}

export async function addCourseDayToDatabase(courses: SharedCourseDay[]) {
  const db = getDatabaseInstance();

  // 1) Toutes les lectures HORS writer (les awaits dans un writer WatermelonDB
  // font perdre le contexte et provoquent « markAsDeleted() can only be called
  // from inside of a Writer »).
  type DaySnapshot = {
    dayTimestamp: number;
    dbCourses: Course[];
    items: { item: SharedCourseDay["courses"][number]; oldId: string; id: string; existingRecords: Course[]; oldExistingRecords: Course[] }[];
  };
  const snapshots: DaySnapshot[] = [];
  const oneDayMs = 24 * 60 * 60 * 1000;
  for (const day of courses) {
    const dayTimestamp = day.date.getTime();

    const dbCourses = await db.get<Course>('courses')
      .query(
        Q.where('from', Q.between(dayTimestamp, dayTimestamp + oneDayMs))
      )
      .fetch();

    const items: DaySnapshot["items"] = [];
    for (const item of day.courses) {
      // MIGRATION TO AVOID DUPES, DO NOT DELETE
      const oldId = generateId(item.from.toISOString() + item.to.toISOString() + item.subject + item.teacher + item.room + item.createdByAccount);
      const id = getCourseRouteId(item);

      const oldExistingRecords = (await db.get<Course>('courses')
        .query(Q.where('courseId', oldId))
        .fetch()).filter(record => record.createdByAccount === item.createdByAccount);
      const existingRecords = (await db.get<Course>('courses')
        .query(Q.where('courseId', id))
        .fetch()).filter(record => record.createdByAccount === item.createdByAccount);
      items.push({ item, oldId, id, existingRecords, oldExistingRecords });
    }
    snapshots.push({ dayTimestamp, dbCourses, items });
  }

  // 2) Un seul writer : tout est préparé (create/update/delete) puis batché
  // d'un coup, sans aucun await intermédiaire.
  await safeWrite(
    db,
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prepared: any[] = [];
      for (const snapshot of snapshots) {
        const { dbCourses, items } = snapshot;

        const dayCourseIds = new Set(
          items.map(({ oldId, id }) => [oldId, id]).flat()
        );
        const refreshedServiceIds = new Set(
          items.map(({ item }) => item.createdByAccount)
        );

        const coursesToDelete = dbCourses.filter(
          dbCourse =>
            refreshedServiceIds.has(dbCourse.createdByAccount) &&
            !dayCourseIds.has(dbCourse.courseId)
        );

        for (const course of coursesToDelete) {
          prepared.push(course.prepareMarkAsDeleted());
        }

        for (const { item, oldId, id, existingRecords, oldExistingRecords } of items) {
          if (oldId !== id) {
            for (const oldRecord of oldExistingRecords) {
              prepared.push(oldRecord.prepareMarkAsDeleted());
            }
          }

          if (existingRecords.length === 0) {
            const migratedCustomStatus = item.customStatus ?? oldExistingRecords[0]?.customStatus;
            prepared.push(db.get('courses').prepareCreate((record: Model) => {
              const course = record as Course;
              Object.assign(course, {
                createdByAccount: item.createdByAccount,
                courseId: id,
                subject: item.subject,
                type: item.type,
                from: item.from.getTime(),
                to: item.to.getTime(),
                additionalInfo: item.additionalInfo,
                room: item.room,
                teacher: item.teacher,
                group: item.group,
                backgroundColor: item.backgroundColor,
                status: item.status,
                // Preserve a local status while migrating from the old
                // unstable ID scheme. Otherwise a teacher change silently
                // removes « Professeur absent » / « Cours annulé ».
                customStatus: migratedCustomStatus,
                url: item.url,
                kidName: item.kidName,
              });
            }));
          } else {
            const courseToUpdate = existingRecords[0];
            prepared.push(courseToUpdate.prepareUpdate((model: Model) => {
              const course = model as Course;
              Object.assign(course, {
                subject: item.subject ?? course.subject,
                type: item.type ?? course.type,
                from: item.from.getTime(),
                to: item.to.getTime(),
                additionalInfo: item.additionalInfo ?? course.additionalInfo,
                room: item.room ?? course.room,
                teacher: item.teacher ?? course.teacher,
                group: item.group ?? course.group,
                backgroundColor: item.backgroundColor ?? course.backgroundColor,
                status: item.status ?? course.status,
                customStatus: item.customStatus ?? course.customStatus,
                url: item.url ?? course.url,
                kidName: item.kidName ?? course.kidName,
              });
            }));
          }
        }
      }

      if (prepared.length > 0) {
        await db.batch(...prepared);
      }
    },
    15000,
    `add_timetable_${courses.length}_days`
  );
}

// Courses are grouped on the day they fall on in the device's timezone: grouping
// on the UTC date would file evening courses under the previous day west of UTC.
function startOfLocalDay(date: Date): number {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

function getWeeksRange(weeks: number[], year: number): { start: Date; end: Date } {
  let start = new Date(8640000000000000);
  let end = new Date(-8640000000000000);

  for (const w of weeks) {
    const range = getDateRangeOfWeek(w, year);
    if (range.start < start) {start = range.start;}
    if (range.end > end) {end = range.end;}
  }

  return { start, end };
}

export async function getCoursesFromCache(
  weeks: number[],
  year: number,
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedCourseDay[]> {
  try {
    const database = getDatabaseInstance();
    const { start: minStart, end: maxEnd } = getWeeksRange(weeks, year);

    const courses = await database
      .get<Course>('courses')
      .query(
        Q.where('from', Q.between(minStart.getTime(), maxEnd.getTime())),
        Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__")
      )
      .fetch();

    const dayMap: Record<number, SharedCourse[]> = {};
    for (const course of courses) {
      const dayKey = startOfLocalDay(new Date(course.from));
      dayMap[dayKey] = dayMap[dayKey] || [];
      dayMap[dayKey].push(mapCourseToShared(course));
    }

    try {
      const icalEvents = await getICalEventsForWeek(minStart, maxEnd);
      for (const event of icalEvents) {
        const dayKey = startOfLocalDay(event.from);
        dayMap[dayKey] = dayMap[dayKey] || [];
        dayMap[dayKey].push(event);
      }
    } catch (icalError) {
      console.warn('Error loading iCal events:', icalError);
    }

    for (const day in dayMap) {
      dayMap[day].sort((a, b) => a.from.getTime() - b.from.getTime());
    }

    return Object.entries(dayMap).map(([day, courses]) => ({
      date: new Date(Number(day)),
      courses
    }));
  } catch (e) {
    warn(String(e));
    return [];
  }
}
