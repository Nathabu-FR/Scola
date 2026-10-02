import { Model, Q } from "@nozbe/watermelondb";

import { Kid as SharedKid } from "@/services/shared/kid";
import { warn } from "@/utils/logger/logger";

import { getDatabaseInstance } from "./DatabaseProvider";
import { mapKidsToShared } from "./mappers/kids";
import Kid from "./models/Kid";
import { safeWrite } from "./utils/safeTransaction";
import { getActiveAccountDataSourceIds } from "./accountScope";

export async function addKidToDatabase(kids: SharedKid[]) {
  const db = getDatabaseInstance()
  for (const kid of kids) {
    const existingRecords = await db.get<Kid>('kids')
      .query(Q.where('kidId', kid.id))
      .fetch();
    const existing = existingRecords.find(record => record.createdByAccount === kid.createdByAccount)
      // Claim the single legacy row written with the old misspelled column.
      ?? (existingRecords.length === 1 && !existingRecords[0].createdByAccount
        ? existingRecords[0]
        : undefined);
    const updateKid = (record: Kid) => {
      Object.assign(record, {
        createdByAccount: kid.createdByAccount,
        kidId: kid.id,
        firstName: kid.firstName,
        lastName: kid.lastName,
        class: kid.class,
        dateOfBirth: kid.dateOfBirth.getTime()
      });
    };

    if (existing) {
      const prepared = existing.prepareUpdate(record => updateKid(record as Kid));
      await safeWrite(db, async () => {
        await db.batch(prepared);
      }, 10000, 'updateKidInDatabase');
    } else {
      const prepared = db.get<Kid>('kids').prepareCreate(record => updateKid(record));
      await safeWrite(db, async () => {
        await db.batch(prepared);
      }, 10000, 'addKidToDatabase');
    }
  }
}

export async function getKidsFromCache(
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedKid[]> {
  try {
    const db = getDatabaseInstance();
    const kids = await db
      .get<Kid>('kids')
      .query(Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__"))
      .fetch()

    return kids.map(mapKidsToShared)
  } catch (error) {
    warn(String(error))
    return[]
  }
}
