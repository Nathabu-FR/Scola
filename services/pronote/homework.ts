import {
  assignmentsFromWeek,
  assignmentStatus,
  SessionHandle,
  translateToWeekNumber,
} from "@blockshub/pawnote-lts";

import { getDateRangeOfWeek } from "@/database/useHomework";
import { Homework, ReturnFormat } from "@/services/shared/homework";
import { error } from "@/utils/logger/logger";
import { mapPronoteAttachments } from "@/services/pronote/attachments";

/**
  * Fetches homework assignments from PRONOTE for the current week.
  * @param {SessionHandle} session - The session handle for the PRONOTE account.
  * @param {string} accountId - The ID of the account requesting the homeworks.
  * @returns {Promise<Homework[]>} A promise that resolves to an array of Homework objects.
 */
export async function fetchPronoteHomeworks(session: SessionHandle, accountId: string, weekNumberRaw: number): Promise<Homework[]> {
  const result: Homework[] = [];

  if (!session) {
    throw error("Session is undefined", "fetchPronoteHomeworks");
  }

  const { start } = getDateRangeOfWeek(weekNumberRaw)
  const weekNumber = translateToWeekNumber(start, session.instance.firstMonday);
  const homeworks = await assignmentsFromWeek(session, weekNumber);
  for (const homework of Array.isArray(homeworks) ? homeworks : []) {
    if (!homework.subject?.name) continue;
    result.push({
      id: homework.id,
      subject: homework.subject.name,
      content: homework.description ?? "",
      dueDate: homework.deadline,
      isDone: homework.done,
      returnFormat:
        homework.return?.kind === 1 ? ReturnFormat.PAPER : ReturnFormat.FILE_UPLOAD,
      attachments: mapPronoteAttachments(homework.attachments, accountId),
      evaluation: false,
      custom: false,
      createdByAccount: accountId,
    });
  }

  return result;
}

export async function setPronoteHomeworkAsDone(session: SessionHandle, homework: Homework, status?: boolean): Promise<Homework> {
  const finalState = status ?? !homework.isDone;
  // Cached assignments keep their PRONOTE identifier, so the status update can
  // still be sent while the homework list itself is being rendered from cache.
  // Propagate failures so the UI does not show a false local-only tick.
  await assignmentStatus(session, homework.id, finalState);
  return {
    ...homework,
    isDone: finalState,
    progress: finalState ? 1 : 0
  }
}
