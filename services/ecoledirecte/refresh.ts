import { Client } from "@blockshub/blocksdirecte";

import { useAccountStore } from "@/stores/account";
import { Auth } from "@/stores/account/types";
import { preloadTauriFetch } from "@/utils/network/fetch";

export async function refreshEDAccount(accountId: string, credentials: Auth, existingClient?: Client): Promise<{auth: Auth, account: Client }> {
  await preloadTauriFetch();
  // Le RESTManager de BlocksDirecte démarre un setInterval jamais arrêté à chaque
  // `new Client()` : on réutilise donc le client existant pour éviter de cumuler
  // un timer de plus à chaque synchronisation (source de ralentissements).
  const client = existingClient ?? new Client();
  await client.auth.refreshToken(
    credentials.additionals!["username"] as string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    "E" as any,
    credentials.additionals!["token"]  as string,
    undefined,
    undefined,
    credentials.additionals!["deviceUUID"]  as string
  )

  client.auth.setAccount(0);
  const account = client.auth.getAccount()

  const auth: Auth = {
    additionals: {
      "username": credentials.additionals!["username"],
      "token": account.accessToken,
      "deviceUUID": credentials.additionals!["deviceUUID"]
    }
  }
  
  useAccountStore.getState().updateServiceAuthData(accountId, auth);

  return {
    auth,
    account: client
  }
}
