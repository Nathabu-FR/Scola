import { Period } from "@/services/shared/grade";
import { error, warn } from "@/utils/logger/logger";

export function getCurrentPeriod(periods: Period[]): Period | undefined {
  const now = new Date().getTime();
  const excludedNames = [
    "Bac blanc",
    "Brevet blanc",
    "Hors période",
    "Année",
    "ANNÉE",
    "ANNEE",
    "Contrôle en cours de formation",
    "EPREUVES PONCTUELLES 1ERE SERIE",
    "EPREUVES PONCTUELLES 2EME SERIE",
    "MI-SEMESTRE 1",
    "MI-SEMESTRE 2",
    "Évaluation spécifique de DNL",
  ];

  periods = periods
    .filter(period => !excludedNames.includes(period.name))
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  for (const period of periods) {
    if (period.start.getTime() < now && period.end.getTime() > now) {
      return period;
    }
  }

  if (periods.length > 0) {
    warn(
      "Current period not found. Falling back to the first period in the array."
    );
    return periods[0];
  }

  // `periods` is guaranteed empty here (the branch above already handles a
  // non-empty array), so `periods[0]` was silently returning `undefined`
  // while the return type claimed a `Period` was always given back. Every
  // caller already treats a falsy result as "no current period", so this
  // just makes that contract honest.
  error("Unable to find the current period and unable to fallback...");
  return undefined;
}