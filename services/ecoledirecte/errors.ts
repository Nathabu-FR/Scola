const getMessage = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export const isEcoleDirecteServerError = (error: unknown): boolean => {
  const message = getMessage(error);
  return /\b5\d\d\b/.test(message) || /ERR_NO_WDADMIN|Service Unavailable/i.test(message);
};

export const formatEcoleDirecteError = (error: unknown): string => {
  const message = getMessage(error);
  const status = message.match(/\b(5\d\d)\b/)?.[1];

  if (isEcoleDirecteServerError(error)) {
    const code = status ?? "503";
    if (/ERR_NO_WDADMIN/i.test(message)) {
      return `ÉcoleDirecte est temporairement indisponible (HTTP ${code}, service WEBDEV en panne).`;
    }
    return `ÉcoleDirecte rencontre une erreur serveur (HTTP ${code}).`;
  }

  return message.length > 400 ? `${message.slice(0, 397)}…` : message;
};
