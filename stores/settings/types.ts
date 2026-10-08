import { Colors } from "@/utils/colors";
import { AppFontFamily } from "@/utils/theme/fonts";

export interface SettingsStorage {
  personalization: Personalization;
  reset: () => void;
  mutateProperty: <T extends keyof SettingsState>(
    section: T,
    updates: Partial<SettingsState[T]>
  ) => void;
}

export interface SettingsState {
  personalization: Personalization;
}

export interface Path {
  directory: string;
  name: string;
}

export interface Wallpaper {
  id: string;
  dataUri?: string;
  url?: string;
  path?: Path;
  thumbnail?: string;
  credit?: string;
}

export interface Personalization {
  fontFamily?: AppFontFamily;
  gradesDisplayScale?: "20" | "10" | "5" | "percentage";
  colorSelected?: Colors;
  theme?: "light" | "dark" | "auto";
  useMaterialYou?: boolean;
  iOSBottomAccessoryEnabled?: boolean;
  showTabBarLabels?: boolean;
  magicEnabled?: boolean;
  hideNameOnHomeScreen?: boolean;
  showAlertAtLogin?: boolean;
  showDevMode?: boolean;
  mockDataEnabled?: boolean;
  magicModelURL?: string;
  /** Background refresh interval in minutes; defaults to 30. */
  dataSyncIntervalMinutes?: 15 | 30 | 60 | 120;
  /** Send a local notification before an unfinished homework is due. */
  homeworkRemindersEnabled?: boolean;
  /** 0 = due date morning, 1 = previous day, 2 = two days before. */
  homeworkReminderDaysBefore?: 0 | 1 | 2;
  /** Notify about newly received school messages and announcements. */
  messageNotificationsEnabled?: boolean;
  newsNotificationsEnabled?: boolean;
  /** Last seen message cursor by account and cached conversation id. */
  notificationMessageCursorByAccount?: Record<string, Record<string, string>>;
  /** Last seen announcement cursor by account. */
  notificationNewsCursorByAccount?: Record<string, string>;
  /** Desktop preferences, applied by the Windows Tauri host. */
  desktopCloseToTray?: boolean;
  desktopLaunchAtStartup?: boolean;
  desktopLaunchInBackground?: boolean;
  /** Release version ignored by the user or reminder timestamp. */
  ignoredUpdateVersion?: string;
  updateReminderAt?: number;
  language?: string | null;
  wallpaper?: Wallpaper;
  /** Profile-scoped wallpaper; null means the profile explicitly chose no wallpaper. */
  wallpapersByAccount?: Record<string, Wallpaper | null>;
  /** Account to which the legacy global wallpaper belonged before profile scoping. */
  wallpaperOwnerAccountId?: string;
  disabledTabs?: string[];
  disabledTabsByAccount?: Record<string, string[]>;
  gradesSortMethod?: string;
  gradesPeriodName?: string;
  gradesPeriodNamesByAccount?: Record<string, string | null>;
  gradesPeriodOwnerAccountId?: string;
  installedVersion?: string;
  releaseNotesSeenForVersion?: string;
  welcomeModalSeen?: boolean;
}
