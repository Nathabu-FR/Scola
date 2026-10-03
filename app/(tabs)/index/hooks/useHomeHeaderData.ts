import { useState, useEffect, useMemo, useRef } from 'react';
import { AccountManager, getManager, subscribeManagerUpdate } from '@/services/shared';
import { Attendance } from '@/services/shared/attendance';
import { Period } from '@/services/shared/grade';
import { getCurrentPeriod } from '@/utils/grades/helper/period';
import { warn } from '@/utils/logger/logger';
import { useAccountStore } from '@/stores/account';
import { Services } from '@/stores/account/types';
import { useNews } from '@/database/useNews';

export const useHomeHeaderData = () => {
  const lastUsedAccount = useAccountStore((state) => state.lastUsedAccount);
  const serviceOptionsKey = useAccountStore(state => {
    const account = state.accounts.find(item => item.id === state.lastUsedAccount);
    return JSON.stringify(account?.services.map(({ id, serviceId }) => ({ id, serviceId })) ?? []);
  });
  const serviceOptions = useMemo(
    () => JSON.parse(serviceOptionsKey) as { id: string; serviceId: Services }[],
    [serviceOptionsKey]
  );

  const availableCanteenCards = useMemo(
    () =>
      serviceOptions.filter(service =>
        [
          Services.TURBOSELF,
          Services.ALISE,
          Services.ARD,
          Services.ECOLEDIRECTE,
          Services.IZLY,
        ].includes(service.serviceId)
      ),
    [serviceOptions]
  );

  const attendancesPeriodsRef = useRef<Period[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [attendanceAccountId, setAttendanceAccountId] = useState("");
  const attendanceRequestId = useRef(0);
  const news = useNews();

  const absencesCount = useMemo(() => {
    if (attendanceAccountId !== lastUsedAccount) return 0;
    if (!attendances) return 0;
    let count = 0;
    attendances.forEach(att => {
      if(att && "absences" in att) {
        if (att.absences) count += att.absences.length;
      }
    });
    return count;
  }, [attendances, attendanceAccountId, lastUsedAccount]);

  useEffect(() => {
    attendancesPeriodsRef.current = [];
    setAttendances([]);
    setAttendanceAccountId("");
    attendanceRequestId.current++;
  }, [lastUsedAccount]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const updateAttendance = async (manager: AccountManager, requestId: number) => {
      const managerAccountId = manager.getAccount().id;
      const periods = await manager.getAttendancePeriods();
      if (requestId !== attendanceRequestId.current || useAccountStore.getState().lastUsedAccount !== managerAccountId) return;
      attendancesPeriodsRef.current = periods;
      setAttendanceAccountId(managerAccountId);

      const currentPeriod = getCurrentPeriod(periods);
      if (!currentPeriod) {
        setAttendances([]);
        return;
      }

      const fetchedAttendances = await manager.getAttendanceForPeriod(currentPeriod.name);
      if (requestId !== attendanceRequestId.current || useAccountStore.getState().lastUsedAccount !== managerAccountId) return;
      setAttendances(fetchedAttendances);
    };

    const unsubscribe = subscribeManagerUpdate((updatedManager) => {
      if (timer) clearTimeout(timer);
      const requestId = ++attendanceRequestId.current;
      const manager = getManager(true) ?? updatedManager;
      if (manager) {
        // Attendance counts are secondary home content. Let timetable,
        // homework, and grades start first instead of sending another request
        // through the desktop IPC bridge in the same burst.
        timer = setTimeout(() => {
          timer = undefined;
          void updateAttendance(manager, requestId).catch(error => {
            warn(`Unable to refresh home attendance summary: ${String(error)}`, "useHomeHeaderData");
          });
        }, 1200);
      } else {
        attendancesPeriodsRef.current = [];
        setAttendances([]);
        setAttendanceAccountId("");
      }
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
      attendanceRequestId.current++;
    };
  }, []);

  return {
    availableCanteenCards,
    attendancesPeriods: attendanceAccountId === lastUsedAccount ? attendancesPeriodsRef.current : [],
    attendances: attendanceAccountId === lastUsedAccount ? attendances : [],
    absencesCount,
    news
  };
};
