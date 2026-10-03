import { Papicons } from '@getpapillon/papicons';
import { useIsFocused, useTheme } from "expo-router/react-navigation";
import { useRouter } from 'expo-router';
import { t } from 'i18next';
import React from 'react';
import { FlatList, Platform, StatusBar, useWindowDimensions, View } from 'react-native';
import Reanimated, { LinearTransition } from 'react-native-reanimated';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAccountStore } from '@/stores/account';
import { useAlert } from '@/ui/components/AlertProvider';
import { getHomeworkRouteId, getWeekNumberFromDate, useAllHomeworkFromCache } from '@/database/useHomework';
import { useSettingsStore } from '@/stores/settings';
import { Animation } from '@/ui/utils/Animation';

import HomeHeader from './atoms/HomeHeader';
import HomeTopBar from './atoms/HomeTopBar';
import Wallpaper from './atoms/Wallpaper';
import HomeWidget, { HomeWidgetItem } from './components/HomeWidget';
import { useHomeData } from './hooks/useHomeData';
import { useTimetableWidgetData } from './hooks/useTimetableWidgetData';
import { useTimetableWidgetTitle } from './hooks/useTimetableWidgetTitle';
import HomeTimeTableWidget from './widgets/timetable';
import HomeHomeworkWidget from './widgets/homework';
import { useHomeworkData } from '../tasks/hooks/useHomeworkData';
import GradesWidget from './widgets/Grades';
import { usePeriodsData } from '../grades/hooks/usePeriodsData';
import { useGradesData } from '../grades/hooks/useGradesData';
import MainTabErrorBoundary from '@/ui/components/MainTabErrorBoundary';
import { Dynamic } from '@/ui/components/Dynamic';
import Stack from '@/ui/components/Stack';
import Typography from '@/ui/components/Typography';
import Icon from '@/ui/components/Icon';
import Button from '@/ui/new/Button';

const HomeScreen = () => {
  const focused = useIsFocused();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const bottomTabBarHeight = insets.bottom + 76;
  const homeColumns = Platform.OS === "web" && windowWidth >= 760 ? 2 : 1;
  const alert = useAlert();

  // Account
  const store = useAccountStore();
  const accounts = useAccountStore((state) => state.accounts);
  const account = accounts.find(a => a.id === store.lastUsedAccount);
  const router = useRouter();
  const welcomeModalSeen = useSettingsStore(state => state.personalization.welcomeModalSeen);
  const mutateSettings = useSettingsStore(state => state.mutateProperty);

  React.useEffect(() => {
    if (accounts.length === 0) {
      router.replace("/(onboarding)/welcome");
      return;
    }

    if (account && account.transport === undefined) {
      store.initializeTransport(account.schoolName);
    }
  }, [account, accounts.length, router, store]);

  useHomeData();
  const { courses } = useTimetableWidgetData();
  const timetableTitle = useTimetableWidgetTitle(courses);

  const homeworkWeeks = React.useMemo(() => {
    const today = new Date();
    const weeks = Array.from({ length: 4 }, (_, index) => {
      const date = new Date(today);
      date.setDate(today.getDate() + index * 7);
      return getWeekNumberFromDate(date);
    });
    return [...new Set(weeks)];
  }, []);
  const { homeworkByWeek, setAsDone: setHomeworkAsDone } = useHomeworkData(homeworkWeeks, alert);
  const allCachedHomeworks = useAllHomeworkFromCache();
  const urgentHomeworks = React.useMemo(() => {
    const serviceIds = account?.services.map(service => service.id) ?? [];
    const candidates = [...allCachedHomeworks, ...Object.values(homeworkByWeek).flat()];
    const byId = new Map<string, (typeof candidates)[number]>();
    for (const homework of candidates) {
      if (homework.isDone) continue;
      if (!serviceIds.includes(homework.createdByAccount) && !(homework.custom && homework.createdByAccount === account?.id)) continue;
      byId.set(getHomeworkRouteId(homework), homework);
    }
    return [...byId.values()]
      .sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())
      .slice(0, 3);
  }, [account, allCachedHomeworks, homeworkByWeek]);

  const { currentPeriod } = usePeriodsData();
  const { grades, history, averages } = useGradesData(currentPeriod, Platform.OS === "web" ? { methods: ["subject"] } : undefined);
  const gradesWidgetHidden =
    grades.length === 0 &&
    !averages.student &&
    !averages.class &&
    Object.values(history).every(points => !points || points.length === 0);

  const renderTimeTable = React.useCallback(() => <HomeTimeTableWidget />, []);
  const renderGrades = React.useCallback(
    () => <GradesWidget history={history} averages={averages} />,
    [history, averages]
  );
  const data: HomeWidgetItem[] = React.useMemo(() => [
    {
      icon: <Papicons name={"Calendar"} />,
      title: timetableTitle,
      redirect: "(tabs)/calendar",
      render: renderTimeTable
    },
    {
      icon: <Papicons name={"List"} />,
      title: "Devoirs les plus urgents",
      redirect: "(tabs)/tasks",
      render: () => <HomeHomeworkWidget homeworks={urgentHomeworks} setAsDone={setHomeworkAsDone} />
    },
    {
      icon: <Papicons name={"Grades"} />,
      title: t("Home_Widget_Grades_Average"),
      redirect: "(tabs)/grades",
      hidden: gradesWidgetHidden,
      render: renderGrades
    }
  ], [account, courses.length, gradesWidgetHidden, renderGrades, renderTimeTable, timetableTitle, urgentHomeworks, setHomeworkAsDone]);

  const visibleWidgets = React.useMemo(
    () => data.filter(item => !item.hidden && (!item.dev || __DEV__)),
    [data]
  );
  const allWidgetsHidden = visibleWidgets.length === 0;

  React.useEffect(() => {
    if (!account || welcomeModalSeen) {
      return;
    }

    mutateSettings("personalization", { welcomeModalSeen: true });
    router.navigate("/(modals)/welcome");
  }, [account, mutateSettings, router, welcomeModalSeen]);

  return (
    <>
      <Wallpaper />
      <HomeTopBar />
      {focused && <StatusBar translucent animated barStyle={'light-content'} />}
      <HomeViewContainer key={"home"}>
        <FlatList
          key={"home-widgets-" + homeColumns}
          numColumns={homeColumns}
          columnWrapperStyle={homeColumns === 2 ? { gap: 12 } : undefined}
          renderItem={({ item }) => (
            <Reanimated.View
              layout={Animation(LinearTransition, "list")}
              style={{ flex: 1, minWidth: 0 }}
            >
              <HomeWidget item={item} />
            </Reanimated.View>
          )}
          keyExtractor={(item) => item.title}
          ListHeaderComponent={<HomeHeader />}
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: Platform.OS === 'ios' ? bottomTabBarHeight : 16,
            flexGrow: 1,
            gap: 12,
            marginTop: 6,
            width: '100%',
            maxWidth: 1100,
            marginHorizontal: 'auto',
            paddingHorizontal: 16,
          }}
          data={visibleWidgets}
          ListFooterComponent={
            <View style={{ gap: 12 }}>
              {allWidgetsHidden && <HomeEmptyState />}
            </View>
          }
        />
      </HomeViewContainer>
    </>
  );
};

const HomeEmptyState = React.memo(() => (
  <Dynamic animated key="home-widgets:empty" style={{ width: "100%" }}>
    <Stack hAlign="center" vAlign="center" flex padding={[22, 16]} gap={2} style={{ width: "100%" }}>
      <Icon papicon opacity={0.5} size={32} style={{ marginBottom: 3 }}>
        <Papicons name={"Ghost"} />
      </Icon>
      <Typography variant="h4" color="text" align="center">
        {t("Home_Widgets_Empty_Title")}
      </Typography>
      <Typography variant="body2" color="secondary" align="center">
        {t("Home_Widgets_Empty_Description")}
      </Typography>
    </Stack>
  </Dynamic>
));
HomeEmptyState.displayName = "HomeEmptyState";

const HomeViewContainer = ({ children }) => {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent', zIndex: 1 }} edges={["left", "right"]}>
      {children}
    </SafeAreaView>
  );
}

const HomeScreenWithBoundary = () => (
  <MainTabErrorBoundary>
    <HomeScreen />
  </MainTabErrorBoundary>
);

export default HomeScreenWithBoundary;
