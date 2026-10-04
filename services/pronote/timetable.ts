import {
  parseTimetable,
  resource,
  SessionHandle,
  TimetableClassActivity,
  TimetableClassDetention,
  TimetableClassLesson,
  timetableFromWeek,
  translateToWeekNumber,
} from "@blockshub/pawnote-lts";

import { Course, CourseDay, CourseResource, CourseStatus, CourseType } from "@/services/shared/timetable";
import { AttachmentType } from "@/services/shared/attachment";
import { error, warn } from "@/utils/logger/logger";

export async function fetchPronoteWeekTimetable(
  session: SessionHandle,
  accountId: string,
  weekNumberRaw: number,
  date: Date
): Promise<CourseDay[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteTimetable");
  }

  const translatedWeekNumber = translateToWeekNumber(date, session.instance.firstMonday);
  const weekNumber = Number.isFinite(translatedWeekNumber)
    ? translatedWeekNumber
    : weekNumberRaw;
  const timetable = await timetableFromWeek(session, weekNumber);

  const parseOptions = {
    withSuperposedCanceledClasses: true,
    withCanceledClasses: true,
    withPlannedClasses: true,
  };
  const sourceClasses = Array.isArray(timetable.classes)
    ? timetable.classes.map(sourceClass => ({ ...sourceClass }))
    : [];
  let parsedClasses = sourceClasses;
  const parseIndividually = () => sourceClasses.flatMap(sourceClass => {
    const isolatedTimetable = {
      ...timetable,
      classes: [{ ...sourceClass }],
    };

    try {
      parseTimetable(session, isolatedTimetable, parseOptions);
      return Array.isArray(isolatedTimetable.classes) ? isolatedTimetable.classes : [];
    } catch {
      return [];
    }
  });

  try {
    parseTimetable(session, timetable, parseOptions);
    parsedClasses = Array.isArray(timetable.classes) ? [...timetable.classes] : [];
    // Some PRONOTE payloads parse without throwing but still lose rows. In
    // that case retry the source entries independently and keep the fuller
    // result; this also preserves every valid course in a partially parsed week.
    if (parsedClasses.length < sourceClasses.length) {
      const individuallyParsed = parseIndividually();
      const currentCourseCount = mapCourses(accountId, parsedClasses).length;
      const recoveredCourseCount = mapCourses(accountId, individuallyParsed).length;
      if (recoveredCourseCount > currentCourseCount) {
        warn(`PRONOTE recovered ${recoveredCourseCount - currentCourseCount} missing timetable entries individually.`);
        parsedClasses = individuallyParsed;
      }
    }
  } catch {
    // A malformed entry should not discard every other class in the week.
    // Retry each source row independently so valid lessons still reach the UI.
    warn("PRONOTE could not parse the full timetable; retrying entries individually.");
    parsedClasses = parseIndividually();

    if (parsedClasses.length < sourceClasses.length) {
      warn(`PRONOTE skipped ${sourceClasses.length - parsedClasses.length} unparseable timetable entries.`);
    }
  }

  const mappedCourses = mapCourses(
    accountId,
    parsedClasses
  );
  const dayMap: Record<string, Course[]> = {};

  for (const course of mappedCourses) {
    const localDate = course.from;
    const dayKey = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
    dayMap[dayKey] = dayMap[dayKey] || [];
    dayMap[dayKey].push(course);
  }

  for (const day in dayMap) {
    dayMap[day].sort((a, b) => a.from.getTime() - b.from.getTime());
  }

  return Object.entries(dayMap).map(([day, courses]) => ({
    date: (() => {
      const [year, month, date] = day.split("-").map(Number);
      return new Date(year, month - 1, date);
    })(),
    courses
  }));
}

const mapCourses = (
  accountId: string,
  courses: (
    | TimetableClassLesson
    | TimetableClassDetention
    | TimetableClassActivity
  )[]
): Course[] => {
  const courseList: Course[] = [];

  for (const c of courses) {
    if (
      !(c.startDate instanceof Date) ||
      !Number.isFinite(c.startDate.getTime()) ||
      !(c.endDate instanceof Date) ||
      !Number.isFinite(c.endDate.getTime())
    ) {
      continue;
    }

    // Some timetable providers reuse an identifier for each occurrence of a
    // recurring class. Include the occurrence start so one lesson cannot hide
    // another during calendar de-duplication or database updates.
    const courseId = `${c.id}:${c.startDate.getTime()}`;
    const baseCourse = {
      from: c.startDate,
      to: c.endDate,
      backgroundColor: c.backgroundColor,
      additionalInfo: c.notes,
      createdByAccount: accountId
    }
    if (c.is === "lesson") {
      courseList.push({
        subject: c.subject?.name ?? "Cours",
        id: courseId,
        type: CourseType.LESSON,
        room: Array.isArray(c.classrooms) ? c.classrooms.join(", ") : "",
        teacher: Array.isArray(c.teacherNames) ? c.teacherNames.join(", ") : "",
        group: Array.isArray(c.groupNames) ? c.groupNames.join(", ") : "",
        status: mapCourseStatus(c),
        customStatus: c.status,
        resourceId: c.lessonResourceID,
        ...baseCourse
      });
    } else if (c.is === "detention") {
      courseList.push({
        id: courseId,
        type: CourseType.DETENTION,
        subject: c.title ?? "Detention",
        room: Array.isArray(c.classrooms) ? c.classrooms.join(", ") : "",
        ...baseCourse
      });
    } else if (c.is === "activity") {
      courseList.push({
        id: courseId,
        type: CourseType.ACTIVITY,
        subject: c.title,
        ...baseCourse
      });
    }
  }

  return courseList;
};

export async function fetchPronoteCourseResources(
  session: SessionHandle,
  course: Course
): Promise<CourseResource[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteCourseResources");
  }

  if (!course.resourceId) {
    return [];
  }

  const resourceData = await resource(session, course.resourceId);
  type ResourceRecord = Record<string, unknown>;
  const asRecord = (value: unknown): ResourceRecord | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as ResourceRecord
      : undefined;
  const unwrapList = (value: unknown): unknown[] => {
    if (Array.isArray(value)) return value;
    const record = asRecord(value);
    return Array.isArray(record?.V) ? record.V : [];
  };
  const readText = (value: unknown, depth = 0): string => {
    if (depth > 5) return "";
    if (typeof value === "string") return value;
    if (Array.isArray(value)) return value.map(item => readText(item, depth + 1)).filter(Boolean).join("\n");
    const record = asRecord(value);
    if (!record) return "";
    for (const key of ["V", "value", "text", "content", "L"]) {
      const text = readText(record[key], depth + 1);
      if (text) return text;
    }
    return "";
  };
  const payload = asRecord(resourceData);
  const resources = unwrapList(payload?.contents ?? payload?.resources ?? payload?.items ?? resourceData);

  return resources.flatMap(value => {
    const item = asRecord(value);
    if (!item) return [];
    const fileList = unwrapList(item.files ?? item.attachments ?? item.documents);
    return [{
      title: readText(item.title ?? item.name),
      description: readText(item.description ?? item.content ?? item.text),
      category: typeof item.category === "number" ? item.category : 0,
      attachments: fileList.flatMap(file => {
        const attachment = asRecord(file);
        if (!attachment) return [];
        const url = readText(attachment.url ?? attachment.href);
        if (!url) return [];
        const kind = attachment.kind ?? attachment.type;
        return [{
          type: kind === 0 || kind === "link" || kind === "LINK" ? AttachmentType.LINK : AttachmentType.FILE,
          name: readText(attachment.name ?? attachment.filename) || "Document",
          url,
          createdByAccount: course.createdByAccount,
        }];
      }),
    }];
  });
}

const mapCourseStatus = (course: TimetableClassLesson): CourseStatus | undefined => {
  if (course.canceled) {
    return CourseStatus.CANCELED;
  }

  const status = (course.status ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/\s+/g, " ")
    .trim();

  if (
    status.includes("annul") ||
    status.includes("absent") ||
    status.includes("non assure") ||
    status.includes("non dispense") ||
    status.includes("sortie pedagogique")
  ) {
    return CourseStatus.CANCELED;
  }

  if (course.test) {
    return CourseStatus.EVALUATED;
  }

  return undefined
};
