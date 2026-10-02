import { useState, useEffect, useMemo, useRef } from 'react';
import { AccountManager, getManager, subscribeManagerUpdate } from '@/services/shared';
import { Attendance } from '@/services/shared/attendance';
import { Period } from '@/services/shared/grade';
import { getCurrentPeriod } from '@/utils/grades/helper/period';
import { useAccountStore } from '@/stores/account';
import { Services } from '@/stores/account/types';
import { useNews } from '@/database/useNews';

export const useHomeHeaderData = () => {
  const accounts = useAccountStore((state) => state.accounts);
  const lastUsedAccount = useAccountStore((state) => state.lastUsedAccount);
  const account = accounts.find((a) => a.id === lastUsedAccount);

  const availableCanteenCards = useMemo(
    () =>
      account?.services.filter(service =>
        [
          Services.TURBOSELF,
          Services.ALISE,
          Services.ARD,
          Services.ECOLEDIRECTE,
          Services.IZLY,
        ].includes(service.serviceId)
      ) ?? [],
    [account]
  );

  const attendancesPeriodsRef = useRef<Period[]>([]);
  const [attendances, setAttendances] = useState<Attendance[]>([]);
  const [attendanceAccountId, setAttendanceAccountId] = useState("");
  const news = useNews();

  const absencesCount = useMemo(() => {
    if (!attendances) return 0;
    let count = 0;
    attendances.forEach(att => {
      if(att && "absences" in att) {
        if (att.absences) count += att.absences.length;
      }
    });
    return count;
  }, [attendances]);

  useEffect(() => {
    const updateAttendance = async (manager: AccountManager) => {
      const managerAccountId = manager.getAccount().id;
      const periods = await manager.getAttendancePeriods();
      if (useAccountStore.getState().lastUsedAccount !== managerAccountId) return;
      attendancesPeriodsRef.current = periods;
      setAttendanceAccountId(managerAccountId);

      const currentPeriod = getCurrentPeriod(periods);
      if (!currentPeriod) {
        setAttendances([]);
        return;
      }

      const fetchedAttendances = await manager.getAttendanceForPeriod(currentPeriod.name);
      if (useAccountStore.getState().lastUsedAccount !== managerAccountId) return;
      setAttendances(fetchedAttendances);
    };

    const unsubscribe = subscribeManagerUpdate((_) => {
      const manager = getManager();
      if (manager) {
        void updateAttendance(manager);
      } else {
        attendancesPeriodsRef.current = [];
        setAttendances([]);
        setAttendanceAccountId("");
      }
    });

    return () => unsubscribe();
  }, []);

  return {
    availableCanteenCards,
    attendancesPeriods: attendanceAccountId === lastUsedAccount ? attendancesPeriodsRef.current : [],
    attendances: attendanceAccountId === lastUsedAccount ? attendances : [],
    absencesCount,
    news
  };
};
