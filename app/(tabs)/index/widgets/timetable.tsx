import { Link } from "expo-router";
import { differenceInCalendarDays, formatDistanceToNowStrict, startOfDay } from "date-fns";
import { t } from "i18next";
import React from 'react';
import { FlatList } from "react-native";
import * as DateLocale from 'date-fns/locale';

import { CourseStatus, getManualCourseStatus } from "@/services/shared/timetable";
import Course from "@/ui/components/Course";
import { getSubjectColor } from "@/utils/subjects/colors";
import { getSubjectName } from "@/utils/subjects/name";
import i18n from "@/utils/i18n";
import { useTimetableWidgetData } from "../hooks/useTimetableWidgetData";
import { getStatusText } from '../../calendar/components/CalendarDay';
import { getCourseRouteId } from '@/database/useTimetable';
import Typography from "@/ui/components/Typography";

function getRelativeDayStatus(date: Date): string | null {
  const days = differenceInCalendarDays(startOfDay(date), startOfDay(new Date()));

  if (days <= 0) {
    return null;
  }

  if (days === 1) {
    return t("Tomorrow");
  }

  const distance = formatDistanceToNowStrict(startOfDay(date), {
    addSuffix: true,
    unit: "day",
    locale: DateLocale[i18n.language as keyof typeof DateLocale] || DateLocale.enUS,
  });

  return distance.charAt(0).toUpperCase() + distance.slice(1);
}

const HomeTimeTableWidget = React.memo(() => {
  const { courses } = useTimetableWidgetData();

  if (courses.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary" style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
        {t("Home_Timetable_Empty", "Aucun cours à venir")}
      </Typography>
    );
  }

  return (
    <FlatList
      scrollEnabled={false}
      data={courses.slice(0, 3)}
      style={{ width: '100%', paddingHorizontal: 10, paddingBottom: 4 }}
      renderItem={({ item }) => {
        const manualStatus = getManualCourseStatus(item);
        return (
          <Link
            href={{ pathname: "/(modals)/course/[id]", params: { id: getCourseRouteId(item) } }}
            asChild
          >
            <Course
              key={item.id}
              id={item.id}
              name={getSubjectName(item.subject)}
              teacher={item.teacher}
              room={item.room}
              color={getSubjectColor(item.subject)}
              status={{ label: manualStatus || item.customStatus || getStatusText(item.status), canceled: item.status === CourseStatus.CANCELED || manualStatus === COURSE_CANCELLED_LABEL, manual: Boolean(manualStatus) }}
              variant="primary"
              start={Math.floor(item.from.getTime() / 1000)}
              end={Math.floor(item.to.getTime() / 1000)}
              readonly={!!item.createdByAccount}
              compact={true}
            />
          </Link>
        );
      }}
    />
  );
});

export default HomeTimeTableWidget;
