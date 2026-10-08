
import { Client } from "@blockshub/blocksdirecte";

import { Homework } from "../shared/homework";
import { warn } from "@/utils/logger/logger";
import { formatEcoleDirecteError, isEcoleDirecteServerError } from "./errors";

export async function fetchEDHomeworks(
  session: Client,
  accountId: string,
  weekNumber: number
): Promise<Homework[]> {
  const weekdays = weekNumberToDaysList(weekNumber);
  const response: Homework[] = [];
  for (const date of weekdays) {
    const formattedDate = formatDate(date);

    // A single day with no homework (weekends, holidays) can come back from
    // EcoleDirecte without a `matieres` array at all. Isolating each day in
    // its own try/catch means one such day only skips itself instead of
    // throwing away every other day already collected for the week.
    try {
      const dayResponse = await session.homework.getHomeworksForDate(formattedDate);
      const matieres = unwrapHomeworkSubjects(dayResponse);

      for (const subject of matieres) {
        if (!subject || typeof subject !== "object") {
          continue;
        }
        const homework = subject.aFaire;
        if (!homework) {
          continue;
        }

        const subjectName =
          typeof subject.matiere === "string" && subject.matiere.trim()
            ? subject.matiere.trim()
            : typeof subject.entityLibelle === "string"
              ? subject.entityLibelle.trim()
              : "";

        response.push({
          attachments: [],
          content: homework.contenu ?? "",
          isDone: homework.effectue ?? false,
          dueDate: date,
          id: String(homework.idDevoir ?? ""),
          subject: subjectName,
          evaluation: false,
          custom: false,
          createdByAccount: accountId
        });
      }
    } catch (error) {
      const message = formatEcoleDirecteError(error);
      if (isEcoleDirecteServerError(error)) {
        // A server outage is not an empty homework day; let the shared layer
        // fall back to the last saved homework week.
        throw new Error(message);
      }
      warn(`Skipping ED homework for ${formattedDate}: ${message}`, "fetchEDHomeworks");
    }
  }

  return response
}

type EcoleDirecteHomeworkResponse = Awaited<
  ReturnType<Client["homework"]["getHomeworksForDate"]>
>;
type EcoleDirecteHomeworkSubject = NonNullable<
  EcoleDirecteHomeworkResponse["matieres"]
>[number];

function unwrapHomeworkSubjects(value: unknown): EcoleDirecteHomeworkSubject[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  if (Array.isArray(record.matieres)) {
    return record.matieres as EcoleDirecteHomeworkSubject[];
  }

  if (record.data && typeof record.data === "object") {
    return unwrapHomeworkSubjects(record.data);
  }

  return [];
}

export async function setEDHomeworkAsDone(session: Client, homework: Homework, state?: boolean): Promise<Homework> {
  const finalState = state ?? !homework.isDone
  const homeworkId = Number(homework.id)
  if (!Number.isSafeInteger(homeworkId) || homeworkId <= 0) {
    throw new Error("Identifiant de devoir EcoleDirecte invalide.");
  }
  
  if (finalState) {
    await session.homework.markHomeworkAsDone(homeworkId)
  } else {
    await session.homework.markHomeworkAsUndone(homeworkId)
  }
  return {
    ...homework,
    isDone: finalState
  }
}

import { addDays,format,startOfISOWeek } from "date-fns";

export const weekNumberToDaysList = (weekNumber: number, year?: number): Date[] => {
  const currentYear = year || new Date().getFullYear();
  
  // Trouver le premier jour ISO de l'année (lundi de la semaine 1)
  const jan4 = new Date(currentYear, 0, 4); 
  const firstWeekStart = startOfISOWeek(jan4);
  
  // Calculer le lundi de la semaine demandée
  const weekStart = new Date(firstWeekStart);
  weekStart.setDate(firstWeekStart.getDate() + (weekNumber - 1) * 7);

  // Construire la liste des jours
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
};

export const formatDate = (date: Date): string => {
  return format(date, "yyyy-MM-dd");
};
