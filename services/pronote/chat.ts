import {
  discussionMessages,
  discussionRecipients,
  discussions,
  discussionSendMessage,
  EntityKind,
  newDiscussion,
  NewDiscussionRecipient,
  newDiscussionRecipients,
  SessionHandle,
} from "@blockshub/pawnote-lts";

import { Chat, Message, Recipient } from "@/services/shared/chat";
import { AttachmentType } from "@/services/shared/attachment";
import { error } from "@/utils/logger/logger";

export async function fetchPronoteChats(
  session: SessionHandle,
  accountId: string
): Promise<Chat[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChats");
  }

  const chats = await discussions(session);
  return chats.items.map(chat => ({
    id: chat.participantsMessageID,
    subject: chat.subject,
    creator: chat.creator,
    recipient: chat.recipientName,
    date: chat.date,
    ref: chat,
    createdByAccount: accountId,
  }));
}

export async function fetchPronoteChatRecipients(
  session: SessionHandle,
  chat: Chat
): Promise<Recipient[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChatRecipients");
  }

  if (!chat.ref) {
    throw error("Chat reference is undefined", "fetchPronoteChatRecipients");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "fetchPronoteChatRecipients");
  }

  const recipients = await discussionRecipients(session, chat.ref);
  return recipients.map((recipient) => {
    const [namePart, classPart] = recipient.name.split("(");

    return {
      id: recipient.id,
      name: namePart.trim(),
      class: classPart ? classPart.replace(")", "").trim() : undefined
    };
  });
}

export async function fetchPronoteChatMessages(
  session: SessionHandle,
  accountId: string,
  chat: Chat
): Promise<Message[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteChatMessages");
  }

  if (!chat.ref) {
    throw error("Chat reference is undefined", "fetchPronoteChatMessages");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "fetchPronoteChatMessages");
  }

  const messages = await discussionMessages(session, chat.ref, true)
  const studentName = session.user.resources.find(resource => resource.name)?.name ?? session.user.name;

  // The library has returned both a raw `sents` shape and a parsed
  // `MessagesOverview.messages` shape across supported PRONOTE versions.
  // Normalize either shape and walk replies/forwards instead of assuming the
  // body is on the top-level sent item.
  type MessageRecord = Record<string, unknown>;
  const asRecord = (value: unknown): MessageRecord | undefined =>
    value && typeof value === "object" && !Array.isArray(value)
      ? value as MessageRecord
      : undefined;
  const readText = (value: unknown, depth = 0): string => {
    if (depth > 5 || value == null) return "";
    if (typeof value === "string") return value;
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) return value.map(item => readText(item, depth + 1)).filter(Boolean).join("\n");
    const record = asRecord(value);
    if (!record) return "";
    for (const key of ["V", "value", "text", "content", "body", "html", "L"]) {
      const text = readText(record[key], depth + 1);
      if (text) return text;
    }
    return "";
  };
  const response = messages as unknown as MessageRecord;
  const rootItems = ["messages", "sents", "received", "items", "sentMessages"]
    .flatMap(key => Array.isArray(response[key]) ? response[key] as unknown[] : []);
  const visited = new WeakSet<object>();
  const normalized = new Map<string, Message>();
  let fallbackIndex = 0;

  const visit = (value: unknown, depth = 0): void => {
    if (depth > 8) return;
    if (Array.isArray(value)) {
      value.forEach(item => visit(item, depth + 1));
      return;
    }
    const record = asRecord(value);
    if (!record || visited.has(record)) return;
    visited.add(record);

    const body = readText(record.content ?? record.body ?? record.text ?? record.messageText ?? record.message);
    const rawFiles = record.files ?? record.attachments;
    const files = Array.isArray(rawFiles) ? rawFiles : [];
    const idValue = record.id ?? record.messageId ?? record.messageID ?? record.N;
    const id = typeof idValue === "string" || typeof idValue === "number"
      ? String(idValue)
      : undefined;

    if (body.trim() || files.length > 0) {
      const dateValue = record.creationDate ?? record.date ?? record.createdAt ?? record.sentAt;
      const parsedDate = dateValue instanceof Date ? dateValue : new Date(String(dateValue ?? ""));
      const date = Number.isNaN(parsedDate.getTime()) ? chat.date : parsedDate;
      const authorRecord = asRecord(record.author ?? record.sender);
      const author = typeof record.author === "string"
        ? record.author
        : readText(authorRecord?.name ?? authorRecord?.label) || studentName;
      const key = id ?? `${chat.id}:${date.getTime()}:${author}:${body.slice(0, 64)}:${fallbackIndex++}`;
      normalized.set(key, {
        id: key,
        subject: "",
        content: body,
        author,
        date,
        attachments: files.flatMap(file => {
          const attachment = asRecord(file);
          if (!attachment) return [];
          const url = readText(attachment.url ?? attachment.href);
          if (!url) return [];
          const kind = attachment.kind ?? attachment.type;
          return [{
            type: (kind === 0 || kind === "link" || kind === "LINK" ? AttachmentType.LINK : AttachmentType.FILE),
            name: readText(attachment.name ?? attachment.filename) || "Pièce jointe",
            url,
            createdByAccount: accountId,
          }];
        }),
      });
    }

    for (const key of ["replyingTo", "transferredMessages", "replies", "messages", "items", "sents", "received", "message", "thread"]) {
      visit(record[key], depth + 1);
    }
  };

  rootItems.forEach(item => visit(item));
  return [...normalized.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function sendPronoteMessageInChat(
  session: SessionHandle,
  chat: Chat,
  content: string
): Promise<void> {
  if (!session) {
    throw error("Session is undefined", "sendPronoteMessageInChat");
  }

  if (!chat.ref) {
    throw error("Chat reference is undefined", "sendPronoteMessageInChat");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "sendPronoteMessageInChat");
  }

  await discussionSendMessage(session, chat.ref, content)
}

export async function fetchPronoteRecipients(
  session: SessionHandle,
): Promise<Recipient[]> {
  if (!session) {
    throw error("Session is undefined", "fetchPronoteRecipients");
  }

  const recipientsByKind = await Promise.all([
    newDiscussionRecipients(session, EntityKind.Teacher),
    newDiscussionRecipients(session, EntityKind.Personal),
  ]);

  const recipients = recipientsByKind.flat();

  return recipients.map((recipient) => {
    const [namePart, classPart] = recipient.name.split("(");

    return {
      id: recipient.id,
      name: namePart.trim(),
      class: classPart ? classPart.replace(")", "").trim() : undefined,
      ref: recipient
    };
  });
}

export async function createPronoteMail(session: SessionHandle, accountId: string, subject: string, content: string, recipients: Recipient[]): Promise<Chat> {
  await newDiscussion(session, subject, content, sharedToPronoteRecipient(recipients))
  return {
    id: "",
    subject: subject,
    recipient: recipients.map(r => r.name).join(", "),
    creator: session.user.name,
    date: new Date(),
    createdByAccount: accountId
  }
}

function sharedToPronoteRecipient(recipients: Recipient[]): NewDiscussionRecipient[] {
  return recipients.map(recipient => recipient.ref).filter((ref): ref is NewDiscussionRecipient => ref !== undefined);
}
