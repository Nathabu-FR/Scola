import { Buffer } from "buffer";

import { Client } from "@blockshub/blocksdirecte";

import { Chat, Message } from "../shared/chat";

/**
 * Lecture seule de la messagerie EcoleDirecte.
 *
 * BlocksDirecte n'expose pas encore la messagerie : on utilise donc son
 * gestionnaire REST interne avec les endpoints `messages.awp` d'EcoleDirecte.
 * Tout est défensif : une réponse inattendue donne une liste vide / une erreur
 * claire plutôt qu'un plantage, et le cache local reste utilisé en repli.
 */

type EDMessageSummary = {
  id: number | string;
  subject?: string;
  date?: string;
  read?: boolean;
  from?: { name?: string; nom?: string; prenom?: string };
  to?: { name?: string }[];
};

type EDInternals = {
  restManager: {
    post<T>(path: string, body: object, headers?: Record<string, string>): Promise<{ code: number; data: T; message?: string }>;
  };
  credentials: {
    token?: string;
    selectedAccounts: number;
    accounts: { id: number | string; typeCompte: string }[];
  };
};

const ED_FOLDERS_PAGE_SIZE = 100;

function internals(session: Client): EDInternals {
  return session as unknown as EDInternals;
}

function accountPath(session: Client) {
  const { credentials } = internals(session);
  const account = credentials.accounts[credentials.selectedAccounts];
  if (!account || !credentials.token) {
    throw new Error("Session EcoleDirecte invalide pour la messagerie.");
  }
  const segment = account.typeCompte === "E" ? "eleves" : account.typeCompte === "P" ? "enseignants" : account.typeCompte === "A" ? "personnels" : "familles";
  return { base: `/v3/${segment}/${account.id}`, token: credentials.token };
}

function decodeBase64(value: string | undefined): string {
  if (!value) return "";
  const cleaned = value.replace(/\s+/g, "");
  if (cleaned.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned)) return value;
  try {
    return Buffer.from(cleaned, "base64").toString("utf-8");
  } catch {
    return value;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const parsed = new Date(value.replace(" ", "T"));
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function senderName(from: EDMessageSummary["from"]): string {
  if (!from) return "";
  return from.name ?? [from.prenom, from.nom].filter(Boolean).join(" ");
}

export async function fetchEDChats(session: Client, accountId: string): Promise<Chat[]> {
  const { base, token } = accountPath(session);
  const response = await internals(session).restManager.post<{ messages?: { received?: EDMessageSummary[] } }>(
    `${base}/messages.awp?force=false&typeRecuperation=received&idClasseur=0&orderBy=date&order=desc&query=&onlyRead=&page=0&itemsPerPage=${ED_FOLDERS_PAGE_SIZE}&getAll=0&verbe=get`,
    {},
    { "X-Token": token }
  );

  if (response.code !== 200) {
    throw new Error(`Messagerie EcoleDirecte indisponible (code ${response.code}).`);
  }

  const received = response.data?.messages?.received ?? [];
  return received.map(item => ({
    id: String(item.id),
    subject: decodeBase64(item.subject) || "(sans objet)",
    creator: senderName(item.from),
    recipient: item.to?.map(to => to.name).filter(Boolean).join(", "),
    date: parseDate(item.date),
    createdByAccount: accountId,
  }));
}

export async function fetchEDChatMessages(session: Client, chat: Chat): Promise<Message[]> {
  const { base, token } = accountPath(session);
  const response = await internals(session).restManager.post<{
    id?: number | string;
    subject?: string;
    content?: string;
    date?: string;
    from?: EDMessageSummary["from"];
  }>(
    `${base}/messages/${chat.id}.awp?force=false&typeRecuperation=received&mode=destinataire&verbe=get`,
    {},
    { "X-Token": token }
  );

  if (response.code !== 200 || !response.data) {
    throw new Error(`Message EcoleDirecte introuvable (code ${response.code}).`);
  }

  return [
    {
      id: String(response.data.id ?? chat.id),
      subject: chat.subject,
      content: htmlToText(decodeBase64(response.data.content)),
      author: senderName(response.data.from) || chat.creator || "",
      date: parseDate(response.data.date) ?? chat.date,
      attachments: [],
    },
  ];
}
