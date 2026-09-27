import { Client, TimetableCourse, TimetableCourseType } from "@blockshub/blocksdirecte";

import { getDateRangeOfWeek } from "@/database/useHomework";
import { warn } from "@/utils/logger/logger";

import { Course, CourseDay, CourseStatus, CourseType } from "../shared/timetable";

export async function fetchEDTimetable(session: Client, accountId: string, weekNumber: number): Promise<CourseDay[]> {
  try {
    const { start, end } = getDateRangeOfWeek(weekNumber);

    // EcoleDirecte can answer an empty week (holidays, no timetable published
    // yet) with something other than an array, so this guards before filtering
    // instead of assuming `.filter` is always available on the response.
    const rawTimetable: unknown = await session.timetable.getTimetableBetweenDates(start, end, false);
    const timetable = unwrapCourseList(rawTimetable).filter(course =>
      typeof course?.codeMatiere === "string" && course.codeMatiere.length > 0
    );
    const mappedCourses = mapEcoleDirecteCourses(timetable, accountId);
    const dayMap: Record<string, Course[]> = {};

    for (const course of mappedCourses) {
      const dayKey = course.from.toISOString().split("T")[0];
      dayMap[dayKey] = dayMap[dayKey] || [];
      dayMap[dayKey].push(course);
    }

    for (const day in dayMap) {
      dayMap[day].sort((a, b) => a.from.getTime() - b.from.getTime());
    }

    return Object.entries(dayMap).map(([day, courses]) => ({
      date: new Date(day),
      courses
    }));
  } catch(error) {
    warn(String(error))
    return []
  }
}

function unwrapCourseList(value: unknown): TimetableCourse[] {
  if (Array.isArray(value)) {
    return value as TimetableCourse[];
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  for (const key of ["cours", "courses", "data", "items", "result"]) {
    const nested = record[key];
    if (Array.isArray(nested)) {
      return nested as TimetableCourse[];
    }
    if (nested && typeof nested === "object") {
      const unwrapped = unwrapCourseList(nested);
      if (unwrapped.length > 0) {
        return unwrapped;
      }
    }
  }

  return [];
}

function mapEcoleDirecteCourses(data: TimetableCourse[], accountId: string): Course[] {
  return data.map(item => ({
    createdByAccount: accountId,
    subject: item.matiere,
    id: String(item.id),
    type: mapCourseKind(item.typeCours),
    from: new Date(item.start_date),
    to: new Date(item.end_date),
    additionalInfo: item.text,
    room: item.salle,
    teacher: item.prof,
    backgroundColor: item.color,
    status: item.isAnnule ? CourseStatus.CANCELED : undefined
  }))
}

function mapCourseKind(kind: TimetableCourseType): CourseType {
  switch (kind) {
  case TimetableCourseType.PERMANENCY:
    return CourseType.ACTIVITY
  default:
    return CourseType.LESSON
  }
}