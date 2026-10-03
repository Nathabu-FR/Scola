import { useEffect, useMemo, useState } from "react";
import { createMMKV } from "react-native-mmkv";

import { useTimetable } from "@/database/useTimetable";
import { getWeekNumberFromDate } from "@/database/useHomework";
import { getAccountDataSourceIds } from "@/database/accountScope";
import { COURSE_CANCELLED_LABEL, Course as SharedCourse, CourseStatus, getManualCourseStatus } from "@/services/shared/timetable";
import { useAccountStore } from "@/stores/account";

const widgetCacheStorage = createMMKV({ id: "home-widget-cache" });

const REFRESH_INTERVAL_MS = 30_000;

const NO_COURSES: SharedCourse[] = [];

export type UpcomingCourseDay = {
  date: Date;
  courses: SharedCourse[];
};

type CachedCourse = Omit<SharedCourse, "from" | "to"> & {
  from: number;
  to: number;
};

type TimetableWidgetCache = {
  fetchedAt: number;
  courses: CachedCourse[];
};

const serializeCourse = (course: SharedCourse): CachedCourse => ({
  ...course,
  from: course.from.getTime(),
  to: course.to.getTime()
});

const deserializeCourse = (course: CachedCourse): SharedCourse => ({
  ...course,
  from: new Date(course.from),
  to: new Date(course.to)
});

const startOfLocalDay = (date: Date): Date => {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
};

const sameCourses = (a: SharedCourse[], b: SharedCourse[]) =>
  a.length === b.length &&
  a.every((course, index) => {
    const other = b[index];
    return (
      course.id === other.id &&
      course.from.getTime() === other.from.getTime() &&
      course.to.getTime() === other.to.getTime() &&
      course.status === other.status &&
      course.customStatus === other.customStatus &&
      course.manualStatus === other.manualStatus
    );
  });

const sameDays = (a: UpcomingCourseDay[], b: UpcomingCourseDay[]) =>
  a.length === b.length &&
  a.every(
    (day, index) =>
      day.date.getTime() === b[index].date.getTime() &&
      sameCourses(day.courses, b[index].courses)
  );

export const useTimetableWidgetData = (options: { showCancelled?: boolean } = {}) => {
  const showCancelled = options.showCancelled ?? false;
  const [now, setNow] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [upcomingDays, setUpcomingDays] = useState<UpcomingCourseDay[]>([]);

  // The account object is replaced whenever credentials refresh. Keep this
  // database observer keyed to the actual profile/source ids so token updates
  // don't unsubscribe, clear the widget and scan the timetable again.
  const accountScope = useAccountStore(state => {
    const account = state.accounts.find(item => item.id === state.lastUsedAccount);
    return account
      ? JSON.stringify({ accountId: account.id, sourceIds: getAccountDataSourceIds(account) })
      : "";
  });
  const { accountId, services } = useMemo((): { accountId?: string; services: string[] } => {
    if (!accountScope) return { accountId: undefined, services: [] };
    const scope = JSON.parse(accountScope) as { accountId: string; sourceIds: string[] };
    return { accountId: scope.accountId, services: scope.sourceIds };
  }, [accountScope]);
  // Scoped by `showCancelled` so callers that keep cancelled courses don't seed
  // the ones that filter them out.
  const cacheKey = useMemo(
    () =>
      accountId
        ? `widget:timetable:${accountId}:${showCancelled ? "all" : "active"}`
        : undefined,
    [accountId, showCancelled]
  );

  // The home widget only needs upcoming lessons. Querying all 54 weeks of the
  // current year plus all 54 weeks of the next year made startup scan the
  // entire timetable database twice. Keep a small rolling window instead.
  const upcomingWeekGroups = useMemo(() => {
    const groups = new Map<number, Set<number>>();
    for (let offset = 0; offset < 8; offset += 1) {
      const date = new Date(now);
      date.setDate(date.getDate() + offset * 7);
      const year = date.getFullYear();
      const week = getWeekNumberFromDate(date);
      if (!groups.has(year)) groups.set(year, new Set());
      groups.get(year)!.add(week);
    }
    return Array.from(groups.entries()).map(([year, weeks]) => ({
      year,
      weeks: Array.from(weeks).sort((a, b) => a - b),
    }));
  }, [now]);

  const currentYearGroup = upcomingWeekGroups.find(group => group.year === now.getFullYear());
  const nextYearGroup = upcomingWeekGroups.find(group => group.year !== now.getFullYear())
    ?? { year: now.getFullYear() + 1, weeks: [1] };
  const currentYearTimetable = useTimetable(
    undefined,
    currentYearGroup?.weeks ?? [getWeekNumberFromDate(now)],
    now
  );
  const nextYearTimetable = useTimetable(
    undefined,
    nextYearGroup.weeks,
    new Date(nextYearGroup.year, 0, 1)
  );

  const weeklyTimetable = useMemo(() =>
    [...currentYearTimetable, ...nextYearTimetable]
      .map(day => ({
        ...day,
        courses: day.courses.filter(course =>
          services.includes(course.createdByAccount) || course.createdByAccount.startsWith('ical_')
        )
      }))
      .filter(day => day.courses.length > 0),
    [currentYearTimetable, nextYearTimetable, services]
  );

  useEffect(() => {
    const interval = setInterval(() => {
      setNow(new Date());
    }, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  // Seeds the last known day of courses so consumers have something to render
  // before the database query resolves.
  useEffect(() => {
    setUpcomingDays([]);

    if (!cacheKey) {
      setLoading(false);
      return;
    }

    const cachedRaw = widgetCacheStorage.getString(cacheKey);
    if (!cachedRaw) {
      setLoading(false);
      return;
    }

    try {
      const cached = JSON.parse(cachedRaw) as TimetableWidgetCache;
      const courses = cached.courses
        .map(deserializeCourse)
        .filter((course) => services.includes(course.createdByAccount) || course.createdByAccount.startsWith("ical_"))
        .filter((course) => course.to.getTime() > Date.now())
        .filter((course) => showCancelled || (course.status !== CourseStatus.CANCELED && getManualCourseStatus(course) !== COURSE_CANCELLED_LABEL))
        .sort((a, b) => a.from.getTime() - b.from.getTime());

      if (courses.length > 0) {
        setUpcomingDays([{ date: startOfLocalDay(courses[0].from), courses }]);
      }
    } catch {
      widgetCacheStorage.remove(cacheKey);
    } finally {
      setLoading(false);
    }
  }, [cacheKey, services, showCancelled]);

  useEffect(() => {
    // An empty timetable also means "not read yet", so the seeded cache is kept
    // instead of being flashed away on every mount.
    if (weeklyTimetable.length === 0) {
      return;
    }

    const nowTimestamp = now.getTime();
    const days = weeklyTimetable
      .map((day) => ({
        date: day.date,
        courses: day.courses
          .filter((course) => course.to.getTime() > nowTimestamp)
          .filter((course) => showCancelled || (course.status !== CourseStatus.CANCELED && getManualCourseStatus(course) !== COURSE_CANCELLED_LABEL))
          .sort((a, b) => a.from.getTime() - b.from.getTime())
      }))
      .filter((day) => day.courses.length > 0)
      .sort((a, b) => a.courses[0].from.getTime() - b.courses[0].from.getTime());

    setUpcomingDays((previous) => (sameDays(previous, days) ? previous : days));
    setLoading(false);

    if (cacheKey) {
      const payload: TimetableWidgetCache = {
        fetchedAt: Date.now(),
        courses: (days[0]?.courses ?? []).map(serializeCourse)
      };
      widgetCacheStorage.set(cacheKey, JSON.stringify(payload));
    }
  }, [weeklyTimetable, now, cacheKey, showCancelled]);

  const courses = upcomingDays[0]?.courses ?? NO_COURSES;

  return { courses, upcomingDays, loading };
};
