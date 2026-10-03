import { useState, useRef, useEffect, useCallback } from 'react';
import { FlatList, useWindowDimensions } from 'react-native';
import { getWeekNumberFromDate } from "@/database/useHomework";
import { warn } from "@/utils/logger/logger";
import { trackAdvancedEvent } from "@/utils/logger/analytics";

export const CALENDAR_WINDOW_SIZE = 15;
const INITIAL_INDEX = Math.floor(CALENDAR_WINDOW_SIZE / 2);
const RECENTER_EDGE = 3;

export function useCalendarState() {
  const [date, setDate] = useState(new Date());
  const [weekNumber, setWeekNumber] = useState(getWeekNumberFromDate(date));
  const [currentIndex, setCurrentIndex] = useState(INITIAL_INDEX);
  const lastTrackedDateKey = useRef<string>("");
  const flatListRef = useRef<FlatList<any>>(null);
  const referenceDate = useRef(new Date());
  const lastEmittedIndex = useRef(INITIAL_INDEX);
  const { width: windowWidth } = useWindowDimensions();
  // Set while the pager is being re-laid out after a window resize. Scroll
  // offsets are meaningless until the correction scroll lands, so they must not
  // be turned into a new date.
  const isResizingRef = useRef(false);

  useEffect(() => {
    referenceDate.current.setHours(0, 0, 0, 0);
  }, []);

  const centerListOnDate = useCallback((selectedDate: Date) => {
    const anchorDate = new Date(selectedDate);
    anchorDate.setHours(0, 0, 0, 0);
    referenceDate.current = anchorDate;
    setCurrentIndex(INITIAL_INDEX);
    lastEmittedIndex.current = INITIAL_INDEX;

    const offset = INITIAL_INDEX * windowWidth;
    isResizingRef.current = true;
    flatListRef.current?.scrollToOffset({ offset, animated: false });
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToOffset({ offset, animated: false });
      isResizingRef.current = false;
    });
  }, [windowWidth]);

  const recenterAtIndex = useCallback((index: number, selectedDate: Date) => {
    if (index > RECENTER_EDGE && index < CALENDAR_WINDOW_SIZE - 1 - RECENTER_EDGE) {
      return false;
    }

    centerListOnDate(selectedDate);
    return true;
  }, [centerListOnDate]);

  useEffect(() => {
    const dateKey = new Date(date).toDateString();
    if (lastTrackedDateKey.current === dateKey) {
      return;
    }
    lastTrackedDateKey.current = dateKey;
    trackAdvancedEvent("calendar_day_changed");
  }, [date]);

  const getDateFromIndex = useCallback((index: number) => {
    const d = new Date(referenceDate.current);
    d.setDate(referenceDate.current.getDate() + (index - INITIAL_INDEX));
    return d;
  }, []);

  const getIndexFromDate = useCallback((d: Date) => {
    const base = new Date(referenceDate.current);
    base.setHours(0, 0, 0, 0);
    const target = new Date(d);
    target.setHours(0, 0, 0, 0);
    const diff = Math.round((target.getTime() - base.getTime()) / (1000 * 60 * 60 * 24));
    return INITIAL_INDEX + diff;
  }, []);

  const handleDateChange = useCallback((newDate: Date) => {
    centerListOnDate(newDate);
    setDate(newDate);
    const newWeekNumber = getWeekNumberFromDate(newDate);
    if (newWeekNumber !== weekNumber) {
      setWeekNumber(newWeekNumber);
    }
  }, [weekNumber, centerListOnDate]);

  // Sync FlatList with date
  useEffect(() => {
    const newIndex = getIndexFromDate(date);
    const newWeekNumber = getWeekNumberFromDate(date);

    if (newIndex !== currentIndex) {
      setCurrentIndex(newIndex);
      if (flatListRef.current) {
        try {
          flatListRef.current.scrollToIndex({
            index: newIndex,
            animated: false,
          });
        } catch (e) {
          warn(String(e))
        }
      }
    }

    if (newWeekNumber !== weekNumber) {
      setWeekNumber(newWeekNumber);
    }
  }, [date, getIndexFromDate, currentIndex, weekNumber]);

  const onMomentumScrollEnd = useCallback((e: any) => {
    if (isResizingRef.current) {return;}
    const newIndex = Math.round(e.nativeEvent.contentOffset.x / windowWidth);
    if (newIndex !== currentIndex) {
      setCurrentIndex(newIndex);
      const newDate = getDateFromIndex(newIndex);
      setDate((prev) => prev.getTime() !== newDate.getTime() ? newDate : prev);
    }
  }, [windowWidth, currentIndex, getDateFromIndex]);

  const onScroll = useCallback((e: any) => {
    if (isResizingRef.current) {return;}
    const offsetX = e.nativeEvent.contentOffset.x;
    const newIndex = Math.round(offsetX / windowWidth);
    if (newIndex !== lastEmittedIndex.current) {
      lastEmittedIndex.current = newIndex;
      setCurrentIndex(newIndex);
      const newDate = getDateFromIndex(newIndex);
      setDate((prev) => prev.getTime() !== newDate.getTime() ? newDate : prev);
      const newWeekNumber = getWeekNumberFromDate(newDate);
      if (newWeekNumber !== weekNumber) {
        setWeekNumber(newWeekNumber);
      }
    }
  }, [windowWidth, getDateFromIndex, weekNumber]);

  return {
    date,
    setDate,
    weekNumber,
    setWeekNumber,
    currentIndex,
    flatListRef,
    getDateFromIndex,
    getIndexFromDate,
    handleDateChange,
    onMomentumScrollEnd,
    onScroll,
    recenterAtIndex,
    isResizingRef,
    INITIAL_INDEX,
    windowWidth
  };
}
