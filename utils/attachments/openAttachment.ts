import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";

import type { Attachment } from "@/services/shared/attachment";

function getSafeFilename(attachment: Attachment): string {
  const urlName = (() => {
    try {
      return decodeURIComponent(new URL(attachment.url).pathname.split("/").pop() ?? "");
    } catch {
      return "";
    }
  })();
  let filename = (attachment.name || urlName || "document")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .trim();
  if (!filename) filename = "document";
  if (/\.pdf(?:$|[?#])/i.test(attachment.url) && !/\.pdf$/i.test(filename)) {
    filename += ".pdf";
  }
  return filename;
}

function isPdf(attachment: Attachment): boolean {
  return /\.pdf(?:$|[?#]|\s)/i.test(`${attachment.name ?? ""} ${attachment.url ?? ""}`);
}

async function downloadPdf(attachment: Attachment): Promise<void> {
  const filename = getSafeFilename(attachment);

  if (Platform.OS === "web") {
    if (typeof document === "undefined") throw new Error("Le téléchargement est indisponible.");
    const link = document.createElement("a");
    link.download = filename;
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    let objectUrl: string | undefined;
    try {
      // The download attribute is ignored for many cross-origin URLs. Fetch to
      // a blob first so desktop/Tauri reliably saves the PDF instead of
      // navigating away to the school server's built-in PDF viewer.
      const response = await fetch(attachment.url);
      if (!response.ok) throw new Error(`Le serveur a répondu ${response.status}.`);
      objectUrl = URL.createObjectURL(await response.blob());
      link.href = objectUrl;
      document.body.appendChild(link);
      link.click();
    } catch {
      // Keep a usable fallback in browsers where the school host blocks CORS.
      link.href = attachment.url;
      document.body.appendChild(link);
      link.click();
    } finally {
      link.remove();
      if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl!), 30_000);
    }
    return;
  }

  const [{ File, Paths }, Sharing] = await Promise.all([
    import("expo-file-system"),
    import("expo-sharing"),
  ]);
  const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`;
  const destination = new File(Paths.cache, uniqueName);
  const savedFile = await File.downloadFileAsync(attachment.url, destination);
  if (!savedFile?.exists) throw new Error("Le fichier téléchargé est introuvable.");

  if (!(await Sharing.isAvailableAsync())) {
    throw new Error("Aucune application ne peut enregistrer ce document.");
  }
  await Sharing.shareAsync(savedFile.uri, {
    dialogTitle: `Enregistrer ${filename}`,
    mimeType: "application/pdf",
    UTI: "com.adobe.pdf",
  });
}

/** PDFs download instead of opening a separate viewer; other links keep the existing open behavior. */
export async function openAttachment(attachment: Attachment): Promise<void> {
  if (!attachment.url) return;
  if (isPdf(attachment)) {
    await downloadPdf(attachment);
    return;
  }

  if (Platform.OS === "web" && typeof window !== "undefined") {
    const opened = window.open(attachment.url, "_blank", "noopener,noreferrer");
    if (!opened) window.location.assign(attachment.url);
    return;
  }

  await WebBrowser.openBrowserAsync(attachment.url, { presentationStyle: "formSheet" });
}
