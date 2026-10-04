import { Stack } from 'expo-router';
import { useHeaderHeight, useTheme } from 'expo-router/react-navigation';
import { t } from 'i18next';
import { Papicons } from "@getpapillon/papicons";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { InteractionManager, Platform, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Reanimated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';
import type { SFSymbol } from 'sf-symbols-typescript';

import { TipIds } from '@/constants/Tips';
import {
  getDateRangeOfWeek,
  getHomeworkRouteId,
  getWeekNumberFromDate,
  useAllHomeworkFromCache,
} from '@/database/useHomework';
import type { Homework } from '@/services/shared/homework';
import { retireTip } from '@/stores/tips';
import { useAlert } from "@/ui/components/AlertProvider";
import Search from '@/ui/components/Search';
import Tip from '@/ui/components/Tip';
import MainTabErrorBoundary from '@/ui/components/MainTabErrorBoundary';
import Typography from '@/ui/new/Typography';
import AnimatedPressable from '@/ui/components/AnimatedPressable';
import { runsIOS26 } from '@/ui/utils/IsLiquidGlass';
import i18n from '@/utils/i18n';

import { AndroidHeaderButton, AndroidHeaderMenu } from '@/components/AndroidHeaderItems';
import AndroidBackButton from '@/utils/theme/AndroidBackButton';
import TasksSummary from './atoms/TasksSummary';

import TasksWeekPage from './components/TasksWeekPage';
import WeekPicker from './components/WeekPicker';
import { useHomeworkData } from './hooks/useHomeworkData';
import { useTaskFilters } from './hooks/useTaskFilters';
import { useWeekSelection } from './hooks/useWeekSelection';
import type { SortMethod } from './hooks/useTaskFilters';
import { getWeekIndexOfDate } from './utils/weekGrid';

const isAndroid = Platform.OS === 'android';

const TITLE_SLIDE_RATIO = 0.4; // Slide this share of the screen width when changing titles

// Geometry of the leading toolbar button, which the week popover points at. The
// button is native and cannot host a SwiftUI anchor, so the popover hangs off an
// invisible strip centered on this box instead, and the box has to be restated
// here rather than measured.
const TOOLBAR_BUTTON_INSET = 40;
const TOOLBAR_BUTTON_SIZE = 40;

// Width of the invisible strip the week-scrolling tip attaches to. Centered in
// the screen and about as wide as the title it points at, so the popover's
// arrow lands under the title rather than off to one side.
const TIP_ANCHOR_WIDTH = 160;

// One title per week around the settled one. Keyed by absolute week index, so a
// layer is never remounted while it is on screen.
const TITLE_LAYER_OFFSETS = [-2, -1, 0, 1, 2];

// Weeks mounted around the visible one — and the order they are rendered in.
// The settled week comes first on purpose: UIKit binds the header (search bar
// collapse, scroll-edge material) to the first scroll view it finds walking
// down first children, so the list the user is actually scrolling has to be it.
// Two weeks on each side also cover a fast flick without landing on an empty
// page, and they are the weeks the data layer keeps warm.
const PAGE_OFFSETS = [0, -1, 1, -2, 2];
// Opening the screen only needs the week on screen and the one on either side;
// the outer two are mounted once the app is idle, well before a swipe can reach
// them. The first three entries match PAGE_OFFSETS so nothing is reordered.
const INITIAL_PAGE_OFFSETS = PAGE_OFFSETS.slice(0, 3);

// Carries the finger's velocity into the settle, so a flick keeps its momentum
// instead of restarting as a timed slide. Kept just under critical damping:
// overdamping is what makes a pager feel like it is dragging its feet.
const PAGE_SPRING = {
  damping: 24,
  stiffness: 320,
  mass: 0.6,
  overshootClamping: true,
  restDisplacementThreshold: 1,
  restSpeedThreshold: 10,
} as const;
// How far a flick is projected past the finger when picking the target page.
const VELOCITY_PROJECTION = 0.12;
// Horizontal travel that claims the touch for the pager, and the vertical
// travel that hands it back to the list. Deciding the axis by hand instead
// would mean holding the touch until the finger moves — which makes every tap
// on a task wait for a gesture that is never coming.
// Roughly two to one, so a swipe can drift off the horizontal and still page,
// while anything meant as a scroll gets out well before it pages.
const PAN_ACTIVATE_X = 14;
const PAN_FAIL_Y = 30;

const getSortings = (): { value: SortMethod; label: string; sf: SFSymbol; papicon: string }[] => [
  { value: 'date', label: t('Tasks_Sorting_Methods_DueDate'), sf: 'calendar', papicon: 'Calendar' },
  { value: 'subject', label: t('Tasks_Sorting_Methods_Subject'), sf: 'character', papicon: 'List' },
  { value: 'done', label: t('Tasks_Sorting_Methods_Done'), sf: 'checkmark.circle', papicon: 'Check' },
  { value: 'undone', label: 'Non faits uniquement', sf: 'circle', papicon: 'Check' },
];

// The pager addresses weeks as an offset from the week the screen opened in;
// this is the number a human reads on the calendar.
const getDisplayedWeekNumber = (week: number) =>
  getWeekNumberFromDate(getDateRangeOfWeek(week, new Date().getFullYear()).start);

interface WeekLabels {
  main: string;
  relative?: string;
}

function getWeekLabels(week: number, currentWeek: number): WeekLabels {
  return {
    main: `${t('Tasks_Week')} ${getDisplayedWeekNumber(week)}`,
    relative: week === currentWeek ? t('Tasks_ThisWeek') : undefined,
  };
}

// `pageOffset` is the week this layer renders, in pages away from the pager's
// origin. `offset` is the pager's live position in pixels, so the layer is
// centered when the two line up and slides/fades away as they drift apart.
function TitleLayer({ offset, pageOffset, pageWidth, labels, slideDistance }: {
  offset: SharedValue<number>;
  pageOffset: number;
  pageWidth: number;
  labels: WeekLabels;
  slideDistance: number;
}) {
  const style = useAnimatedStyle(() => {
    const distance = pageOffset - offset.value / pageWidth;
    return {
      opacity: Math.max(0, 1 - Math.abs(distance)),
      transform: [{ translateX: distance * slideDistance }],
    };
  });

  return (
    <Reanimated.View pointerEvents="none" style={[styles.titleLayer, style]}>
      <Typography variant="header" weight="semibold" numberOfLines={1}>
        {labels.main}
      </Typography>
      {labels.relative && (
        <Typography variant="body2" color="textSecondary" weight="semibold" numberOfLines={1} style={styles.titleSubtitle}>
          {labels.relative}
        </Typography>
      )}
    </Reanimated.View>
  );
}

const TasksView: React.FC = () => {
  const alert = useAlert();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const headerHeight = useHeaderHeight();

  const {
    defaultWeek,
    selectedWeek,
    showWeekPicker,
    toggleWeekPicker,
    onSelectWeek,
    setShowWeekPicker,
    getWeekFromIndex,
    getIndexFromWeek,
    windowWidth,
    INITIAL_INDEX,
  } = useWeekSelection();
  const { colors } = useTheme();

  const weeksToLoad = useMemo(
    () => INITIAL_PAGE_OFFSETS.map(offset => selectedWeek + offset),
    [selectedWeek]
  );

  const {
    homeworkByWeek,
    refreshingWeek,
    handleRefresh,
    setAsDone,
    error: homeworkError,
    failures: homeworkFailures,
  } = useHomeworkData(weeksToLoad, alert);

  // Home reads assignments from the all-cache observer while Tasks used three
  // narrow week queries. Build the pager pages from that same complete cache so
  // every assignment visible on Home can also be found in its due week here.
  const allCachedHomeworks = useAllHomeworkFromCache();
  const tasksByWeek = useMemo(() => {
    const grouped = new Map<number, Map<string, Homework>>();
    const add = (homework: Homework, preferIncoming: boolean) => {
      const week = getWeekIndexOfDate(homework.dueDate);
      let items = grouped.get(week);
      if (!items) {
        items = new Map();
        grouped.set(week, items);
      }

      const key = `${homework.createdByAccount}:${getHomeworkRouteId(homework)}`;
      const existing = items.get(key);
      items.set(
        key,
        existing && preferIncoming
          ? { ...existing, ...homework, id: existing.id || homework.id, fromCache: homework.fromCache }
          : existing ?? homework
      );
    };

    allCachedHomeworks.forEach(homework => add(homework, false));
    Object.values(homeworkByWeek).flat().forEach(homework => add(homework, true));

    return Object.fromEntries(
      [...grouped.entries()].map(([week, items]) => [
        week,
        [...items.values()].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()),
      ])
    ) as Record<number, Homework[]>;
  }, [allCachedHomeworks, homeworkByWeek]);

  // The home widget previews the next three due assignments, which can belong
  // to the following week (especially when opening Tasks on Sunday). Keep the
  // week pager intact, but give those cached assignments a direct route from
  // an otherwise empty current week.
  const nextHomeworkWeek = useMemo(() => {
    if ((tasksByWeek[selectedWeek] ?? []).length > 0) return undefined;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return allCachedHomeworks
      .filter(homework => !homework.isDone && homework.dueDate.getTime() >= today.getTime())
      .map(homework => getWeekIndexOfDate(homework.dueDate))
      .filter(week => week !== selectedWeek && (tasksByWeek[week] ?? []).length > 0)
      .sort((a, b) => a - b)[0];
  }, [allCachedHomeworks, selectedWeek, tasksByWeek]);

  const hasHomeworkError = Boolean(homeworkError) || homeworkFailures.length > 0;

  const currentWeekTaskCounts = useMemo(() => {
    const seen = new Set<string>();
    const items = (tasksByWeek[selectedWeek] ?? []).filter(homework => {
      const key = homework.id
        ? `${homework.createdByAccount}:${homework.id}`
        : `${homework.createdByAccount}:${homework.subject}:${homework.content}:${homework.dueDate.getTime()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return {
      total: items.length,
      remaining: items.filter(homework => !homework.isDone).length,
    };
  }, [tasksByWeek, selectedWeek]);

  const {
    searchTerm,
    setSearchTerm,
    showUndoneOnly,
    setShowUndoneOnly,
    sortMethod,
    setSortMethod,
    collapsedGroups,
    toggleGroup,
  } = useTaskFilters();

  const sortings = useMemo(() => getSortings(), [i18n.language]);
  const [showWebSortings, setShowWebSortings] = useState(false);

  const [pageOffsets, setPageOffsets] = useState(INITIAL_PAGE_OFFSETS);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setPageOffsets(PAGE_OFFSETS));
    return () => task.cancel();
  }, []);

  // The header is rebuilt natively whenever its options change, so the toolbar
  // label is anchored to the last *settled* week instead of the live one:
  // nothing in the header changes while a swipe is in flight.
  const [settledIndex, setSettledIndex] = useState(INITIAL_INDEX);
  const settledLabels = getWeekLabels(getWeekFromIndex(settledIndex), defaultWeek);
  const weekLabel = Platform.OS === "web" ? settledLabels.main : settledLabels.relative ?? settledLabels.main;

  // The pager's live position, in pixels away from the origin page. Pages are
  // laid out at their own fixed offsets and the row is translated by this, so
  // mounting or dropping a page never disturbs what is on screen.
  const offsetX = useSharedValue(0);
  const gestureStartOffset = useSharedValue(0);
  // How far the finger had already travelled when the pager took over:
  // subtracting it keeps the page from jumping by the activation slop.
  const activationTranslation = useSharedValue(0);
  // The page a settle animation is heading for, until it lands.
  const pendingPage = useSharedValue<number | null>(null);

  // A window resize changes the page width under the pager, so the translation
  // has to be recomputed for the new geometry. Page offsets follow from the
  // render, so there is nothing else to correct.
  const previousWidth = useRef(windowWidth);
  useLayoutEffect(() => {
    if (previousWidth.current === windowWidth) {
      return;
    }
    previousWidth.current = windowWidth;

    cancelAnimation(offsetX);
    pendingPage.value = null;
    offsetX.value = (settledIndex - INITIAL_INDEX) * windowWidth;
  }, [windowWidth, settledIndex, INITIAL_INDEX, offsetX, pendingPage]);

  // Everything that costs React work — mounting the next page, moving the data
  // window, rebuilding the native header — is held back until the settle
  // animation has come to rest, so none of it competes with the motion. The
  // weeks on either side are already mounted and loaded, so there is nothing to
  // wait for mid-swipe.
  const commitPage = useCallback((page: number) => {
    const index = INITIAL_INDEX + page;
    setSettledIndex(previous => (previous === index ? previous : index));
    onSelectWeek(getWeekFromIndex(index));
  }, [INITIAL_INDEX, onSelectWeek, getWeekFromIndex]);

  // A pan rather than a horizontal scroll view: a scroll view here would be the
  // first one in the screen, and the native header would follow it instead of
  // the week the user is reading.
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-PAN_ACTIVATE_X, PAN_ACTIVATE_X])
        .failOffsetY([-PAN_FAIL_Y, PAN_FAIL_Y])
        .onStart(event => {
          // The swipe *is* the thing the tip was teaching, so it goes now —
          // waiting for the settle would let it flash back mid-gesture.
          runOnJS(retireTip)(TipIds.tasksWeekScroll);
          cancelAnimation(offsetX);
          // Swiping again before the last settle came to rest: commit it now,
          // otherwise the page being swiped towards may not be mounted.
          if (pendingPage.value !== null) {
            const page = pendingPage.value;
            pendingPage.value = null;
            runOnJS(commitPage)(page);
          }
          gestureStartOffset.value = offsetX.value;
          activationTranslation.value = event.translationX;
        })
        .onUpdate(event => {
          offsetX.value = gestureStartOffset.value - (event.translationX - activationTranslation.value);
        })
        .onEnd(event => {
          const startPage = Math.round(gestureStartOffset.value / windowWidth);
          const projected = (offsetX.value - event.velocityX * VELOCITY_PROJECTION) / windowWidth;
          // One page per gesture, however hard the flick.
          const target = Math.min(startPage + 1, Math.max(startPage - 1, Math.round(projected)));

          pendingPage.value = target;
          offsetX.value = withSpring(
            target * windowWidth,
            { ...PAGE_SPRING, velocity: -event.velocityX },
            finished => {
              if (finished && pendingPage.value === target) {
                pendingPage.value = null;
                runOnJS(commitPage)(target);
              }
            }
          );
        }),
    [windowWidth, offsetX, gestureStartOffset, activationTranslation, pendingPage, commitPage]
  );

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: -offsetX.value }],
  }));

  // Kept referentially stable so the memoized picker is not re-rendered, and
  // its SwiftUI host not re-fed props, on every week crossing.
  const weekPickerAnchor = useMemo(() => ({
    top: runsIOS26 ? headerHeight : 0,
    left: Platform.OS === "web" && screenWidth >= 960 ? 150 : TOOLBAR_BUTTON_INSET,
    width: Platform.OS === "web" && screenWidth >= 960 ? 180 : TOOLBAR_BUTTON_SIZE,
  }), [headerHeight, screenWidth]);

  // Stable across week crossings, so the tip's SwiftUI host is not re-fed props
  // every time the pager settles.
  const weekTipStyle = useMemo(
    () => ({ top: weekPickerAnchor.top, left: 0, right: 0 }),
    [weekPickerAnchor.top]
  );

  const closeWeekPicker = useCallback(() => setShowWeekPicker(false), [setShowWeekPicker]);

  const handlePickWeek = useCallback((week: number) => {
    const index = getIndexFromWeek(week);
    cancelAnimation(offsetX);
    pendingPage.value = null;
    offsetX.value = (index - INITIAL_INDEX) * windowWidth;
    setSettledIndex(index);
    onSelectWeek(week);
  }, [getIndexFromWeek, onSelectWeek, INITIAL_INDEX, windowWidth, offsetX, pendingPage]);

  const renderWebHeaderLeft = useCallback(() => (
    <View style={styles.webHeaderLeading}>
      <AndroidBackButton />
      <Typography variant="header" weight="semibold" numberOfLines={1}>
        {t("Tab_Tasks")}
      </Typography>
      <View style={styles.webHeaderWeekControls}>
        <Pressable accessibilityRole="button" accessibilityLabel="Semaine précédente" onPress={() => handlePickWeek(selectedWeek - 1)} style={[styles.webWeekArrow, { backgroundColor: colors.card }]}>
          <Papicons name="ArrowLeft" size={17} color={colors.text} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Choisir ${weekLabel}`} onPress={toggleWeekPicker} style={[styles.webHeaderWeekButton, { backgroundColor: colors.card }]}>
          <Papicons name="Calendar" size={17} color={colors.primary} />
          <Typography variant="body2" weight="semibold" numberOfLines={1}>{weekLabel}</Typography>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Semaine suivante" onPress={() => handlePickWeek(selectedWeek + 1)} style={[styles.webWeekArrow, { backgroundColor: colors.card }]}>
          <Papicons name="ArrowRight" size={17} color={colors.text} />
        </Pressable>
      </View>
    </View>
  ), [colors.card, colors.primary, colors.text, handlePickWeek, selectedWeek, toggleWeekPicker, weekLabel]);

  const renderWebHeaderRight = useCallback(() => (
    <Pressable accessibilityRole="button" accessibilityLabel={t("Task_Sorting_Title")} accessibilityState={{ expanded: showWebSortings }} onPress={() => setShowWebSortings(value => !value)} style={[styles.webHeaderSortButton, { backgroundColor: colors.card }]}>
      <Papicons name="Filter" size={17} color={colors.primary} />
      <Typography variant="body2" weight="semibold">{t("Task_Sorting_Title")}</Typography>
    </Pressable>
  ), [colors.card, colors.primary, showWebSortings]);

  return (
    <>
      {Platform.OS === "web" && screenWidth >= 960 && (
        <Stack.Screen options={{ headerTitle: "", headerBackVisible: false, headerLeft: renderWebHeaderLeft, headerRight: renderWebHeaderRight }} />
      )}
      {isAndroid ? (
        <Stack.Toolbar placement="left" asChild>
          <AndroidHeaderButton icon="Calendar" accessibilityLabel={weekLabel} onPress={toggleWeekPicker} />
        </Stack.Toolbar>
      ) : Platform.OS === "ios" ? (
        <Stack.Toolbar placement="left">
          <Stack.Toolbar.Button icon="calendar" onPress={toggleWeekPicker}>
            {weekLabel}
          </Stack.Toolbar.Button>
        </Stack.Toolbar>
      ) : null}

      {Platform.OS === "ios" && (
        <Stack.Title asChild>
          <View style={[styles.titleContainer, { width: screenWidth - (Platform.OS === "android" ? 72 : 140) }]}>
            {TITLE_LAYER_OFFSETS.map(offset => {
              const pageIndex = settledIndex + offset;
              return (
                <TitleLayer
                  key={pageIndex}
                  offset={offsetX}
                  pageOffset={pageIndex - INITIAL_INDEX}
                  pageWidth={windowWidth}
                  labels={getWeekLabels(getWeekFromIndex(pageIndex), defaultWeek)}
                  slideDistance={screenWidth * TITLE_SLIDE_RATIO}
                />
              );
            })}
          </View>
        </Stack.Title>
      )}

      {isAndroid ? (
        <Stack.Toolbar placement="right" asChild>
          <AndroidHeaderMenu
            icon="Filter"
            accessibilityLabel={t('Task_Sorting_Title')}
            actions={[
              ...sortings.map(sorting => ({
                id: sorting.value,
                title: sorting.label,
                papicon: sorting.papicon,
                state: sortMethod === sorting.value ? 'on' : 'off',
              })),
              // Le bouton « filtrer par non terminé » manquait sur Android :
              // on l'ajoute au menu natif plutôt que de le cacher.
              {
                id: "__undone_only",
                title: "Non terminés uniquement",
                papicon: "Check",
                state: showUndoneOnly ? "on" : "off",
              },
            ]}
            onPressAction={({ nativeEvent }) => {
              if (nativeEvent.event === "__undone_only") {
                setShowUndoneOnly(value => !value);
                return;
              }
              setSortMethod(nativeEvent.event as SortMethod);
            }}
          />
        </Stack.Toolbar>
      ) : Platform.OS === "ios" ? (
        <Stack.Toolbar placement="right">
          <Stack.Toolbar.Menu>
            <Stack.Toolbar.Icon sf="line.3.horizontal.decrease" />
            <Stack.Toolbar.Label>{t('Task_Sorting_Title')}</Stack.Toolbar.Label>
            {sortings.map(sorting => (
              <Stack.Toolbar.MenuAction
                key={sorting.value}
                isOn={sortMethod === sorting.value}
                icon={sorting.sf}
                onPress={() => setSortMethod(sorting.value)}
              >
                {sorting.label}
              </Stack.Toolbar.MenuAction>
            ))}
            <Stack.Toolbar.MenuAction
              isOn={showUndoneOnly}
              icon={showUndoneOnly ? "checkmark.circle.fill" : "circle"}
              onPress={() => setShowUndoneOnly(value => !value)}
            >
              Non terminés uniquement
            </Stack.Toolbar.MenuAction>
          </Stack.Toolbar.Menu>
        </Stack.Toolbar>
      ) : null}

      {Platform.OS === "web" && screenWidth < 960 && (
        <View style={styles.webToolbar}>
          <View style={styles.webWeekControls}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Semaine précédente"
              onPress={() => handlePickWeek(selectedWeek - 1)}
              style={[styles.webWeekArrow, { backgroundColor: colors.card }]}
            >
              <Papicons name="ArrowLeft" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={toggleWeekPicker}
              style={[styles.webToolbarButton, { backgroundColor: colors.card }]}
            >
              <Papicons name="Calendar" size={18} color={colors.primary} />
              <Typography variant="body2" weight="semibold">{weekLabel}</Typography>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Semaine suivante"
              onPress={() => handlePickWeek(selectedWeek + 1)}
              style={[styles.webWeekArrow, { backgroundColor: colors.card }]}
            >
              <Papicons name="ArrowRight" size={18} color={colors.text} />
            </Pressable>
          </View>
          <Typography variant="title" weight="semibold">{settledLabels.main}</Typography>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowWebSortings(value => !value)}
            style={[styles.webToolbarButton, { backgroundColor: colors.card }]}
          >
            <Papicons name="Filter" size={18} color={colors.primary} />
            <Typography variant="body2" weight="semibold">{t('Task_Sorting_Title')}</Typography>
          </Pressable>
        </View>
      )}

      {Platform.OS === "web" && showWebSortings && (
        <View style={[styles.webSortMenu, { top: screenWidth >= 960 ? 8 : 54, backgroundColor: colors.card }]}>
          {sortings.map(sorting => (
            <Pressable
              key={sorting.value}
              accessibilityRole="button"
              accessibilityState={{ selected: sortMethod === sorting.value }}
              onPress={() => {
                setSortMethod(sorting.value);
                setShowWebSortings(false);
              }}
              style={styles.webSortOption}
            >
              <Typography
                variant="body2"
                weight={sortMethod === sorting.value ? "semibold" : "regular"}
                color={sortMethod === sorting.value ? colors.primary : undefined}
              >
                {sorting.label}
              </Typography>
            </Pressable>
          ))}
        </View>
      )}

      <View style={styles.container}>
        <Search
          placeholder={t('Tasks_Search_Placeholder')}
          value={searchTerm}
          setValue={setSearchTerm}
          style={{ alignSelf: "center", marginTop: 8, marginBottom: 4 }}
        />
        {(Platform.OS === "web" || Platform.OS === "android") && (
          <View style={Platform.OS === "web" ? styles.webFilterSummaryRow : undefined}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: showUndoneOnly }}
              accessibilityLabel="Afficher uniquement les devoirs non terminés"
              onPress={() => setShowUndoneOnly(value => !value)}
              style={[
                styles.desktopFilter,
                Platform.OS === "web" ? styles.webDesktopFilter : undefined,
                {
                  borderColor: showUndoneOnly ? colors.primary : colors.border,
                  backgroundColor: showUndoneOnly ? `${colors.primary}18` : colors.card,
                  userSelect: "none",
                },
              ] as any}
            >
              {showUndoneOnly ? (
                <Papicons name="Check" size={19} color={colors.primary} />
              ) : (
                <View style={[styles.uncheckedFilterIcon, { borderColor: colors.text + "88" }]} />
              )}
              <Typography variant="body1" weight="semibold" selectable={false}>
                Devoirs non terminés uniquement
              </Typography>
              <Typography variant="body2" color="textSecondary" style={{ marginLeft: "auto" }}>
                {showUndoneOnly ? "Activé" : "Filtrer"}
              </Typography>
            </Pressable>
            {Platform.OS === "web" && tasksByWeek[selectedWeek] !== undefined && (
              <TasksSummary inline totalCount={currentWeekTaskCounts.total} remainingCount={currentWeekTaskCounts.remaining} headerHeight={0} />
            )}
          </View>
        )}
        {nextHomeworkWeek !== undefined && (
          <Pressable
            accessibilityRole="button"
            onPress={() => handlePickWeek(nextHomeworkWeek)}
            style={[styles.nextHomeworkHint, { backgroundColor: colors.card, borderColor: colors.border }]}
          >
            <Typography variant="body2" color="textSecondary" style={{ flex: 1 }}>
              Des devoirs à venir sont enregistrés pour la semaine {getDisplayedWeekNumber(nextHomeworkWeek)}.
            </Typography>
            <Typography variant="body2" weight="semibold" color="primary">
              Afficher →
            </Typography>
          </Pressable>
        )}
        <GestureDetector gesture={panGesture}>
          <Reanimated.View style={[styles.pager, rowStyle]}>
            {pageOffsets.map(offset => {
              const index = settledIndex + offset;
              const week = getWeekFromIndex(index);

              return (
                <View
                  key={index}
                  style={[
                    styles.page,
                    { width: windowWidth, left: (index - INITIAL_INDEX) * windowWidth },
                  ]}
                >
                  <SafeAreaView edges={['left', 'right']} style={{ flex: 1, backgroundColor: colors.overground }}>
                    <TasksWeekPage
                      week={week}
                      homeworks={tasksByWeek[week]}
                      animateItems={index === INITIAL_INDEX}
                      searchTerm={searchTerm}
                      sortMethod={sortMethod}
                      showUndoneOnly={showUndoneOnly}
                      collapsedGroups={collapsedGroups}
                      toggleGroup={toggleGroup}
                      isRefreshing={refreshingWeek === week}
                      onRefresh={handleRefresh}
                      setAsDone={setAsDone}
                      hasError={hasHomeworkError}
                    />
                  </SafeAreaView>
                </View>
              );
            })}
          </Reanimated.View>
        </GestureDetector>
      </View>

      {/* Rendered last so the pager stays the screen's first child: the native
          header binds to the first scroll view it finds from there. Mounted
          whether or not it is open, because the popover attaches to an anchor
          that has to already exist when the toolbar button is tapped. */}
      <WeekPicker
        visible={showWeekPicker}
        selectedWeek={selectedWeek}
        onSelectWeek={handlePickWeek}
        onClose={closeWeekPicker}
        anchor={weekPickerAnchor}
      />

      <AnimatedPressable
        accessibilityRole="button"
        accessibilityLabel="Ajouter un devoir personnel"
        onPress={() => router.push("/(modals)/tasks/create")}
        style={{
          position: "absolute",
          right: 22,
          bottom: Platform.OS === "web" ? 14 : insets.bottom + 18,
          zIndex: 20,
          width: 56,
          height: 56,
          borderRadius: 28,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: colors.primary,
          shadowColor: "#000",
          shadowOpacity: 0.25,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 3 },
          elevation: 5,
        }}
      >
        <Papicons name="Add" size={26} color="#FFFFFF" />
      </AnimatedPressable>

      {/* Hangs off the same line as the week popover — just under the header —
          so its arrow points back up at the title. */}
      <Tip
        tipId={TipIds.tasksWeekScroll}
        title={t('Tasks_Tip_Weeks_Title')}
        message={t('Tasks_Tip_Weeks_Message')}
        systemImage="hand.draw"
        width={TIP_ANCHOR_WIDTH}
        style={weekTipStyle}
      />
    </>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: "hidden",
  },
  desktopFilter: {
    minHeight: 44,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  webFilterSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
  },
  nextHomeworkHint: {
    minHeight: 42,
    marginHorizontal: 16,
    marginTop: 6,
    marginBottom: 4,
    paddingHorizontal: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  webDesktopFilter: {
    flex: 1,
    minWidth: 260,
    marginHorizontal: 0,
    marginTop: 0,
    marginBottom: 0,
  },
  uncheckedFilterIcon: {
    width: 18,
    height: 18,
    borderWidth: 2,
    borderRadius: 9,
  },
  webHeaderLeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  webHeaderWeekControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginLeft: 10,
  },
  webHeaderWeekButton: {
    minHeight: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 170,
  },
  webHeaderSortButton: {
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  webToolbar: {
    minHeight: 48,
    marginHorizontal: 16,
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  webToolbarButton: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 20,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  webWeekControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  webWeekArrow: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  webSortMenu: {
    position: "absolute",
    top: 54,
    right: 16,
    minWidth: 190,
    paddingVertical: 6,
    borderRadius: 14,
    zIndex: 30,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 12,
  },
  webSortOption: {
    minHeight: 40,
    paddingHorizontal: 14,
    justifyContent: "center",
  },
  pager: {
    flex: 1,
  },
  page: {
    position: "absolute",
    top: 0,
    bottom: 0,
  },
  // Fixed size, so the header title view never re-measures when the labels swap
  // or the subtitle comes and goes. Every layer fills this same box.
  titleContainer: {
    height: 44,
  },
  titleLayer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    // Android headers align their title to the leading edge; iOS centers it.
    alignItems: Platform.OS === "android" ? "flex-start" : "center",
    paddingHorizontal: Platform.OS === "android" ? 10 : 0,
    justifyContent: "center",
  },
  titleSubtitle: {
    marginTop: -2,
  },
});

const TasksViewWithBoundary = () => (
  <MainTabErrorBoundary>
    <TasksView />
  </MainTabErrorBoundary>
);

export default TasksViewWithBoundary;
