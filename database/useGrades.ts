import { Model, Q } from "@nozbe/watermelondb";

import { Grade as SharedGrade, Period as SharedPeriod, PeriodGrades as SharedPeriodGrades, Subject as SharedSubject } from "@/services/shared/grade";
import { generateId } from "@/utils/generateId";
import { error, warn } from "@/utils/logger/logger";

import { getDatabaseInstance } from "./DatabaseProvider";
import { mapPeriodToShared } from "./mappers/grade";
import { mapSubjectToShared } from "./mappers/subject";
import { Grade, Period, PeriodGrades } from "./models/Grades";
import Subject from "./models/Subject";
import { safeWrite } from "./utils/safeTransaction";
import { getActiveAccountDataSourceIds } from "./accountScope";

export async function addPeriodsToDatabase(periods: SharedPeriod[]) {
  const db = getDatabaseInstance();

  // Lectures HORS writer : les fetch() avec await DANS le writer perdaient le
  // contexte (« can only be called from inside of a Writer »).
  const toCreate: Array<{ id: string; item: SharedPeriod }> = [];
  for (const item of periods) {
    const id = generateId(item.name + item.createdByAccount);

    const existing = await db.get('periods')
      .query(Q.where("periodId", id), Q.where("createdByAccount", item.createdByAccount))
      .fetch();

    if (existing.length === 0) {
      toCreate.push({ id, item });
    }
  }
  if (toCreate.length === 0) return;

  await safeWrite(db, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prepared: any[] = [];
    for (const { id, item } of toCreate) {
      prepared.push(db.get('periods').prepareCreate((record: Model) => {
        const period = record as Period;
        Object.assign(period, {
          periodId: id,
          name: item.name,
          createdByAccount: item.createdByAccount,
          start: item.start.getTime(),
          end: item.end.getTime(),
        });
      }));
    }
    await db.batch(...prepared);
  }, 10000, 'addPeriodsToDatabase');
}


export async function getPeriodsFromCache(
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedPeriod[]> {
  try {
    const database = getDatabaseInstance();

    const period = await database
      .get<Period>('periods')
      .query(Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__"))
      .fetch();

    return period
      .map(mapPeriodToShared)
      .sort((a, b) => a.end.getTime() - b.end.getTime());
  } catch (e) {
    warn(String(e));
    return [];
  }
}

export async function addGradesToDatabase(grades: SharedGrade[], subject: string) {
  const db = getDatabaseInstance();
  for (const item of grades) {
    const id = generateId(item.createdByAccount + item.description + item.givenAt)

    const existing = await db.get<Grade>('grades').query(
      Q.where('gradeId', id),
      Q.where('createdByAccount', item.createdByAccount)
    ).fetch();

    if(existing.length === 0) {
      await safeWrite(db, async () => {
        await db.get('grades').create((record: Model) => {
          const grade = record as Grade
          Object.assign(grade, {
            gradeId: id,
            createdByAccount: item.createdByAccount,
            subjectName: item.subjectName,
            subjectId: generateId(subject),
            description: item.description,
            givenAt: item.givenAt.getTime(),
            subjectFile: JSON.stringify(item.subjectFile),
            correctionFile: JSON.stringify(item.correctionFile),
            bonus: item.bonus,
            optional: item.optional,
            outOfRaw: JSON.stringify(item.outOf),
            coefficient: item.coefficient,
            studentScoreRaw: JSON.stringify(item.studentScore),
            averageScoreRaw: JSON.stringify(item.averageScore),
            minScoreRaw: JSON.stringify(item.minScore),
            maxScoreRaw: JSON.stringify(item.maxScore)
          })
        })
      }, 10000, 'addGradesToDatabase')
    }
  }
}

export async function addPeriodGradesToDatabase(item: SharedPeriodGrades, period: string) {
  const db = getDatabaseInstance();
  const periodGradeId = generateId(item.createdByAccount + period);
  const periods = await db.get<Period>("periods").query(
    Q.where("name", period),
    Q.where("createdByAccount", item.createdByAccount)
  ).fetch();
  const periodRow = periods[0];
  if (!periodRow) {
    // Do not create an orphaned periodgrade with an empty foreign key. This
    // can happen when the grades response races its periods cache write.
    warn(`Period "${period}" is missing from the local cache for ${item.createdByAccount}; grades were not cached.`);
    return;
  }
  const existingRows = await db.get<PeriodGrades>("periodgrades").query(
    Q.where("periodGradeId", periodGradeId),
    Q.where("createdByAccount", item.createdByAccount)
  ).fetch();
  const existing = existingRows[0];
  const oldSubjects = existing
    ? await db.get<Subject>("subjects").query(Q.where("periodGradeId", existing.id)).fetch()
    : [];
  const oldGrades = await Promise.all(oldSubjects.map(subject =>
    db.get<Grade>("grades").query(Q.where("subjectId", subject.id)).fetch()
  ));

  await safeWrite(db, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prepared: any[] = [];
    let periodGradeRowId = existing?.id;

    if (existing) {
      prepared.push(existing.prepareUpdate((record: Model) => {
        const periodGrade = record as PeriodGrades;
        Object.assign(periodGrade, {
          periodGradeId,
          periodId: periodRow.id,
          createdByAccount: item.createdByAccount,
          studentOverallRaw: JSON.stringify(item.studentOverall ?? {}),
          classAverageRaw: JSON.stringify(item.classAverage ?? {}),
        });
      }));
    } else {
      const preparedPeriod = db.get<PeriodGrades>("periodgrades").prepareCreate((record: Model) => {
        const periodGrade = record as PeriodGrades;
        Object.assign(periodGrade, {
          periodGradeId,
          periodId: periodRow.id,
          createdByAccount: item.createdByAccount,
          studentOverallRaw: JSON.stringify(item.studentOverall ?? {}),
          classAverageRaw: JSON.stringify(item.classAverage ?? {}),
        });
      });
      periodGradeRowId = preparedPeriod.id;
      prepared.push(preparedPeriod);
    }

    for (const grade of oldGrades.flat()) prepared.push(grade.prepareMarkAsDeleted());
    for (const subject of oldSubjects) prepared.push(subject.prepareMarkAsDeleted());

    for (const subject of item.subjects ?? []) {
      const preparedSubject = db.get<Subject>("subjects").prepareCreate((record: Model) => {
        const row = record as Subject;
        Object.assign(row, {
          name: subject.name,
          subjects: JSON.stringify(subject.grades ?? []),
          studentAverageRaw: JSON.stringify(subject.studentAverage ?? {}),
          classAverageRaw: JSON.stringify(subject.classAverage ?? {}),
          maximumRaw: JSON.stringify(subject.maximum ?? {}),
          minimumRaw: JSON.stringify(subject.minimum ?? {}),
          outOfRaw: JSON.stringify(subject.outOf ?? {}),
          periodGradeId: periodGradeRowId,
        });
      });
      prepared.push(preparedSubject);

      for (const grade of subject.grades ?? []) {
        const gradeId = generateId(item.createdByAccount + (grade.id || grade.description) + (grade.givenAt?.getTime() ?? 0));
        prepared.push(db.get<Grade>("grades").prepareCreate((record: Model) => {
          const row = record as Grade;
          Object.assign(row, {
            gradeId,
            createdByAccount: item.createdByAccount,
            subjectName: subject.name,
            subjectId: preparedSubject.id,
            description: grade.description ?? "",
            givenAt: grade.givenAt?.getTime() ?? 0,
            subjectFile: JSON.stringify(grade.subjectFile ?? null),
            correctionFile: JSON.stringify(grade.correctionFile ?? null),
            bonus: grade.bonus ?? false,
            optional: grade.optional ?? false,
            coefficient: grade.coefficient ?? 1,
            outOfRaw: JSON.stringify(grade.outOf ?? {}),
            studentScoreRaw: JSON.stringify(grade.studentScore ?? {}),
            averageScoreRaw: JSON.stringify(grade.averageScore ?? {}),
            minScoreRaw: JSON.stringify(grade.minScore ?? {}),
            maxScoreRaw: JSON.stringify(grade.maxScore ?? {}),
          });
        }));
      }
    }

    if (prepared.length > 0) await db.batch(...prepared);
  }, 10000, 'addPeriodGradesToDatabase');
}

export async function getGradePeriodsFromCache(
  period: string,
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedPeriodGrades | null> {
  if (sourceIds.length === 0) return null;

  const db = getDatabaseInstance();
  const periodRows = await db.get<Period>("periods").query(
    Q.where("name", period),
    Q.where("createdByAccount", Q.oneOf(sourceIds))
  ).fetch();

  for (const periodRow of periodRows) {
    const periodGrades = await db.get<PeriodGrades>("periodgrades").query(
      Q.where("periodId", periodRow.id),
      Q.where("createdByAccount", periodRow.createdByAccount)
    ).fetch();
    const periodGrade = periodGrades[0];
    if (!periodGrade) continue;

    const subjectRows = await db.get<Subject>("subjects").query(
      Q.where("periodGradeId", periodGrade.id)
    ).fetch();
    const subjects: SharedSubject[] = await Promise.all(subjectRows.map(async subject => {
      const grades = await db.get<Grade>("grades").query(
        Q.where("subjectId", subject.id),
        Q.where("createdByAccount", periodRow.createdByAccount)
      ).fetch();
      return mapSubjectToShared(subject, grades);
    }));

    return {
      studentOverall: periodGrade.studentOverall,
      classAverage: periodGrade.classAverage,
      subjects,
      createdByAccount: periodGrade.createdByAccount,
      fromCache: true,
    };
  }

  return null;
}
