import { Period } from "@/services/shared/grade";
import { warn } from "@/utils/logger/logger";

export function getCurrentPeriod(periods: Period[]): Period | undefined {
  // Some accounts have no grade periods. This is expected and unrelated to
  // timetable loading, so it should not look like an application error.
  if (!Array.isArray(periods) || periods.length === 0) {
    return undefined;
  }

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

  // Every remaining period was explicitly excluded above. Callers already
  // treat an absent current period as "no grade period available".
  return undefined;
}
