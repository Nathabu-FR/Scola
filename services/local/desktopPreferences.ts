import { isTauriDesktop } from "@/utils/network/fetch";

export type DesktopPreferences = {
  closeToTray: boolean;
  launchAtStartup: boolean;
  launchInBackground: boolean;
};

/** Apply the persisted desktop settings to the Windows host. */
export async function syncDesktopPreferences(preferences: DesktopPreferences): Promise<void> {
  if (!isTauriDesktop()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("configure_desktop_preferences", preferences);
}
