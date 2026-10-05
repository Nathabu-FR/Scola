import { Model, Q } from "@nozbe/watermelondb";
import { useEffect, useState } from "react";

import { getICalCourseById, getICalEventsForWeek } from "@/services/local/ical";
import {
  COURSE_CANCELLED_LABEL,
  COURSE_TEACHER_ABSENT_LABEL,
  Course as SharedCourse,
  CourseDay as SharedCourseDay,
} from "@/services/shared/timetable";
import { generateId } from "@/utils/generateId";
import { warn } from "@/utils/logger/logger";

import { getDatabaseInstance, useDatabase } from "./DatabaseProvider"
import { getActiveAccountDataSourceIds, useActiveAccountDataSourceIds } from "./accountScope";
import { mapCourseToShared } from "./mappers/course";
import Course from "./models/Timetable";
import { getDateRangeOfWeek, getWeekNumberFromDate } from "./useHomework";
import { safeWrite } from "./utils/safeTransaction";

const getPersonalCourseStatus = (...statuses: (string | undefined)[]) =>
  statuses.find(status =>
    status === COURSE_CANCELLED_LABEL || status === COURSE_TEACHER_ABSENT_LABEL
  );

// A timetable service can return a usable occurrence before its database write
// has completed (or if that write failed). Keep those fresh rows briefly so a
// tap from the Cours tab can resolve the same detail route as the home screen.
const transientCourseRoutes = new Map<string, { course: SharedCourse; expiresAt: number }>();
const TRANSIENT_COURSE_TTL_MS = 15 * 60 * 1000;
const MAX_TRANSIENT_COURSES = 500;

export function rememberCourseForRoute(course: SharedCourse) {
  const now = Date.now();
  for (const [key, entry] of transientCourseRoutes) {
    if (entry.expiresAt <= now) transientCourseRoutes.delete(key);
  }
  const id = getCourseRouteId(course);
  const key = `${course.createdByAccount}:${id}`;
  transientCourseRoutes.delete(key);
  transientCourseRoutes.set(key, { course, expiresAt: now + TRANSIENT_COURSE_TTL_MS });
  while (transientCourseRoutes.size > MAX_TRANSIENT_COURSES) {
    const oldest = transientCourseRoutes.keys().next().value;
    if (oldest === undefined) break;
    transientCourseRoutes.delete(oldest);
  }
}

function getRememberedCourse(id: string, sourceIds: string[]): SharedCourse | undefined {
  const now = Date.now();
  for (const [key, entry] of transientCourseRoutes) {
    if (entry.expiresAt <= now) {
      transientCourseRoutes.delete(key);
    } else if (
      getCourseRouteId(entry.course) === id &&
      sourceIds.includes(entry.course.createdByAccount)
    ) {
      return entry.course;
    }
  }
  return undefined;
}

export function getCourseRouteId(course: SharedCourse): string {
  // Les identifiants fournis par les services scolaires sont stables.
  // L'ancienne version reconstruisait l'ID avec l'horaire, la matière et le
  // professeur : un changement de professeur créait donc un nouveau cours et
  // faisait disparaître les statuts ajoutés localement.
  // Cached records keep their persisted key, including records from the old
  // timetable ID format. Regenerating it made stale courses impossible to open.
  if (course.createdByAccount.startsWith('ical_') || course.fromCache) return course.id;
  return generateId(course.createdByAccount + ':' + course.id);
}

export function parseCourseRouteData(
  serializedCourse: string | undefined,
  routeId: string
): SharedCourse | undefined {
  if (!serializedCourse || !routeId) return undefined;
  try {
    const value = JSON.parse(serializedCourse) as Record<string, unknown>;
    const from = value.from;
    const to = value.to;
    if (
      typeof value.id !== "string" ||
      typeof value.createdByAccount !== "string" ||
      typeof value.subject !== "string" ||
      !(typeof from === "string" || typeof from === "number" || from instanceof Date) ||
      !(typeof to === "string" || typeof to === "number" || to instanceof Date)
    ) return undefined;

    const course = {
      ...value,
      from: new Date(from instanceof Date ? from.getTime() : from),
      to: new Date(to instanceof Date ? to.getTime() : to),
    } as SharedCourse;
    if (
      !Number.isFinite(course.from.getTime()) ||
      !Number.isFinite(course.to.getTime()) ||
      !getActiveAccountDataSourceIds().includes(course.createdByAccount) ||
      (getCourseRouteId(course) !== routeId && course.id !== routeId)
    ) return undefined;

    rememberCourseForRoute(course);
    return course;
  } catch {
    return undefined;
  }
}

export async function getCourseById(id: string): Promise<SharedCourse | undefined> {
  try {
    const sourceIds = getActiveAccountDataSourceIds();
    if (sourceIds.length === 0) return await getICalCourseById(id);
    const table = getDatabaseInstance().get<Course>('courses');
    const exact = await table
      .query(Q.where('courseId', id), Q.where("createdByAccount", Q.oneOf(sourceIds)))
      .fetch();
    let course = exact[0] ? mapCourseToShared(exact[0]) : undefined;

    // Older releases formed the route key from the occurrence's display
    // fields. Resolve those links too, so a previously rendered calendar item
    // does not turn into a dead course screen after the cache is refreshed.
    if (!course) {
      const accountCourses = await table
        .query(Q.where("createdByAccount", Q.oneOf(sourceIds)))
        .fetch();
      course = accountCourses
        .map(mapCourseToShared)
        .find(item => {
          const legacyId = generateId(
            item.from.toISOString() + item.to.toISOString() + item.subject +
              (item.teacher ?? "") + (item.room ?? "") + item.createdByAccount
          );
          return item.id === id || getCourseRouteId(item) === id || legacyId === id;
        });
    }

    if (course && getActiveAccountDataSourceIds().includes(course.createdByAccount)) return course;
    const remembered = getRememberedCourse(id, getActiveAccountDataSourceIds());
    return remembered ?? await getICalCourseById(id);
  } catch {
    const remembered = getRememberedCourse(id, getActiveAccountDataSourceIds());
    return remembered ?? await getICalCourseById(id);
  }
}

export async function updateCourseCustomStatus(courseId: string, customStatus?: string) {
  const db = getDatabaseInstance();
  const sourceIds = getActiveAccountDataSourceIds();
  if (sourceIds.length === 0) throw new Error("Aucun compte actif.");
  let records = await db.get<Course>("courses")
    .query(Q.where("courseId", courseId), Q.where("createdByAccount", Q.oneOf(sourceIds)))
    .fetch();
  if (!records[0]) {
    const remembered = getRememberedCourse(courseId, sourceIds);
    if (!remembered) throw new Error("Ce cours n’est plus disponible dans ce compte.");
    const date = new Date(remembered.from.getTime());
    date.setHours(0, 0, 0, 0);
    await addCourseDayToDatabase([{ date, courses: [remembered] }]);
    records = await db.get<Course>("courses")
      .query(Q.where("courseId", courseId), Q.where("createdByAccount", Q.oneOf(sourceIds)))
      .fetch();
  }
  if (!records[0]) throw new Error("Ce cours n’est plus disponible dans ce compte.");

  await safeWrite(db, async () => {
    await records[0].update((record: Model) => {
      (record as Course).customStatus = customStatus;
    });
  }, 10000, "updateCourseCustomStatus");
}

export function useTimetable(refresh = 0, weekNumber: number | number[] = 0, date: Date = new Date()) {
  const database = useDatabase();
  const sourceIds = useActiveAccountDataSourceIds();
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
      const timetableFetched = await getCoursesFromCache(weeks, year, sourceIds, date);
      if (!cancelled && currentRequest === requestId) {
        setTimetable(timetableFetched);
      }
    };

    // Courses written by a sync (e.g. right after adding an account) must show up
    // without the caller having to bump `refresh`.
    const { start, end } = getWeeksRange(weeks, year, date);
    const courseSubscription = database
      .get('courses')
      .query(Q.where('from', Q.between(start.getTime(), end.getTime())))
      .observeWithColumns([
        'createdByAccount',
        'kidName',
        'courseId',
        'subject',
        'type',
        'from',
        'to',
        'additionalInfo',
        'room',
        'teacher',
        'group',
        'backgroundColor',
        'status',
        'customStatus',
        'resourceId',
        'url',
      ])
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
        const incomingCountByService = new Map<string, number>();
        const cachedCountByService = new Map<string, number>();
        for (const { item } of items) {
          incomingCountByService.set(
            item.createdByAccount,
            (incomingCountByService.get(item.createdByAccount) ?? 0) + 1
          );
        }
        for (const cachedCourse of dbCourses) {
          cachedCountByService.set(
            cachedCourse.createdByAccount,
            (cachedCountByService.get(cachedCourse.createdByAccount) ?? 0) + 1
          );
        }

        const coursesToDelete = dbCourses.filter(
          dbCourse =>
            refreshedServiceIds.has(dbCourse.createdByAccount) &&
            // A shorter response can be a truncated timetable refresh. Keep
            // the last known complete day rather than deleting the other
            // lessons just because this response only contained a few.
            (incomingCountByService.get(dbCourse.createdByAccount) ?? 0) >=
              (cachedCountByService.get(dbCourse.createdByAccount) ?? 0) &&
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
            const migratedCustomStatus = getPersonalCourseStatus(
              ...oldExistingRecords.map(record => record.customStatus)
            ) ?? item.customStatus ?? oldExistingRecords[0]?.customStatus;
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
                resourceId: item.resourceId,
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
              const personalStatus = getPersonalCourseStatus(course.customStatus);
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
                resourceId: item.resourceId ?? course.resourceId,
                // A background timetable refresh must not replace a status
                // added by the user with the provider's (possibly blank or
                // unrelated) status value.
                customStatus: personalStatus ?? item.customStatus ?? course.customStatus,
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

function getWeeksRange(weeks: number[], year: number, anchorDate?: Date): { start: Date; end: Date } {
  let start = new Date(8640000000000000);
  let end = new Date(-8640000000000000);
  const anchorWeek = anchorDate ? getWeekNumberFromDate(anchorDate) : undefined;

  for (const w of weeks) {
    let range: { start: Date; end: Date };
    if (anchorDate && anchorWeek !== undefined) {
      const targetDate = new Date(anchorDate);
      targetDate.setDate(targetDate.getDate() + (w - anchorWeek) * 7);
      range = getDateRangeOfWeek(getWeekNumberFromDate(targetDate), targetDate.getFullYear());
    } else {
      range = getDateRangeOfWeek(w, year);
    }
    if (range.start < start) {start = range.start;}
    if (range.end > end) {end = range.end;}
  }

  return { start, end };
}

export async function getCoursesFromCache(
  weeks: number[],
  year: number,
  sourceIds: string[] = getActiveAccountDataSourceIds(),
  anchorDate?: Date
): Promise<SharedCourseDay[]> {
  try {
    const database = getDatabaseInstance();
    const { start: minStart, end: maxEnd } = getWeeksRange(weeks, year, anchorDate);

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
