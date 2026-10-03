import React, { useMemo, useState } from "react";
import { Pressable, View, type ColorValue } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { useTheme } from "expo-router/react-navigation";
import { t } from "i18next";

import Typography from "@/ui/new/Typography";
import {
  getDisplayDenominator,
  getDisplayScaleMax,
  toDisplayScaleFrom20,
  type GradeDisplayScale,
} from "@/utils/grades/scale";
import type { AverageHistoryPoint, AverageMethodKey } from "../hooks/useGradesData";

type AveragesProps = {
  history: Partial<Record<AverageMethodKey, AverageHistoryPoint[]>>;
  realAverage?: number | null;
  classAverage?: number | null;
  minimumAverage?: number | null;
  maximumAverage?: number | null;
  color?: ColorValue;
  displayScale?: GradeDisplayScale;
  compact?: boolean;
};

const METHODS: { key: AverageMethodKey; label: string }[] = [
  { key: "subject", label: t("Grades_Avg_Subject_Short", "Moy. matières") },
  { key: "weighted", label: t("Grades_Avg_All_Pond_Short", "Moy. pondérée") },
  { key: "median", label: t("Grades_Avg_Median_Short", "Médiane") },
];

const GRAPH_WIDTH = 640;
const GRAPH_HEIGHT = 156;
const GRAPH_LEFT = 12;
const GRAPH_RIGHT = GRAPH_WIDTH - 12;
const GRAPH_TOP = 10;
const GRAPH_BOTTOM = GRAPH_HEIGHT - 12;
const formatValue = (value: number | null | undefined, scale: GradeDisplayScale) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? "—"
    : toDisplayScaleFrom20(value, scale).toFixed(2);

function AverageMetric({
  title,
  value,
  displayScale,
  color,
  prominent = false,
}: {
  title: string;
  value?: number | null;
  displayScale: GradeDisplayScale;
  color: string;
  prominent?: boolean;
}) {
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <Typography variant="caption" color="textSecondary" numberOfLines={1}>
        {title}
      </Typography>
      <View style={{ flexDirection: "row", alignItems: "baseline", gap: 3 }}>
        <Typography
          variant={prominent ? "h2" : "h4"}
          weight="bold"
          numberOfLines={1}
          style={{ color }}
        >
          {formatValue(value, displayScale)}
        </Typography>
        {value !== null && value !== undefined && Number.isFinite(value) && (
          <Typography variant="caption" color="textSecondary">
            {getDisplayDenominator(displayScale)}
          </Typography>
        )}
      </View>
    </View>
  );
}

export default function Averages({
  history,
  realAverage,
  classAverage,
  minimumAverage,
  maximumAverage,
  color,
  displayScale = "20",
  compact = false,
}: AveragesProps) {
  const theme = useTheme();
  const accent = String(color ?? theme.colors.primary);
  const [method, setMethod] = useState<AverageMethodKey>("subject");
  const values = history[method] ?? [];
  const maxScale = getDisplayScaleMax(displayScale);

  const chartPoints = useMemo(() => {
    const valid = values
      .filter(point => Number.isFinite(point.average))
      .map(point => ({
        value: toDisplayScaleFrom20(point.average, displayScale),
        date: point.date,
      }))
      .filter(point => Number.isFinite(point.date.getTime()));

    const plotWidth = GRAPH_RIGHT - GRAPH_LEFT;
    const plotHeight = GRAPH_BOTTOM - GRAPH_TOP;
    return valid.map((point, index) => ({
      ...point,
      x: valid.length > 1
        ? GRAPH_LEFT + (index / (valid.length - 1)) * plotWidth
        : GRAPH_WIDTH / 2,
      y: GRAPH_BOTTOM - (Math.max(0, Math.min(maxScale, point.value)) / maxScale) * plotHeight,
    }));
  }, [values, displayScale, maxScale]);

  const linePath = chartPoints.length > 1
    ? chartPoints.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")
    : "";
  const lastHistoryValue = values.length > 0 ? values[values.length - 1].average : null;
  const shownOverall = realAverage ?? lastHistoryValue;
  const dateLabel = chartPoints.length > 0
    ? chartPoints[chartPoints.length - 1].date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : undefined;
  const firstDateLabel = chartPoints.length > 1
    ? chartPoints[0].date.toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : undefined;

  if ((shownOverall === null || shownOverall === undefined) && (classAverage === null || classAverage === undefined)) {
    return null;
  }

  const graph = (
    <View
      accessibilityRole="image"
      accessibilityLabel={t("Grades_Tip_Graph_Title", "Évolution de la moyenne")}
      style={{ height: compact ? 102 : 164, minWidth: 0, flex: 1 }}
    >
      <Svg width="100%" height="100%" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none">
        {[0.25, 0.5, 0.75].map(fraction => {
          const y = GRAPH_BOTTOM - fraction * (GRAPH_BOTTOM - GRAPH_TOP);
          return <Path key={fraction} d={`M ${GRAPH_LEFT} ${y} H ${GRAPH_RIGHT}`} stroke={theme.colors.border} strokeOpacity={0.55} strokeWidth={1} />;
        })}
        {linePath ? (
          <Path d={linePath} fill="none" stroke={accent} strokeWidth={5} strokeLinecap="round" strokeLinejoin="round" />
        ) : chartPoints.length === 1 ? (
          <Circle cx={chartPoints[0].x} cy={chartPoints[0].y} r={7} fill={accent} />
        ) : null}
        {chartPoints.length > 1 && (
          <Circle cx={chartPoints[chartPoints.length - 1].x} cy={chartPoints[chartPoints.length - 1].y} r={6} fill={accent} />
        )}
      </Svg>
      {!compact && (
        <View style={{ flexDirection: "row", justifyContent: "space-between", paddingHorizontal: 2, marginTop: -3 }}>
          <Typography variant="caption" color="textSecondary">{firstDateLabel ?? ""}</Typography>
          <Typography variant="caption" color="textSecondary">{dateLabel ?? ""}</Typography>
        </View>
      )}
    </View>
  );

  const overallTitle = t("Grades_Avg_All_Title", "Moyenne générale");
  const classTitle = t("Grades_Avg_Class_Title", "Moyenne de classe");

  if (compact) {
    return (
      <View style={{ backgroundColor: theme.colors.item, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 10 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <View style={{ flex: 1.2, minWidth: 0 }}>{graph}</View>
          <View style={{ flex: 1, minWidth: 0, gap: 8, paddingRight: 4 }}>
            <AverageMetric title={overallTitle} value={shownOverall} displayScale={displayScale} color={accent} prominent />
            {classAverage !== null && classAverage !== undefined && (
              <AverageMetric title={classTitle} value={classAverage} displayScale={displayScale} color={theme.colors.text} />
            )}
          </View>
        </View>
        <Typography variant="caption" color="textSecondary" numberOfLines={1} style={{ marginTop: 2 }}>
          {realAverage !== null && realAverage !== undefined
            ? t("Grades_Avg_Source_School", "Donnée par l’établissement")
            : t("Grades_Avg_Source_Estimated", "Estimation") + (dateLabel ? ` · ${dateLabel}` : "")}
        </Typography>
      </View>
    );
  }

  return (
    <View style={{ backgroundColor: theme.colors.item, borderRadius: 24, padding: 18, gap: 14, width: "100%" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Typography variant="title" weight="semibold">{t("Grades_Avg_History_Title", "Évolution des moyennes")}</Typography>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {METHODS.map(option => {
            const active = method === option.key;
            return (
              <Pressable
                key={option.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setMethod(option.key)}
                style={{
                  minHeight: 34,
                  paddingHorizontal: 12,
                  borderRadius: 18,
                  justifyContent: "center",
                  backgroundColor: active ? theme.colors.primary : theme.colors.background,
                }}
              >
                <Typography variant="caption" weight="semibold" style={{ color: active ? "#fff" : theme.colors.text }} numberOfLines={1}>
                  {option.label}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </View>

      {graph}

      <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap", borderTopWidth: 1, borderTopColor: theme.colors.border, paddingTop: 12 }}>
        <AverageMetric title={overallTitle} value={shownOverall} displayScale={displayScale} color={accent} prominent />
        {classAverage !== null && classAverage !== undefined && <AverageMetric title={classTitle} value={classAverage} displayScale={displayScale} color={theme.colors.text} />}
        {minimumAverage !== null && minimumAverage !== undefined && (
          <AverageMetric title={t("Grades_Avg_Class_Min", "Min. classe")} value={minimumAverage} displayScale={displayScale} color={theme.colors.text + "88"} />
        )}
        {maximumAverage !== null && maximumAverage !== undefined && (
          <AverageMetric title={t("Grades_Avg_Class_Max", "Max. classe")} value={maximumAverage} displayScale={displayScale} color={theme.colors.text + "88"} />
        )}
      </View>
      <Typography variant="caption" color="textSecondary">
        {realAverage !== null && realAverage !== undefined
          ? t("Grades_Avg_Source_School", "Moyenne transmise par l’établissement")
          : t("Grades_Avg_Source_Estimated", "La moyenne générale est estimée à partir des notes")}
      </Typography>
    </View>
  );
}
