import React, { useCallback, useMemo } from "react";
import { Platform, RefreshControl, StyleSheet, View } from "react-native";

import { Homework } from "@/services/shared/homework";
import List from "@/ui/new/List";
import useResizable from "@/ui/utils/Resizable";

import DateHeader from "../atoms/DateHeader";
import EmptyState from "../atoms/EmptyState";
import TaskItem from "./TaskItem";
import { useTheme } from "expo-router/react-navigation";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useHeaderHeight } from "expo-router/react-navigation";
import TasksSummary from "../atoms/TasksSummary";

export interface HomeworkSection {
  id: string;
  title: string;
  date?: Date;
  data: Homework[];
}

interface TasksListProps {
  sections: HomeworkSection[];
  searchTerm: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  collapsedGroups: string[];
  toggleGroup: (headerId: string) => void;
  sortMethod: string;
  setAsDone: (item: Homework, done: boolean) => void;
  isLoaded?: boolean;
  hasError?: boolean;
  totalHomeworkCount: number;
  remainingHomeworkCount: number;
  animateItems?: boolean;
}

const TasksList: React.FC<TasksListProps> = ({
  sections,
  searchTerm,
  isRefreshing,
  onRefresh,
  collapsedGroups,
  toggleGroup,
  sortMethod,
  setAsDone,
  isLoaded = true,
  hasError = false,
  totalHomeworkCount,
  remainingHomeworkCount,
  animateItems = true,
}) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { isLarge } = useResizable();

  const taskKeyExtractor = useCallback((item: Homework) => (
    (item.id ? `${item.createdByAccount}:${item.id}` : undefined) ??
      "hw:" + item.subject + item.content + item.createdByAccount + new Date(item.dueDate).toDateString()
  ), []);

  const visibleSections = useMemo(
    () => sections.filter(section => section.data.length > 0),
    [sections]
  );
  const showsDayGroups = sortMethod === "date" && searchTerm.trim().length === 0;
  const cardColumns = isLarge && showsDayGroups ? 2 : 1;

  // Each FlashList cell holds at most two cards. The old day-sized cells
  // rendered every task in a group at once, disabling useful virtualization.
  const rows = useMemo(() => {
    const result: React.ReactElement[] = [];
    const renderTask = (item: Homework, index: number) => (
      <TaskItem
        item={item}
        index={index}
        fromCache={item.fromCache}
        animated={animateItems}
        setAsDone={setAsDone}
      />
    );

    for (const section of visibleSections) {
      if (section.title && sortMethod === "date") {
        result.push(
          <List.View key={`day-${section.id}`} id={`day-${section.id}`}>
            <DateHeader
              title={section.title}
              isCollapsed={collapsedGroups.includes(section.id)}
              onToggle={() => toggleGroup(section.id)}
            />
          </List.View>
        );
      }

      if (collapsedGroups.includes(section.id)) continue;

      const stride = cardColumns;
      for (let index = 0; index < section.data.length; index += stride) {
        const first = section.data[index];
        const second = stride === 2 ? section.data[index + 1] : undefined;
        const rowId = `tasks-${taskKeyExtractor(first)}${second ? `-${taskKeyExtractor(second)}` : ""}`;

        result.push(
          <List.View key={rowId} id={rowId}>
            {stride === 1 ? renderTask(first, index) : (
              <View style={{ flexDirection: "row", gap: 12 }}>
                <View style={{ flex: 1, minWidth: 0 }}>{renderTask(first, index)}</View>
                {second ? (
                  <View style={{ flex: 1, minWidth: 0 }}>{renderTask(second, index + 1)}</View>
                ) : <View style={{ flex: 1 }} />}
              </View>
            )}
          </List.View>
        );
      }
    }

    return result;
  }, [visibleSections, sortMethod, collapsedGroups, toggleGroup, taskKeyExtractor, animateItems, setAsDone, cardColumns]);

  return (
    <List
      style={[styles.list, { backgroundColor: colors.overground }]}
      contentContainerStyle={{
        paddingLeft: 16,
        paddingRight: insets.right > 10 ? 0 : 16,
        paddingBottom: Platform.OS === "web" ? 88 : 16,
      }}
      contentInsetAdjustmentBehavior="automatic"
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      ListHeaderComponent={isLoaded && Platform.OS !== "web" ? (
        <TasksSummary
          totalCount={totalHomeworkCount}
          remainingCount={remainingHomeworkCount}
          headerHeight={headerHeight}
        />
      ) : null}
      ListEmptyComponent={
        isLoaded || hasError ? (
          <EmptyState isSearching={searchTerm.length > 0} hasError={hasError} />
        ) : null
      }
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />}
    >
      {rows}
    </List>
  );
};

const styles = StyleSheet.create({
  list: {
    flex: 1,
    height: "100%",
  },
});

export default TasksList;
