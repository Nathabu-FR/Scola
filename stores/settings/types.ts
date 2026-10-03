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
