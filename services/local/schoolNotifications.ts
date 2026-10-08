import { Platform } from "react-native";

const ANDROID_CHANNEL_ID = "school-updates";

/** Send only when the user has already granted the app notification permission. */
export async function sendSchoolNotification(
  title: string,
  body: string,
  tag: string
): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      new Notification(title, { body, tag });
    }
    return;
  }

  const Notifications = await import("expo-notifications");
  if ((await Notifications.getPermissionsAsync()).status !== "granted") return;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
      name: "Nouveautés scolaires",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: { source: "scola-school-update", tag } },
    trigger: null,
  });
}
