import React from "react";
import { View } from "react-native";
import { t } from "i18next";
import Typography from "@/ui/components/Typography";
import { Homework } from "@/services/shared/homework";
import TaskItem from "../../tasks/components/TaskItem";

export default function HomeHomeworkWidget({
  homeworks,
  setAsDone,
}: {
  homeworks: Homework[];
  setAsDone: (item: Homework, done: boolean) => void;
}) {
  const visibleHomeworks = homeworks.slice(0, 3);

  return (
    <View style={{ width: "100%", paddingHorizontal: 10, paddingBottom: 4 }}>
      {visibleHomeworks.length === 0 ? (
        <Typography variant="body2" color="textSecondary" style={{ paddingHorizontal: 6, paddingBottom: 10 }}>
          {t("Home_Homework_Empty", "Aucun devoir restant")}
        </Typography>
      ) : visibleHomeworks.map((item, index) => (
        <TaskItem
          key={item.id ?? `${item.subject}-${item.dueDate.toISOString()}`}
          item={item}
          index={index}
          animated={false}
          setAsDone={setAsDone}
        />
      ))}
    </View>
  );
}
