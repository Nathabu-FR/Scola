import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useAccountStore } from "@/stores/account";
import { useActiveAccountDataSourceIds } from "@/database/accountScope";
import type { AccountManager } from "@/services/shared";
import { getManager } from "@/services/shared";
import { Homework } from "@/services/shared/homework";
import { getDateRangeOfWeek, useHomeworkForWeeks, updateHomeworkIsDone } from "@/database/useHomework";
import { useLoadErrorAlert } from "@/hooks/useLoadErrorAlert";
import { useManagerSubscription } from "@/hooks/useManagerSubscription";
import { Capabilities, ServiceFailure } from "@/services/shared/types";
import { generateId } from "@/utils/generateId";
import { error, warn } from '@/utils/logger/logger';
import { trackAdvancedEvent } from '@/utils/logger/analytics';
import { notificationAsync, NotificationFeedbackType } from "expo-haptics";
import { getCurrentWeekIndex } from "../utils/weekGrid";

// Cache reads are coalesced over this window: fetching five weeks would
// otherwise re-query every one of them five times over.
const REFRESH_COALESCE_MS = 120;
const SHARED_HOMEWORK_CACHE_TTL_MS = 5 * 60 * 1000;

type SharedHomeworkRequest = {
  expiresAt: number;
  pending: boolean;
  promise: Promise<Homework[]>;
};

// Home and Tasks can be mounted at the same time and ask for overlapping weeks.
// Share their service requests so opening Tasks does not download the same week
// a second time immediately after the home screen already loaded it.
const sharedHomeworkRequests = new WeakMap<AccountManager, Map<string, SharedHomeworkRequest>>();

const getHomeworkClientsKey = (manager: AccountManager | null) =>
  manager
    ?.getAvailableClients(Capabilities.HOMEWORK)
    .map(client => String(client.service))
    .sort()
    .join(",") ?? "";

const fetchSharedHomeworkWeek = (
  manager: AccountManager,
  week: number,
  force: boolean
): Promise<Homework[]> => {
  const key = `${manager.getAccount().id}:${new Date().getFullYear()}:${week}`;
  let weeks = sharedHomeworkRequests.get(manager);
  if (!weeks) {
    weeks = new Map();
    sharedHomeworkRequests.set(manager, weeks);
  }

  const cached = weeks.get(key);
  if (cached && (cached.pending || (!force && cached.expiresAt > Date.now()))) {
    return cached.promise;
  }

  const request: SharedHomeworkRequest = {
    expiresAt: 0,
    pending: true,
    promise: Promise.resolve([]),
  };
  request.promise = manager.getHomeworks(week).then(
    homeworks => {
      request.pending = false;
      request.expiresAt = Date.now() + SHARED_HOMEWORK_CACHE_TTL_MS;
      return homeworks;
    },
    error => {
      request.pending = false;
      if (weeks?.get(key) === request) {
        weeks.delete(key);
      }
      throw error;
    }
  );
  weeks.set(key, request);
  return request.promise;
};

const homeworkKey = (homework: Homework) =>
  generateId(
    homework.subject +
    homework.content +
    homework.createdByAccount +
    new Date(homework.dueDate).toDateString()
  );

const homeworkIdentity = (homework: Homework) =>
  homework.custom && homework.id
    ? `${homework.createdByAccount}:custom:${homework.id}`
    : homeworkKey(homework);

// Older caches and third-party services can omit fields that the Homework
// type normally guarantees. One malformed row must not crash the whole Tasks
// tab while rendering a week.
const normalizeHomework = (value: unknown, fallbackAccountId: string): Homework | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const homework = value as Partial<Homework>;
  const dueDate = homework.dueDate instanceof Date
    ? homework.dueDate
    : new Date(String(homework.dueDate ?? ""));
  if (!Number.isFinite(dueDate.getTime())) {
    return undefined;
  }

  return {
    ...homework,
    id: typeof homework.id === "string" ? homework.id : "",
    subject: typeof homework.subject === "string" ? homework.subject : "",
    content: typeof homework.content === "string" ? homework.content : "",
    dueDate,
    isDone: homework.isDone === true,
    attachments: Array.isArray(homework.attachments) ? homework.attachments : [],
    evaluation: homework.evaluation === true,
    custom: homework.custom === true,
    createdByAccount:
      typeof homework.createdByAccount === "string" && homework.createdByAccount
        ? homework.createdByAccount
        : fallbackAccountId,
  } as Homework;
};

// Every cache read rebuilds its objects from the database, so identity alone
// says nothing about whether anything changed. Comparing the fields that reach
// the UI lets the previous object be kept, which is what stops one week's
// refresh from re-rendering every mounted page.
const isSameHomework = (a: Homework, b: Homework) =>
  a.id === b.id &&
  a.isDone === b.isDone &&
  a.subject === b.subject &&
  a.content === b.content &&
  a.custom === b.custom &&
  a.evaluation === b.evaluation &&
  a.returnFormat === b.returnFormat &&
  a.fromCache === b.fromCache &&
  a.attachments.length === b.attachments.length &&
  new Date(a.dueDate).getTime() === new Date(b.dueDate).getTime();

const isSameList = (a: Homework[], b: Homework[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

/**
 * Loads every week the pager may show, not just the one on screen: the weeks
 * are passed in most-wanted first, and each one is fetched independently so a
 * slow neighbour never holds back the visible week. Weeks come back already
 * merged with the freshly fetched homework, as arrays whose identity only
 * changes when that week's contents actually did.
 */
export const useHomeworkData = (
  weeks: number[],
  alert: any,
  options: { deferRemainingWeeks?: boolean } = {}
) => {
  const deferRemainingWeeks = options.deferRemainingWeeks ?? false;
  const [refreshingWeek, setRefreshingWeek] = useState<number | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const [homework, setHomework] = useState<Record<string, Homework>>({});
  const [loadedWeeks, setLoadedWeeks] = useState<Record<number, true>>({});

  const lastUsedAccount = useAccountStore(state => state.lastUsedAccount);
  // A refreshed auth token replaces the Account object. Subscribe to the
  // stable source ids so that doesn't rebuild task caches or retrigger fetches.
  const accountSources = useActiveAccountDataSourceIds();
  const services = useMemo(
    () => accountSources.filter(sourceId => sourceId !== lastUsedAccount),
    [accountSources, lastUsedAccount]
  );

  const [manager, setManager] = useState(() => getManager(true));
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [failures, setFailures] = useState<ServiceFailure[]>([]);

  const cacheByWeek = useHomeworkForWeeks(weeks, refreshTrigger);

  const itemCache = useRef<Map<string, Homework>>(new Map());
  const weekCache = useRef<Record<number, Homework[]>>({});

  const homeworkByWeek = useMemo(() => {
    const previousItems = itemCache.current;
    const nextItems = new Map<string, Homework>();
    const previousWeeks = weekCache.current;
    const nextWeeks: Record<number, Homework[]> = {};

    // Network results must remain visible even if WatermelonDB is temporarily
    // busy and the service manager has to skip its cache write. Previously the
    // screen rendered only cacheByWeek, silently discarding those fresh rows.
    const weekNumbers = new Set([
      ...Object.keys(cacheByWeek).map(Number),
      ...Object.keys(loadedWeeks).map(Number),
    ]);

    for (const week of weekNumbers) {
      const { start, end } = getDateRangeOfWeek(week);
      const itemsByIdentity = new Map<string, Homework>();
      for (const value of cacheByWeek[week] ?? []) {
        const cached = normalizeHomework(value, lastUsedAccount ?? "");
        if (
          !cached ||
          (!services.includes(cached.createdByAccount) &&
            !(cached.custom && cached.createdByAccount === lastUsedAccount))
        ) {
          continue;
        }

        const identity = homeworkIdentity(cached);
        const fresh = homework[cached.id] ?? homework[homeworkKey(cached)];
        itemsByIdentity.set(identity, fresh ? { ...cached, ...fresh, id: cached.id || fresh.id } : cached);
      }

      for (const value of Object.values(homework)) {
        const fresh = normalizeHomework(value, lastUsedAccount ?? "");
        if (
          !fresh ||
          fresh.dueDate < start ||
          fresh.dueDate > end ||
          (!services.includes(fresh.createdByAccount) &&
            !(fresh.custom && fresh.createdByAccount === lastUsedAccount))
        ) {
          continue;
        }

        const identity = homeworkIdentity(fresh);
        const cached = itemsByIdentity.get(identity);
        itemsByIdentity.set(
          identity,
          cached ? { ...cached, ...fresh, id: cached.id || fresh.id, fromCache: cached.fromCache } : fresh
        );
      }

      const items = [...itemsByIdentity.entries()]
        .sort(([, a], [, b]) => a.dueDate.getTime() - b.dueDate.getTime())
        .map(([identity, merged]) => {
          const previous = previousItems.get(identity);
          const item = previous && isSameHomework(previous, merged) ? previous : merged;
          nextItems.set(identity, item);
          return item;
        });

      const previous = previousWeeks[week];
      nextWeeks[week] = previous && isSameList(previous, items) ? previous : items;
    }

    itemCache.current = nextItems;
    weekCache.current = nextWeeks;
    return nextWeeks;
  }, [cacheByWeek, homework, loadedWeeks, services, lastUsedAccount]);

  // A week is fetched from the service once per session; `inFlightWeeks` keeps a
  // swipe back and forth from queueing the same request twice.
  const fetchedWeeks = useRef<Set<number>>(new Set());
  const inFlightWeeks = useRef<Map<number, { promise: Promise<void>; forced: boolean }>>(new Map());
  const forceAfterCurrentWeeks = useRef<Set<number>>(new Set());
  const fetchWeekRef = useRef<((week: number, managerToUse?: AccountManager, force?: boolean) => Promise<void>) | null>(null);
  const weeksRef = useRef(weeks);
  weeksRef.current = weeks;
  const prefetchGeneration = useRef(0);
  const prefetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const managerRef = useRef(manager);
  const managerClientsKey = useRef(getHomeworkClientsKey(manager));

  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) {
      return;
    }
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      setRefreshTrigger(p => p + 1);
    }, REFRESH_COALESCE_MS);
  }, []);

  useEffect(() => () => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
    }
    prefetchGeneration.current++;
    if (prefetchTimer.current) {
      clearTimeout(prefetchTimer.current);
    }
  }, []);

  const fetchWeek = useCallback(
    async (week: number, managerToUse = manager, force = false) => {
      if (
        !managerToUse ||
        managerToUse.getAccount().id !== useAccountStore.getState().lastUsedAccount
      ) { return; }
      // Do not cache an empty fallback while account services are still being
      // initialized. The manager listener retries once homework-capable clients appear.
      if (getHomeworkClientsKey(managerToUse) === "") { return; }
      const activeRequest = inFlightWeeks.current.get(week);
      if (activeRequest) {
        // A manual refresh must not silently reuse an older request already
        // underway. Queue one real forced request as soon as that request ends.
        if (force && !activeRequest.forced) forceAfterCurrentWeeks.current.add(week);
        await activeRequest.promise;
        if (forceAfterCurrentWeeks.current.delete(week)) {
          await fetchWeekRef.current?.(week, managerToUse, true);
        }
        return;
      }
      if (!force && fetchedWeeks.current.has(week)) { return; }

      const request: { promise: Promise<void>; forced: boolean } = {
        promise: Promise.resolve(),
        forced: force,
      };
      const runRequest = async () => {
        try {
          const result = await fetchSharedHomeworkWeek(managerToUse, week, force);
          if (managerToUse.getAccount().id !== useAccountStore.getState().lastUsedAccount) return;
          const fetched: Record<string, Homework> = {};
          for (const value of result) {
            const hw = normalizeHomework(value, managerToUse.getAccount().id);
            if (!hw) {
              continue;
            }
            const id = homeworkKey(hw);
            fetched[id] = { ...hw, id: hw.id || id };
          }
          fetchedWeeks.current.add(week);
          setHomework(prev => ({ ...prev, ...fetched }));
          setLoadedWeeks(prev => ({ ...prev, [week]: true }));
          scheduleRefresh();
          // The manager falls back to the cache rather than throwing, so a service
          // that failed is only visible through its recorded failures.
          setFailures(managerToUse.getFailures(Capabilities.HOMEWORK));
          setLoadError(null);
        } catch (e) {
          if (managerToUse.getAccount().id !== useAccountStore.getState().lastUsedAccount) return;
          error("Fetch error", String(e));
          setFailures(managerToUse.getFailures(Capabilities.HOMEWORK));
          setLoadError(e instanceof Error ? e : new Error(String(e)));
        } finally {
          if (inFlightWeeks.current.get(week) === request) inFlightWeeks.current.delete(week);
        }
      };
      request.promise = Promise.resolve().then(runRequest);
      inFlightWeeks.current.set(week, request);
      await request.promise;
      if (forceAfterCurrentWeeks.current.delete(week)) {
        await fetchWeekRef.current?.(week, managerToUse, true);
      }
    },
    [manager, scheduleRefresh]
  );
  fetchWeekRef.current = fetchWeek;

  const fetchWeeks = useCallback((
    weeksToFetch: number[],
    managerToUse: AccountManager | null,
    force: boolean
  ) => {
    prefetchGeneration.current++;
    const generation = prefetchGeneration.current;
    if (prefetchTimer.current) {
      clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }

    if (!deferRemainingWeeks || weeksToFetch.length <= 1) {
      // School-service sessions can return incomplete data when several weeks
      // are requested at once. Fetch the visible week first, then its neighbours.
      void (async () => {
        for (const week of weeksToFetch) {
          if (prefetchGeneration.current !== generation) return;
          await fetchWeek(week, managerToUse ?? undefined, force);
        }
      })();
      return;
    }

    // Load the visible week first. Non-visible weeks still fill the home
    // preview cache, but are staggered so four Pronote requests don't all
    // parse and write at once during the first interactive seconds.
    void fetchWeek(weeksToFetch[0], managerToUse ?? undefined, force);
    let nextIndex = 1;
    const fetchNext = () => {
      if (prefetchGeneration.current !== generation || nextIndex >= weeksToFetch.length) return;
      const week = weeksToFetch[nextIndex++];
      void fetchWeek(week, managerToUse ?? undefined, force).finally(() => {
        if (prefetchGeneration.current === generation && nextIndex < weeksToFetch.length) {
          prefetchTimer.current = setTimeout(fetchNext, 1000);
        }
      });
    };
    prefetchTimer.current = setTimeout(fetchNext, 2500);
  }, [deferRemainingWeeks, fetchWeek]);

  const weeksKey = weeks.join(",");
  useEffect(() => {
    fetchWeeks(weeksRef.current, manager, false);
  }, [weeksKey, fetchWeeks, manager]);

  useEffect(() => {
    const activeManager = getManager(true);
    managerRef.current = activeManager;
    managerClientsKey.current = getHomeworkClientsKey(activeManager);
    setManager(activeManager);
    setHomework({});
    setLoadedWeeks({});
    setRefreshingWeek(null);
    setLoadError(null);
    setFailures([]);
    itemCache.current.clear();
    weekCache.current = {};
    fetchedWeeks.current.clear();
    inFlightWeeks.current.clear();
    forceAfterCurrentWeeks.current.clear();
    prefetchGeneration.current++;
    if (prefetchTimer.current) {
      clearTimeout(prefetchTimer.current);
      prefetchTimer.current = null;
    }
  }, [lastUsedAccount]);

  const handleManager = useCallback((updatedManager: AccountManager) => {
    if (updatedManager.getAccount().id !== useAccountStore.getState().lastUsedAccount) return;
    // A manager can be refreshed in place. Retry if that refresh installed or
    // removed a homework-capable service, even though the manager identity stayed put.
    const clientsKey = getHomeworkClientsKey(updatedManager);
    if (managerRef.current === updatedManager && managerClientsKey.current === clientsKey) { return; }
    managerRef.current = updatedManager;
    managerClientsKey.current = clientsKey;
    setManager(updatedManager);
    fetchedWeeks.current.clear();
    setLoadError(null);
    fetchWeeks(weeksRef.current, updatedManager, true);
  }, [fetchWeeks]);

  // Without a manager nothing is ever fetched: say so rather than leaving the
  // week looking like it simply has no homework.
  const handleManagerUnavailable = useCallback(() => {
    setRefreshingWeek(null);
    setLoadError(new Error("Account manager unavailable"));
  }, []);

  useManagerSubscription(handleManager, handleManagerUnavailable);

  const handleRefresh = useCallback(
    async (week: number) => {
      setRefreshingWeek(week);
      try {
        // Refresh the current window even if the pager is showing a different
        // week, and also refresh the visible week so its contents update now.
        const currentWeek = getCurrentWeekIndex();
        const targetWeeks = [...new Set([currentWeek, currentWeek + 1, currentWeek + 2, week])]
          .sort((a, b) => a - b);
        for (const targetWeek of targetWeeks) {
          await fetchWeek(targetWeek, manager, true);
        }
      } finally {
        setRefreshingWeek(null);
      }
    },
    [fetchWeek, manager]
  );

  const setAsDone = useCallback(
    async (item: Homework, done: boolean) => {
      // L'ancien id local (homeworkKey) ne correspond pas toujours au
      // homeworkId stocké (custom → id réel, importés → hash). On résout
      // d'abord l'id de route officiel, sinon la MAJ locale échouait
      // silencieusement (« cocher ne fonctionne pas »). Si le record n'est
      // pas en cache, on l'y insère d'abord pour que la case reste fiable.
      const { getHomeworkRouteId, addCustomHomeworkToDatabase } = await import("@/database/useHomework");
      const id = getHomeworkRouteId(item);

      try {
        // Persist the checkbox locally first. Some school services, including
        // PRONOTE configurations that expose read-only homework, cannot update
        // completion remotely; that must not make the control appear broken.
        try {
          await updateHomeworkIsDone(id, done);
        } catch (cacheMiss) {
          // Item réseau jamais persisté (ou id réseau brut) : on le matérialise
          // en cache puis on applique l'état — sans ça, updateHomeworkIsDone
          // levait « Homework with ID … not found » et la case restait figée.
          await addCustomHomeworkToDatabase({ ...item, id, isDone: done });
        }
        setHomework(prev => ({
          ...prev,
          [id]: {
            ...(prev[id] ?? item),
            isDone: done,
          }
        }));
        scheduleRefresh();

        if (!item.custom) {
          const accountManager = getManager();
          if (accountManager) {
            try {
              await accountManager.setHomeworkCompletion(item, done);
            } catch (remoteError) {
              warn(`Could not sync homework completion with the school service: ${String(remoteError)}`);
            }
          }
        }
        if (done) {
          notificationAsync(NotificationFeedbackType.Success);
        }
        trackAdvancedEvent(done ? "task_ticked" : "task_unticked");
      }
      catch (err) {
        alert.showAlert({
            title: "Une erreur est survenue",
            message: "Ce devoir n'a pas été mis à jour",
            description:
              "Nous n'avons pas réussi à mettre à jour l'état du devoir, si ce devoir est important, merci de te rendre sur l'application officielle de ton établissement afin de définir son état.",
            color: "#D60046",
            icon: "AlertTriangle",
            technical: String(err)
          });

      }
    },
    [alert, scheduleRefresh]
  );

  const hasData = Object.values(homeworkByWeek).some(list => list.length > 0);
  useLoadErrorAlert({
    subject: "tes devoirs",
    error: loadError,
    failures,
    hasData,
  });

  return {
    homeworkByWeek,
    refreshingWeek,
    handleRefresh,
    setAsDone,
    error: loadError,
    failures,
  };
};
