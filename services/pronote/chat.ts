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
  TabLocation,
} from "@blockshub/pawnote-lts";

import { Chat, Message, Recipient } from "@/services/shared/chat";
import { error } from "@/utils/logger/logger";

function getDiscussionTab(session: SessionHandle, from: string) {
  const tab = session.user.resources
    .find(resource => resource.tabs?.has(TabLocation.Discussions))
    ?.tabs?.get(TabLocation.Discussions);
  if (!tab) {
    throw error("Chat tab not found in session", from);
  }
  return tab;
}

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

  getDiscussionTab(session, "fetchPronoteChatRecipients");

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

  getDiscussionTab(session, "fetchPronoteChatMessages");

  if (!chat.ref) {
    throw error("Chat reference is undefined", "fetchPronoteChatMessages");
  }

  if (!('participantsMessageID' in chat.ref)) {
    throw error("Chat reference is not a Discussion type", "fetchPronoteChatMessages");
  }

  const messages = await discussionMessages(session, chat.ref, true)
  const studentName = session.user.resources.find(resource => resource.name)?.name ?? session.user.name;

  return (Array.isArray(messages.sents) ? messages.sents : []).map((message) => {
    return {
      id: message.id,
      subject: "",
      content: message.content,
      author: message.author?.name ?? studentName,
      date: message.creationDate,
      attachments: (Array.isArray(message.files) ? message.files : []).map((attachment) => ({
        type: attachment.kind,
        name: attachment.name,
        url: attachment.url,
        createdByAccount: accountId,
      }))
    };
  });
}

export async function sendPronoteMessageInChat(
  session: SessionHandle,
  chat: Chat,
  content: string
): Promise<void> {
  if (!session) {
    throw error("Session is undefined", "sendPronoteMessageInChat");
  }

  getDiscussionTab(session, "sendPronoteMessageInChat");

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

  getDiscussionTab(session, "fetchPronoteRecipients");

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
