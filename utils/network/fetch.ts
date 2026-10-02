import { Platform } from "react-native";

type TauriFetch = typeof import("@tauri-apps/plugin-http").fetch;

const isTauriWeb =
  Platform.OS === "web" &&
  typeof window !== "undefined" &&
  window.location.hostname === "tauri.localhost";

let tauriFetchPromise: Promise<TauriFetch | null> | null = null;

const getTauriFetch = async (): Promise<TauriFetch | null> => {
  if (!isTauriWeb) return null;
  tauriFetchPromise ??= import("@tauri-apps/plugin-http")
    .then((module) => module.fetch)
    .catch((error) => {
      // Sur desktop Tauri le plugin HTTP est obligatoire pour contourner CORS.
      // Le fallback window.fetch ne ferait que reproduire le CORS (cf. logs
      // calendar.google.com bloqués depuis tauri.localhost) : on renvoie null
      // et appFetch lèvera une erreur explicite au lieu d'un « Failed to fetch ».
      console.warn("Tauri HTTP plugin unavailable — requests will fail instead of hitting CORS", error);
      return null;
    });
  return tauriFetchPromise;
};

export const isTauriDesktop = () => isTauriWeb;

let tauriFetchInstalled = false;
let tauriFetchInstallPromise: Promise<void> | null = null;

/**
 * EcoleDirecte's SDK calls the global fetch() directly instead of going through
 * appFetch(). On Tauri that would put the request back into the WebView and
 * therefore back under browser CORS rules.
 */
export async function installTauriFetch(): Promise<void> {
  if (!isTauriWeb || tauriFetchInstalled) return;

  tauriFetchInstallPromise ??= (async () => {
    const nativeFetch = await getTauriFetch();
    if (!nativeFetch) {
      throw new Error("Tauri HTTP indisponible : le client natif ne peut pas être installé.");
    }

    globalThis.fetch = nativeFetch as typeof globalThis.fetch;
    if (typeof window !== "undefined") {
      window.fetch = nativeFetch as typeof window.fetch;
    }
    tauriFetchInstalled = true;
  })();

  await tauriFetchInstallPromise;
}

/**
 * Uses Tauri's Rust HTTP client in the desktop WebView so school APIs are not
 * subject to browser CORS. Normal browsers keep the native Web Fetch API.
 */
export async function appFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const tauriFetch = await getTauriFetch();
  if (tauriFetch) {
    return tauriFetch(input as string | URL | Request, init);
  }
  if (isTauriWeb) {
    throw new Error(
      "Tauri HTTP indisponible : impossible de charger cette URL sans passer par le client natif (CORS). " +
      "Vérifie que @tauri-apps/plugin-http est installé et que la capability http autorise ce domaine."
    );
  }
  return fetch(input, init);
}
