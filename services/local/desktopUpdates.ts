import packageJson from "../../package.json";
import { isTauriDesktop } from "@/utils/network/fetch";

const LATEST_RELEASE_URL = "https://api.github.com/repos/PapillonApp/Papillon/releases/latest";

type GitHubRelease = {
  tag_name?: string;
  draft?: boolean;
  prerelease?: boolean;
  assets?: Array<{ name?: string }>;
};

export type DesktopRelease = { version: string };

function compareVersions(left: string, right: string): number {
  const parse = (value: string) => value.replace(/^v/i, "").split(/[.+-]/).map(part => Number(part) || 0);
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0);
    if (delta !== 0) return delta > 0 ? 1 : -1;
  }
  return 0;
}

/** Check GitHub silently; callers deliberately swallow offline and rate-limit errors. */
export async function checkForDesktopUpdate(): Promise<DesktopRelease | null> {
  if (!isTauriDesktop()) return null;
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub répond ${response.status}.`);
  const release = await response.json() as GitHubRelease;
  const tag = release.tag_name?.trim();
  const version = tag?.replace(/^v/i, "");
  if (!version || release.draft || release.prerelease) return null;
  if (!release.assets?.some(asset => asset.name?.toLowerCase().endsWith(".exe"))) return null;
  if (compareVersions(version, packageJson.version) <= 0) return null;
  return { version };
}

export async function installDesktopUpdate(version: string): Promise<void> {
  if (!isTauriDesktop()) throw new Error("L’installation automatique est disponible dans l’application Windows.");
  const { invoke } = await import("@tauri-apps/api/core");
  await invoke("install_latest_update", { expectedVersion: version });
}
