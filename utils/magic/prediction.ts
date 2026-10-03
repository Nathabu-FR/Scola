import * as Battery from "expo-battery";
import { Platform } from "react-native";

import { useMagicStore } from "@/stores/magic";

import { generateId } from "../generateId";
import type { ModelPrediction } from "./ModelManager";
import regexPatterns from "./regex/homeworks.json";

const compiledPatterns: Record<string, RegExp[]> = Object.fromEntries(
  Object.entries(regexPatterns).map(([category, patterns]) => [
    category,
    (patterns as string[]).map(pattern => new RegExp(pattern, "i")),
  ])
);

const beautifyCategory = (category: string): string => {
  const map: Record<string, string> = {
    evaluation: "Évaluation",
    finaltask: "Tâche finale",
    homework: "Devoir Maison",
    oral: "Présentation orale",
    sheets: "Fiche",
  };
  return map[category.toLowerCase()] || category;
};

const predictFromPatterns = (label: string): string => {
  for (const [category, regexList] of Object.entries(compiledPatterns)) {
    if (regexList.some(pattern => pattern.test(label))) {
      return beautifyCategory(category);
    }
  }
  return "";
};

export function isModelPrediction(object: unknown): object is ModelPrediction {
  return (
    typeof object === "object" &&
    object !== null &&
    Array.isArray((object as any).scores) &&
    typeof (object as any).predicted === "string" &&
    typeof (object as any).labelScores === "object" &&
    (object as any).labelScores !== null
  );
}

export async function predictHomework(label: string, magicEnabled: boolean = true): Promise<string> {
  const store = useMagicStore.getState();
  const homeworkId = generateId(label);
  const existingHomework = store.getHomework(homeworkId);

  if (existingHomework) return existingHomework.label;
  if (!magicEnabled) return "";

  const saveAndReturn = (prediction: string) => {
    store.addHomework({ id: homeworkId, label: prediction });
    return prediction;
  };

  // Web uses the lightweight rule engine. It avoids loading the native TFLite
  // runtime or asking for battery APIs once for every row in the task list.
  if (Platform.OS === "web") {
    return saveAndReturn(predictFromPatterns(label));
  }

  let batteryLevel = 1;
  try {
    batteryLevel = await Battery.getBatteryLevelAsync();
  } catch {
    // The model still works on devices that don't expose battery information.
  }
  if (batteryLevel < 0.1) {
    return saveAndReturn(predictFromPatterns(label));
  }

  // Keep TensorFlow/TFLite out of the initial application module graph. The
  // runtime is loaded only after a visible task requests a native prediction.
  let prediction: unknown;
  try {
    const { default: ModelManager } = await import("./ModelManager");
    await ModelManager.safeInit();
    prediction = await ModelManager.predict(label);
  } catch {
    // Continue with the local rule fallback if model loading or download fails.
    return saveAndReturn(predictFromPatterns(label));
  }
  if (!isModelPrediction(prediction)) {
    return saveAndReturn(predictFromPatterns(label));
  }

  const labelMap: Record<string, string> = {
    evaluation: "Évaluation",
    finaltask: "Tâche finale",
    homework: "Devoir Maison",
    null: "null",
    oral: "Présentation orale",
    sheets: "Fiche",
  };
  const predicted = prediction.predicted;
  const finalLabel = predicted === "null"
    ? ""
    : labelMap[predicted.toLowerCase()] ?? predicted
      .split("_")
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(" ");

  return saveAndReturn(finalLabel);
}
