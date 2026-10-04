import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getCourseRouteId, useTimetable } from '@/database/useTimetable';
import { useActiveAccountDataSourceIds } from '@/database/accountScope';
import { useLoadErrorAlert } from '@/hooks/useLoadErrorAlert';
import { useManagerSubscription } from '@/hooks/useManagerSubscription';
import type { Course, CourseDay } from '@/services/shared/timetable';
import type { AccountManager } from "@/services/shared";
import { getManager } from "@/services/shared";
import { Capabilities, ServiceFailure } from "@/services/shared/types";
import { useAccountStore } from '@/stores/account';
import { debug, log } from "@/utils/logger/logger";

const getTimetableClientsKey = (manager: AccountManager | null) =>
  manager
    ?.getAvailableClients(Capabilities.TIMETABLE)
    .map(client => String(client.service))
    .sort()
    .join(",") ?? "";

export function useTimetableData(weekNumber: number, currentDate: Date = new Date()) {
  const safeDate = currentDate;
  const [isLoading, setIsLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [failures, setFailures] = useState<ServiceFailure[]>([]);
  const [freshTimetableByWeek, setFreshTimetableByWeek] = useState<Record<string, CourseDay[]>>({});
  const fetchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Weeks are fetched once per session; a ref keeps a swipe back and forth from
  // re-running the effect that starts the fetch.
  const fetchedWeeks = useRef<Set<string>>(new Set());
  const inFlightWeeks = useRef<Set<string>>(new Set());

  const [manager, setManager] = useState(() => getManager(true));
  const managerRef = useRef(manager);
  const managerClientsKey = useRef(getTimetableClientsKey(manager));

  // Read through selectors: switching accounts has to rebuild `services`, or the
  // filter below would keep matching the previous account and hide every course.
  const lastUsedAccount = useAccountStore(state => state.lastUsedAccount);
  const services = useActiveAccountDataSourceIds();

  const rawTimetable = useTimetable(refresh, [weekNumber - 1, weekNumber, weekNumber + 1], safeDate);

  const timetable = useMemo(() => {
    const byCourse = new Map<string, Course>();
    const mergeDays = (days: CourseDay[], preferIncoming: boolean) => {
      for (const day of days) {
        for (const course of day.courses) {
          const identity = `${course.createdByAccount}:${getCourseRouteId(course)}`;
          const existing = byCourse.get(identity);
          if (!existing) {
            byCourse.set(identity, course);
          } else if (preferIncoming) {
            byCourse.set(identity, {
              ...existing,
              ...course,
              customStatus: existing.customStatus ?? course.customStatus,
              manualStatus: existing.manualStatus ?? course.manualStatus,
              fromCache: existing.fromCache,
            });
          }
        }
      }
    };

    mergeDays(rawTimetable, false);
    mergeDays(Object.values(freshTimetableByWeek).flat(), true);

    const byDay = new Map<number, Course[]>();
    for (const course of byCourse.values()) {
      if (
        !services.includes(course.createdByAccount) &&
        !course.createdByAccount.startsWith('ical_')
      ) {
        continue;
      }
      const day = new Date(course.from);
      day.setHours(0, 0, 0, 0);
      const dayKey = day.getTime();
      const courses = byDay.get(dayKey) ?? [];
      courses.push(course);
      byDay.set(dayKey, courses);
    }

    return [...byDay.entries()]
      .sort(([a], [b]) => a - b)
      .map(([timestamp, courses]) => ({
        date: new Date(timestamp),
        courses: courses.sort((a, b) => a.from.getTime() - b.from.getTime()),
      }));
  }, [rawTimetable, freshTimetableByWeek, services]);

  useEffect(() => {
    const activeManager = getManager(true);
    managerRef.current = activeManager;
    managerClientsKey.current = getTimetableClientsKey(activeManager);
    setManager(activeManager);
    fetchedWeeks.current.clear();
    setFreshTimetableByWeek({});
    setError(null);
    setFailures([]);
    setIsLoading(false);
    setManualRefreshing(false);
    setRefresh(value => value + 1);
  }, [lastUsedAccount]);

  const fetchWeeklyTimetable = useCallback(async (targetWeekNumber: number, forceRefresh = false) => {
    setIsLoading(true);
    if (fetchTimeoutRef.current) {
      clearTimeout(fetchTimeoutRef.current);
      fetchTimeoutRef.current = null;
    }

    fetchTimeoutRef.current = setTimeout(async () => {
      if (forceRefresh) {
        setManualRefreshing(true);
      }
      try {
        const managerToUse = getManager(true);
        if (!managerToUse || managerToUse.getAccount().id !== lastUsedAccount) {
          debug('Manager is null, skipping timetable fetch');
          return;
        }

        const targetWeeks = forceRefresh
          ? [targetWeekNumber, targetWeekNumber + 1, targetWeekNumber + 2]
          : [targetWeekNumber, targetWeekNumber - 1, targetWeekNumber + 1];
        const candidates = targetWeeks.map(week => {
          const targetDate = new Date(safeDate);
          targetDate.setDate(targetDate.getDate() + (week - targetWeekNumber) * 7);
          const year = targetDate.getFullYear();
          const key = `${lastUsedAccount}:${year}-${week}`;
          return { week, targetDate, key };
        });

        const toFetch = candidates.filter(c =>
          !inFlightWeeks.current.has(c.key) &&
          (forceRefresh || !fetchedWeeks.current.has(c.key))
        );

        if (toFetch.length > 0) {
          toFetch.forEach(candidate => inFlightWeeks.current.add(candidate.key));
          const freshResults: Record<string, CourseDay[]> = {};
          let firstRequestError: unknown;
          try {
            for (const candidate of toFetch) {
              try {
                const result = await managerToUse.getWeeklyTimetable(candidate.week, candidate.targetDate);
                if (useAccountStore.getState().lastUsedAccount !== managerToUse.getAccount().id) return;
                freshResults[candidate.key] = Array.isArray(result) ? result : [];
                fetchedWeeks.current.add(candidate.key);
              } catch (requestError) {
                firstRequestError ??= requestError;
              }
            }

            if (useAccountStore.getState().lastUsedAccount !== managerToUse.getAccount().id) return;
            if (Object.keys(freshResults).length > 0) {
              setFreshTimetableByWeek(previous => ({ ...previous, ...freshResults }));
              setRefresh(prev => prev + 1);
            }
            if (firstRequestError) {
              throw firstRequestError;
            }
          } finally {
            toFetch.forEach(candidate => inFlightWeeks.current.delete(candidate.key));
          }
        }

        // The manager falls back to the cache rather than throwing, so a service
        // that failed is only visible through its recorded failures.
        setFailures(managerToUse.getFailures(Capabilities.TIMETABLE));
        setError(null);
      } catch (e) {
        log('Error fetching weekly timetable: ' + e);
        const activeManager = getManager(true);
        if (activeManager?.getAccount().id === lastUsedAccount) {
          setFailures(activeManager.getFailures(Capabilities.TIMETABLE));
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        setIsLoading(false);
        setManualRefreshing(false);
        fetchTimeoutRef.current = null;
      }
    }, 100);
  }, [manager, safeDate, lastUsedAccount]);

  useEffect(() => {
    fetchWeeklyTimetable(weekNumber);
  }, [weekNumber, fetchWeeklyTimetable]);

  const handleManager = useCallback((updatedManager: AccountManager) => {
    if (updatedManager.getAccount().id !== useAccountStore.getState().lastUsedAccount) return;
    const clientsKey = getTimetableClientsKey(updatedManager);
    if (managerRef.current === updatedManager && managerClientsKey.current === clientsKey) return;
    managerRef.current = updatedManager;
    managerClientsKey.current = clientsKey;
    setManager(updatedManager);
    fetchedWeeks.current.clear();
    setError(null);
    if (clientsKey) {
      void fetchWeeklyTimetable(weekNumber, true);
    }
  }, [fetchWeeklyTimetable, weekNumber]);

  const handleManagerUnavailable = useCallback(() => {
    setIsLoading(false);
    setManualRefreshing(false);
    setError(new Error("Account manager unavailable"));
  }, []);

  useManagerSubscription(handleManager, handleManagerUnavailable);

  useEffect(() => {
    return () => {
      if (fetchTimeoutRef.current) {
        clearTimeout(fetchTimeoutRef.current);
      }
    };
  }, []);

  const handleRefresh = useCallback(() => {
    setRefresh(prev => prev + 1);
    fetchWeeklyTimetable(weekNumber, true);
  }, [fetchWeeklyTimetable, weekNumber]);

  useLoadErrorAlert({
    subject: "ton emploi du temps",
    error,
    failures,
    hasData: timetable.length > 0,
  });

  return {
    timetable,
    refresh,
    manualRefreshing,
    handleRefresh,
    isLoading,
    error,
    failures,
  };
}
