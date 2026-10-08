import { Model, Q } from "@nozbe/watermelondb";
import { useEffect, useState } from "react";

import { Chat as SharedChat, Message as SharedMessage, Recipient as SharedRecipient } from "@/services/shared/chat";
import { generateId } from "@/utils/generateId";
import { error } from "@/utils/logger/logger";

import { getDatabaseInstance, useDatabase } from "./DatabaseProvider";
import { mapChatsToShared, mapMessagesToShared, mapRecipientsToShared } from "./mappers/chats";
import { Chat, Message, Recipient } from "./models/Chat";
import { safeWrite } from "./utils/safeTransaction";
import { getActiveAccountDataSourceIds, useActiveAccountDataSourceIds } from "./accountScope";

export type CachedLatestMessage = {
  accountId: string;
  conversationId: string;
  messageId: string;
  author: string;
  subject: string;
  content: string;
};

/** Observe the last stored message in each active conversation for notifications. */
export function useLatestMessagesFromCache(): CachedLatestMessage[] {
  const database = useDatabase();
  const sourceIds = useActiveAccountDataSourceIds();
  const sourceKey = sourceIds.join("\u0000");
  const [latestMessages, setLatestMessages] = useState<CachedLatestMessage[]>([]);

  useEffect(() => {
    setLatestMessages([]);
    let cancelled = false;

    const refresh = async () => {
      if (sourceIds.length === 0) {
        if (!cancelled) setLatestMessages([]);
        return;
      }
      try {
        const chats = await database.get<Chat>("chats").query(
          Q.where("createdByAccount", Q.oneOf(sourceIds))
        ).fetch();
        const chatsById = new Map(chats.map(chat => [chat.chatId, chat]));
        if (chatsById.size === 0) {
          if (!cancelled) setLatestMessages([]);
          return;
        }

        const messages = await database.get<Message>("messages").query(
          Q.where("chatId", Q.oneOf([...chatsById.keys()]))
        ).fetch();
        const latestByChat = new Map<string, Message>();
        for (const message of messages) {
          const current = latestByChat.get(message.chatId);
          if (!current || message.date > current.date) latestByChat.set(message.chatId, message);
        }
        const result = [...latestByChat.entries()].flatMap(([chatId, message]) => {
          const chat = chatsById.get(chatId);
          if (!chat) return [];
          return [{
            accountId: chat.createdByAccount,
            conversationId: chatId,
            messageId: `${message.messageId}:${message.date}`,
            author: message.author,
            subject: chat.subject || message.subject,
            content: message.content.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 180),
          }];
        });
        if (!cancelled) setLatestMessages(result);
      } catch {
        if (!cancelled) setLatestMessages([]);
      }
    };

    const messageSubscription = database.get<Message>("messages").query()
      .observeWithColumns(["messageId", "content", "author", "date", "chatId"])
      .subscribe(() => { void refresh(); });
    const chatSubscription = database.get<Chat>("chats").query()
      .observeWithColumns(["createdByAccount", "chatId", "subject"])
      .subscribe(() => { void refresh(); });
    void refresh();

    return () => {
      cancelled = true;
      messageSubscription.unsubscribe();
      chatSubscription.unsubscribe();
    };
  }, [database, sourceKey]);

  return latestMessages.filter(message => sourceIds.includes(message.accountId));
}

export async function addChatsToDatabase(chats: SharedChat[]) {
  const db = getDatabaseInstance();
  for (const item of chats) {
    const id = generateId(item.createdByAccount + item.subject + item.date)
    const existing = await db.get<Chat>('chats').query(
      Q.where('chatId', id),
      Q.where('createdByAccount', item.createdByAccount)
    ).fetch();

    if (existing.length === 0) {
      await safeWrite(db, async () => {
        await db.get('chats').create((record: Model) => {
          const chat = record as Chat;
          Object.assign(chat, {
            chatId: id,
            subject: item.subject,
            recipient: item.recipient,
            creator: item.creator,
            date: item.date.getTime(),
            createdByAccount: item.createdByAccount
          })
        })
      }, 10000, 'addChatsToDatabase')
    }
  }
}

async function ensureChatInDatabase(chat: SharedChat): Promise<string> {
  const db = getDatabaseInstance();
  const chatId = generateId(chat.createdByAccount + chat.subject + chat.date);
  const queryChat = () => db.get<Chat>("chats").query(
    Q.where("chatId", chatId),
    Q.where("createdByAccount", chat.createdByAccount)
  ).fetch();

  // The WatermelonDB primary key is different from our stable `chatId` field.
  // Use the indexed field (and rehydrate older/missing chat rows) before adding
  // messages or recipients; find(chatId) incorrectly searched the primary key.
  let records = await queryChat();
  if (records.length === 0) {
    await addChatsToDatabase([chat]);
    records = await queryChat();
  }
  if (records.length === 0) {
    throw new Error("Impossible de retrouver la conversation dans le cache.");
  }

  return chatId;
}

export async function addRecipientsToDatabase(chat: SharedChat, recipients: SharedRecipient[]) {
  const db = getDatabaseInstance();
  const chatId = await ensureChatInDatabase(chat);

  for (const item of recipients) {
    const id = generateId(chatId + item.name + item.class)
    const existing = await db.get('recipients').query(
      Q.where('recipientId', id)
    ).fetch();

    if (existing.length > 0) {continue;}
		
    await safeWrite(db, async () => {
      await db.get('recipients').create((record: Model) => {
        const recipient = record as Recipient;
        Object.assign(recipient, {
          recipientId: id,
          name: item.name,
          class: item.class,
          chatId: chatId
        })
      })
    }, 10000, 'addRecipientsToDatabase')
  }
}

export async function addMessagesToDatabase(chat: SharedChat, messages: SharedMessage[]) {
  const db = getDatabaseInstance();
  const chatId = await ensureChatInDatabase(chat);

  for (const item of messages) {
    const id = generateId(chatId + item.content + item.author + item.date + item.subject)
    const existing = await db.get('messages').query(
      Q.where('messageId', id)
    ).fetch();

    if (existing.length > 0) {continue;}
		
    await safeWrite(db, async () => {
      await db.get('messages').create((record: Model) => {
        const message = record as Message;
        Object.assign(message, {
          messageId: id,
          subject: item.subject,
          content: item.content,
          author: item.author,
          date: item.date.getTime(),
          attachments: JSON.stringify(item.attachments),
          chatId: chatId
        })
      })
    }, 10000, 'addMessagesToDatabase')
  }
}

export async function getChatsFromCache(
  sourceIds: string[] = getActiveAccountDataSourceIds()
): Promise<SharedChat[]> {
  try {
    const database = getDatabaseInstance();
    const chats = await database.get<Chat>('chats').query(
      Q.where("createdByAccount", sourceIds.length > 0 ? Q.oneOf(sourceIds) : "__no_active_account__")
    ).fetch();

    return mapChatsToShared(chats)
  } catch (e) {
    error(String(e));
  }
}

export async function getRecipientsFromCache(chat: SharedChat): Promise<SharedRecipient[]> {
  try {
    if (!getActiveAccountDataSourceIds().includes(chat.createdByAccount)) return [];
    const database = getDatabaseInstance();
    const chatId = generateId(chat.createdByAccount + chat.subject + chat.date);
    const recipients = await database.get<Recipient>('recipients').query(
      Q.where('chatId', chatId)
    ).fetch();

    return getActiveAccountDataSourceIds().includes(chat.createdByAccount)
      ? mapRecipientsToShared(recipients)
      : [];
  } catch (e) {
    error(String(e));
  }
}

export async function getMessagesFromCache(chat: SharedChat): Promise<SharedMessage[]> {
  try {
    if (!getActiveAccountDataSourceIds().includes(chat.createdByAccount)) return [];
    const database = getDatabaseInstance();
    const chatId = generateId(chat.createdByAccount + chat.subject + chat.date);
    const messages = await database.get<Message>('messages').query(
      Q.where('chatId', chatId)
    ).fetch();

    return getActiveAccountDataSourceIds().includes(chat.createdByAccount)
      ? mapMessagesToShared(messages)
      : [];
  } catch (e) {
    error(String(e));
  }
}
