import Subject from "@/database/models/Subject";
import { Grade as SharedGrade, Subject as SharedSubject } from "@/services/shared/grade";
import { Grade } from "@/database/models/Grades";

export function mapSubjectToShared(subject: Subject, grades: Grade[] = []): SharedSubject {
  const { mapGradeToShared } = require("@/database/mappers/grade") as typeof import("@/database/mappers/grade");
  return {
    id: subject.id,
    name: subject.name,
    studentAverage: subject.studentAverage,
    classAverage: subject.classAverage,
    maximum: subject.maximum,
    minimum: subject.minimum,
    outOf: subject.outOf,
    grades: grades.map(mapGradeToShared) as SharedGrade[]
  }
}
