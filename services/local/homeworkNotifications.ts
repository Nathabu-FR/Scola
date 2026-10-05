import { Platform } from "react-native";

import type { Homework } from "@/services/shared/homework";

export type HomeworkReminderDaysBefore = 0 | 1 | 2;

const NOTIFICATION_SOURCE = "scola-homework-reminder";
const ANDROID_CHANNEL_ID = "homework-reminders";
const MAX_SCHEDULED_REMINDERS = 50;
const MAX_WEB_TIMER_DELAY = 2_147_000_000;

type Reminder = {
  key: string;
  homeworkKey: string;
  accountId: string;
  subject: string;
  body: string;
  triggerAt: number;
};

const webTimers = new Map<string, ReturnType<typeof setTimeout>>();
let reconciliationQueue: Promise<void> = Promise.resolve();
let nativeNotificationHandlerConfigured = false;

function makeReminder(homework: Homework, daysBefore: HomeworkReminderDaysBefore): Reminder | null {
  if (homework.isDone || !Number.isFinite(homework.dueDate.getTime())) return null;

  const dueDate = new Date(homework.dueDate);
  const reminderDate = new Date(dueDate);
  reminderDate.setDate(reminderDate.getDate() - daysBefore);
  reminderDate.setHours(daysBefore === 0 ? 8 : 18, 0, 0, 0);
  if (reminderDate.getTime() <= Date.now()) return null;

  const homeworkKey = `${homework.createdByAccount}:${homework.id}`;
  const dueLabel = dueDate.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  return {
    key: homeworkKey,
    homeworkKey,
    accountId: homework.createdByAccount,
    subject: homework.subject.trim() || "Devoir",
    body: `À rendre le ${dueLabel}.`,
    triggerAt: reminderDate.getTime(),
  };
}

function clearWebTimers() {
  for (const timer of webTimers.values()) clearTimeout(timer);
  webTimers.clear();
}

function setWebReminder(reminder: Reminder) {
  const remaining = reminder.triggerAt - Date.now();
  const timer = setTimeout(() => {
    webTimers.delete(reminder.key);
    if (Date.now() < reminder.triggerAt) {
      setWebReminder(reminder);
      return;
    }

    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification("Un devoir approche", {
        body: `${reminder.subject} · ${reminder.body}`,
        tag: reminder.key,
      });
    }
  }, Math.min(Math.max(remaining, 1), MAX_WEB_TIMER_DELAY));
  webTimers.set(reminder.key, timer);
}

async function requestPlatformPermission(): Promise<boolean> {
  if (Platform.OS === "web") {
    if (typeof Notification === "undefined") return false;
    return (await Notification.requestPermission()) === "granted";
  }

  const Notifications = await import("expo-notifications");
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Rappels de devoirs",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const current = await Notifications.getPermissionsAsync();
  if (current.status === "granted") return true;
  return (await Notifications.requestPermissionsAsync()).status === "granted";
}

export function requestHomeworkReminderPermission(): Promise<boolean> {
  return requestPlatformPermission();
}

async function reconcileHomeworkReminders(
  accountId: string,
  homeworks: Homework[],
  enabled: boolean,
  daysBefore: HomeworkReminderDaysBefore
) {
  const reminders = enabled && accountId
    ? homeworks
        .filter(homework => homework.createdByAccount === accountId)
        .map(homework => makeReminder(homework, daysBefore))
        .filter((reminder): reminder is Reminder => reminder !== null)
        .sort((a, b) => a.triggerAt - b.triggerAt)
        .slice(0, MAX_SCHEDULED_REMINDERS)
    : [];

  if (Platform.OS === "web") {
    clearWebTimers();
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    reminders.forEach(setWebReminder);
    return;
  }

  const Notifications = await import("expo-notifications");
  if (!nativeNotificationHandlerConfigured) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: false,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
    nativeNotificationHandlerConfigured = true;
  }
  const permissions = await Notifications.getPermissionsAsync();
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const managed = scheduled.filter(request => request.content.data?.source === NOTIFICATION_SOURCE);

  if (reminders.length === 0 || permissions.status !== "granted") {
    await Promise.all(managed.map(request => Notifications.cancelScheduledNotificationAsync(request.identifier)));
    return;
  }

  const wanted = new Map(reminders.map(reminder => [reminder.key, reminder]));
  const existingByKey = new Map<string, (typeof managed)[number]>();
  for (const request of managed) {
    const data = request.content.data;
    const key = typeof data?.homeworkKey === "string" ? data.homeworkKey : "";
    const reminder = wanted.get(key);
    const matches = reminder
      && data?.accountId === accountId
      && Number(data?.triggerAt) === reminder.triggerAt
      && request.content.body === `${reminder.subject} · ${reminder.body}`;

    if (matches && !existingByKey.has(key)) {
      existingByKey.set(key, request);
    } else {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }

  for (const reminder of reminders) {
    if (existingByKey.has(reminder.key)) continue;
    await Notifications.scheduleNotificationAsync({
      content: {
        title: "Un devoir approche",
        body: `${reminder.subject} · ${reminder.body}`,
        data: {
          source: NOTIFICATION_SOURCE,
          accountId: reminder.accountId,
          homeworkKey: reminder.homeworkKey,
          triggerAt: reminder.triggerAt,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(reminder.triggerAt),
        channelId: ANDROID_CHANNEL_ID,
      },
    });
  }
}

/** Keep the OS schedule in step with the active profile's cached, unfinished homework. */
export function syncHomeworkReminders(
  accountId: string,
  homeworks: Homework[],
  enabled: boolean,
  daysBefore: HomeworkReminderDaysBefore
): Promise<void> {
  const operation = reconciliationQueue.then(() =>
    reconcileHomeworkReminders(accountId, homeworks, enabled, daysBefore)
  );
  reconciliationQueue = operation.catch(() => undefined);
  return operation;
}
