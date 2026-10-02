import { Q } from "@nozbe/watermelondb";

import {Attendance as SharedAttendance } from "@/services/shared/attendance";
import { generateId } from "@/utils/generateId";
import { error } from "@/utils/logger/logger";

import { getDatabaseInstance } from "./DatabaseProvider";
import { mapAbsencesToShared, mapDelaysToShared, mapObservationsToShared,mapPunishmentsToShared } from "./mappers/attendance";
import { Absence, Attendance, Delay, Observation, Punishment } from "./models/Attendance";
import { safeWrite } from "./utils/safeTransaction";
import { getActiveAccountDataSourceIds } from "./accountScope";

export async function addAttendanceToDatabase(attendances: SharedAttendance[], period: string) {
  const db = getDatabaseInstance();
  for (const attendance of attendances) {
    const id = generateId(attendance.createdByAccount + period + attendance.kidName);

    // 1) Lectures HORS writer (tout await ici est autorisé).
    const existing = await db.get<Attendance>('attendance').query(
      Q.where('attendanceId', id),
      Q.where('createdByAccount', attendance.createdByAccount)
    ).fetch();
    const existingAttendance = (existing[0] as Attendance | undefined) ?? null;
    const [oldDelays, oldAbsences, oldObservations, oldPunishments] = existingAttendance
      ? await Promise.all([
        existingAttendance.delays.fetch(),
        existingAttendance.absences.fetch(),
        existingAttendance.observations.fetch(),
        existingAttendance.punishments.fetch(),
      ])
      : [[], [], [], []] as const;

    // 2) Un seul writer, 100 % synchrone : pas d'await entre la préparation
    // et le batch. Appeler des sub-writers (update/create/markAsDeleted)
    // après un await faisait perdre le contexte Writer (« can only be called
    // from inside of a Writer »). Ici on prépare tout puis on batch d'un coup.
    // NOTE : attendanceId reste l'id métier généré (pas le row id Watermelon),
    // car les tables enfants le référencent via ce champ (cf. ancien code).
    await safeWrite(db, async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prepared: any[] = [];

      if (existingAttendance) {
        prepared.push(
          existingAttendance.prepareUpdate((record: unknown) => {
            const att = record as Attendance;
            att.createdByAccount = attendance.createdByAccount;
            att.kidName = attendance.kidName ?? undefined;
            att.period = period;
          })
        );
      } else {
        prepared.push(db.get('attendance').prepareCreate((record: unknown) => {
          const att = record as Attendance;
          att.attendanceId = id;
          att.createdByAccount = attendance.createdByAccount;
          att.period = period;
        }));
      }

      for (const record of [...oldDelays, ...oldAbsences, ...oldObservations, ...oldPunishments]) {
        prepared.push(record.prepareMarkAsDeleted());
      }

      for (const delay of attendance.delays) {
        prepared.push(db.get('delays').prepareCreate((record: unknown) => {
          Object.assign(record, {
            givenAt: delay.givenAt.getTime(),
            reason: delay.reason,
            justified: delay.justified,
            duration: delay.duration,
            attendanceId: id,
            kidName: delay.kidName
          });
        }));
      }

      for (const absence of attendance.absences) {
        prepared.push(db.get('absences').prepareCreate((record: unknown) => {
          Object.assign(record, {
            from: absence.from.getTime(),
            to: absence.to.getTime(),
            reason: absence.reason,
            justified: absence.justified,
            attendanceId: id,
            kidName: absence.kidName
          });
        }));
      }

      for (const observation of attendance.observations) {
        prepared.push(db.get('observations').prepareCreate((record: unknown) => {
          Object.assign(record, {
            givenAt: observation.givenAt.getTime(),
            sectionName: observation.sectionName,
            sectionType: observation.sectionType,
            subjectName: observation.subjectName,
            shouldParentsJustify: observation.shouldParentsJustify,
            reason: observation.reason,
            attendanceId: id
          });
        }));
      }

      for (const punishment of attendance.punishments) {
        prepared.push(db.get('punishments').prepareCreate((record: unknown) => {
          Object.assign(record, {
            givenAt: punishment.givenAt.getTime(),
            givenBy: punishment.givenBy,
            exclusion: punishment.exclusion,
            duringLesson: punishment.duringLesson,
            nature: punishment.nature,
            duration: punishment.duration,
            homeworkDocumentsRaw: JSON.stringify(punishment.homework.documents ?? []),
            reasonDocumentsRaw: JSON.stringify(punishment.reason.documents ?? []),
            homeworkText: punishment.homework.text,
            reasonText: punishment.reason.text,
            reasonCircumstances: punishment.reason.circumstances,
            attendanceId: id
          });
        }));
      }

      if (prepared.length > 0) {
        await db.batch(...prepared);
      }
    }, 10000, 'addAttendanceToDatabase');
  }
}


export async function getAttendanceFromCache(
  period: string,
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedAttendance | undefined> {
  try {
    const database = getDatabaseInstance();

    const attendance = await database
      .get<Attendance>('attendance')
      .query(
        Q.where('period', period),
        Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__")
      )
      .fetch();

    if (!attendance[0]) {
      return undefined;
    }
    const att = attendance[0];
    const [delays, absences, punishments, observations] = await Promise.all([
      att.delays.fetch(),
      att.absences.fetch(),
      att.punishments.fetch(),
      att.observations.fetch(),
    ]);

    return {
      createdByAccount: att.createdByAccount,
      delays: mapDelaysToShared(delays, att),
      absences: mapAbsencesToShared(absences, att),
      punishments: mapPunishmentsToShared(punishments),
      observations: mapObservationsToShared(observations),
      fromCache: true,
    };
  } catch (err) {
    error("Failed to fetch attendance from cache: " + String(err));
  }
}
