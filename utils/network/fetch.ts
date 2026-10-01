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
