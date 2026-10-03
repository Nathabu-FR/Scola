import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import { useTheme } from "expo-router/react-navigation";
import { Papicons } from "@getpapillon/papicons";

import Typography from "@/ui/new/Typography";
import i18n from "@/utils/i18n";
import { getMonthOfWeek, getWeeksOfMonth } from "../utils/weekGrid";

interface WeekPickerProps {
  visible: boolean;
  selectedWeek: number;
  onSelectWeek: (week: number) => void;
  onClose: () => void;
  anchor?: { top?: number; left?: number; width?: number };
}

const shiftMonth = (year: number, month: number, delta: number) => {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
};

export default function WeekPicker({ visible, selectedWeek, onSelectWeek, onClose, anchor }: WeekPickerProps) {
  const { colors } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const selectedMonth = getMonthOfWeek(selectedWeek);
  const [displayMonth, setDisplayMonth] = useState(selectedMonth);

  useEffect(() => {
    if (visible) setDisplayMonth(selectedMonth);
  }, [visible, selectedMonth.year, selectedMonth.month]);

  const weeks = useMemo(
    () => getWeeksOfMonth(displayMonth.year, displayMonth.month),
    [displayMonth.year, displayMonth.month]
  );
  const title = new Date(displayMonth.year, displayMonth.month, 1).toLocaleDateString(i18n.language, {
    month: "long",
    year: "numeric",
  });
  const cardWidth = Math.min(320, screenWidth - 32);
  const left = Math.max(16, Math.min(anchor?.left ?? 16, screenWidth - cardWidth - 16));
  const top = (anchor?.top ?? 0) + 8;

  if (!visible) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable accessibilityRole="button" accessibilityLabel="Fermer le sélecteur de semaine" onPress={onClose} style={StyleSheet.absoluteFill} />
      <View style={[styles.card, { top, left, width: cardWidth, backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.monthHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mois précédent"
            onPress={() => setDisplayMonth(current => shiftMonth(current.year, current.month, -1))}
            style={[styles.monthArrow, { backgroundColor: colors.background }]}
          >
            <Papicons name="ArrowLeft" size={17} color={colors.text} />
          </Pressable>
          <Typography variant="title" weight="semibold" style={{ flex: 1, textAlign: "center" }}>
            {title}
          </Typography>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mois suivant"
            onPress={() => setDisplayMonth(current => shiftMonth(current.year, current.month, 1))}
            style={[styles.monthArrow, { backgroundColor: colors.background }]}
          >
            <Papicons name="ArrowRight" size={17} color={colors.text} />
          </Pressable>
        </View>

        <View style={styles.weekGrid}>
          {weeks.map(week => {
            const selected = week.index === selectedWeek;
            const dateRange = `${week.start.toLocaleDateString(i18n.language, { day: "numeric", month: "short" })} – ${week.end.toLocaleDateString(i18n.language, { day: "numeric", month: "short" })}`;
            return (
              <Pressable
                key={week.index}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  onSelectWeek(week.index);
                  onClose();
                }}
                style={[styles.weekOption, { backgroundColor: selected ? colors.primary : colors.background }]}
              >
                <Typography variant="body2" weight="semibold" style={{ color: selected ? "#FFFFFF" : colors.text }}>
                  {`Semaine ${week.label}`}
                </Typography>
                <Typography variant="caption" style={{ color: selected ? "#FFFFFFCC" : colors.textSecondary }}>
                  {dateRange}
                </Typography>
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
    padding: 12,
    borderWidth: 1,
    borderRadius: 18,
    zIndex: 80,
    elevation: 14,
    shadowColor: "#000000",
    shadowOpacity: 0.28,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  monthHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 10,
  },
  monthArrow: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  weekGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  weekOption: {
    width: "48%",
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    justifyContent: "center",
  },
});