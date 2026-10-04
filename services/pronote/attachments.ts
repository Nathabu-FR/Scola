import { Attachment, AttachmentType } from "@/services/shared/attachment";

type RecordValue = Record<string, unknown>;

const asRecord = (value: unknown): RecordValue | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : undefined;

const unwrap = (value: unknown): unknown => {
  const record = asRecord(value);
  return record && "V" in record ? record.V : value;
};

const readText = (value: unknown, depth = 0): string => {
  if (depth > 5 || value == null) return "";
  value = unwrap(value);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(item => readText(item, depth + 1)).filter(Boolean).join("\n");
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["url", "href", "downloadUrl", "downloadURL", "lien", "name", "filename", "title", "description", "content", "html", "label", "value", "text", "V", "L", "N"]) {
    const text = readText(record[key], depth + 1);
    if (text) return text;
  }
  return "";
};

const getAttachmentUrl = (record: RecordValue): string => {
  for (const key of ["url", "href", "downloadUrl", "downloadURL", "lien", "link"]) {
    const url = readText(record[key]);
    if (url) return url;
  }
  return "";
};

export function mapPronoteAttachments(value: unknown, accountId: string): Attachment[] {
  for (let depth = 0; depth < 4; depth++) {
    const unwrapped = unwrap(value);
    if (unwrapped === value) break;
    value = unwrapped;
  }
  const files = Array.isArray(value) ? value : [];
  return files.flatMap(value => {
    const record = asRecord(unwrap(value));
    if (!record) return [];
    const nested = asRecord(record.file ?? record.document ?? record.attachment);
    const attachment = nested ? { ...record, ...nested } : record;
    const url = getAttachmentUrl(attachment);
    if (!url) return [];
    const kind = readText(attachment.kind ?? attachment.type).toLocaleLowerCase("fr");
    const type = kind === "0" || kind.includes("link") || kind.includes("lien")
      ? AttachmentType.LINK
      : AttachmentType.FILE;
    return [{
      type,
      name: readText(attachment.name ?? attachment.filename ?? attachment.title) || "Pièce jointe",
      url,
      createdByAccount: accountId,
    }];
  });
}

export const readPronoteText = readText;
