import { Grade, Period, PeriodGrades } from "@/database/models/Grades";
import { Attachment } from "@/services/shared/attachment";
import { Grade as SharedGrade, Period as SharedPeriod, PeriodGrades as SharedPeriodGrades, Subject as SharedSubject } from "@/services/shared/grade";

export function mapPeriodToShared(period: Period): SharedPeriod {
  return {
    name: period.name,
    id: period.id,
    start: new Date(period.start),
    end: new Date(period.end),
    createdByAccount: period.createdByAccount,
    kidName: period.kidName,
    fromCache: true
  }
}

export function mapGradeToShared(grade: Grade): SharedGrade {
  const parseAttachment = (value?: string): Attachment | undefined => {
    if (!value) return undefined;
    try {
      return JSON.parse(value) as Attachment;
    } catch {
      return undefined;
    }
  };

  return {
    id: grade.gradeId,
    subjectName: grade.subjectName,
    subjectId: grade.subjectId ?? "",
    description: grade.description,
    givenAt: new Date(grade.givenAt),
    subjectFile: parseAttachment(grade.subjectFile),
    correctionFile: parseAttachment(grade.correctionFile),
    bonus: grade.bonus,
    optional: grade.optional,
    outOf: grade.outOf,
    coefficient: grade.coefficient,
    studentScore: grade.studentScore,
    averageScore: grade.averageScore,
    minScore: grade.minScore,
    maxScore: grade.maxScore,
    fromCache: true,
    createdByAccount: grade.createdByAccount
  }
}

export function mapPeriodGradesToShared(data: PeriodGrades, subjects: SharedSubject[] = []): SharedPeriodGrades {
  return {
    studentOverall: data.studentOverall,
    classAverage: data.classAverage,
    subjects,
    createdByAccount: data.createdByAccount
  }
}
