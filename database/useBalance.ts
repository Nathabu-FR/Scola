import { Model, Q } from "@nozbe/watermelondb";

import { Balance as SharedBalance } from "@/services/shared/balance";
import { generateId } from "@/utils/generateId";
import { warn } from "@/utils/logger/logger";

import { getDatabaseInstance } from "./DatabaseProvider";
import { mapBalancesToShared } from "./mappers/balances";
import { Balance } from "./models/Balance";
import { safeWrite } from "./utils/safeTransaction";

export async function removeBalanceFromDatabase(serviceId: string) {
  const db = getDatabaseInstance();
  const dbBalances = await db.get<Balance>('balances')
    .query(
      Q.where('createdByAccount', serviceId)
    )
    .fetch();

  const toDelete = dbBalances.filter(balance => balance.createdByAccount === serviceId);
  if (toDelete.length === 0) return;
  // markAsDeleted() doit rester dans le Writer : batch préparé + await
  // (l'ancien appel sans await sortait du writer et levait l'erreur).
  await safeWrite(db, async () => {
    await db.batch(...toDelete.map(balance => balance.prepareMarkAsDeleted()));
  }, 10000, 'removeBalanceFromDatabase')
}

export async function addBalancesToDatabase(balances: SharedBalance[]) {
  const db = getDatabaseInstance();
  for (const balance of balances) {
    const id = generateId(balance.label + balance.createdByAccount)
    const existing = await db.get('balances').query(Q.where('balanceId', id)).fetch();

    if (existing.length === 0) {
      await safeWrite(db, async () => {
        await db.get('balances').create((record: Model) => {
          const balanceModel = record as Balance;
          Object.assign(balanceModel, {
            createdByAccount: balance.createdByAccount,
            balanceId: id,
            currency: balance.currency,
            amount: balance.amount,
            lunchRemaining: balance.lunchRemaining,
            lunchPrice: balance.lunchPrice,
            label: balance.label
          })
        })
      }, 10000, 'addBalancesToDatabase')
    }
  }
}

export async function getBalancesFromCache(accountIds?: string | string[]): Promise<SharedBalance[]> {
  try {
    const database = getDatabaseInstance();
    // Les soldes sont enregistrés sous l'identifiant du service source.
    // Le manager fournit les services rattachés au compte courant.
    const sourceIds = accountIds === undefined
      ? null
      : new Set(Array.isArray(accountIds) ? accountIds : [accountIds]);
    const balances = await database.get<Balance>('balances').query().fetch();

    return balances
      .filter(balance => sourceIds === null || sourceIds.has(balance.createdByAccount))
      .map(mapBalancesToShared)
  } catch (e) {
    warn(String(e));
    return [];
  }
}