/**
 * HomeScreen — M3 calendar view.
 *
 * Composes:
 *   - MonthView (calendar grid, US holidays, event dots)
 *   - CalendarBottomSheet (week strip + 24h time-sheet, swipe-up)
 *   - FAB to open event creation
 *
 * Data: stubbed EventOccurrence list for M3. Real API wiring (GET /occurrences)
 * lands in Month 3 once auth flows are complete.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, Text, SafeAreaView } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@planpal/ui';
import { MonthView } from '../src/components/calendar/MonthView';
import { CalendarBottomSheet } from '../src/components/calendar/CalendarBottomSheet';
import type { OccurrenceItem } from '../src/components/calendar/EventBar';
import { today } from '../src/lib/calendarUtils';

const TODAY_STUB = today();

// ---------------------------------------------------------------------------
// Stub events — replaced by GET /occurrences in Month 3.
// ---------------------------------------------------------------------------
const STUB_EVENTS: OccurrenceItem[] = [
  {
    eventId: 'stub-1',
    occurrenceDate: TODAY_STUB,
    title: 'Morning standup',
    localStart: `${TODAY_STUB}T09:30:00`,
    localEnd: `${TODAY_STUB}T09:45:00`,
    timezoneId: 'America/New_York',
    visibility: 'private',
    colorLabel: null,
    isException: false,
    isVariableSchedule: false,
  },
  {
    eventId: 'stub-2',
    occurrenceDate: TODAY_STUB,
    title: 'Lunch',
    localStart: `${TODAY_STUB}T12:00:00`,
    localEnd: `${TODAY_STUB}T13:00:00`,
    timezoneId: 'America/New_York',
    visibility: 'shared_all',
    colorLabel: '#30a46c',
    isException: false,
    isVariableSchedule: false,
  },
];

export default function HomeScreen() {
  const router = useRouter();

  const todayDate = new Date();
  const [year, setYear] = useState(todayDate.getFullYear());
  const [month, setMonth] = useState(todayDate.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState(() => today());

  const handlePrevMonth = useCallback(() => {
    if (month === 1) { setMonth(12); setYear((y) => y - 1); }
    else setMonth((m) => m - 1);
  }, [month]);

  const handleNextMonth = useCallback(() => {
    if (month === 12) { setMonth(1); setYear((y) => y + 1); }
    else setMonth((m) => m + 1);
  }, [month]);

  // Group stub events by date.
  const eventsByDate = useMemo(() => {
    const map: Record<string, OccurrenceItem[]> = {};
    for (const e of STUB_EVENTS) {
      (map[e.occurrenceDate] ??= []).push(e);
    }
    return map;
  }, []);

  const eventDots = useMemo(
    () => Object.keys(eventsByDate).map((date) => ({ date })),
    [eventsByDate],
  );

  const handleDayPress = useCallback((date: string) => {
    setSelectedDate(date);
  }, []);

  const handleEventPress = useCallback((event: OccurrenceItem) => {
    // Navigate to event detail — placeholder for M3 detail screen.
    console.log('Event pressed:', event.title);
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      {/* Month grid */}
      <MonthView
        year={year}
        month={month}
        eventDots={eventDots}
        onDayPress={handleDayPress}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
      />

      {/* Swipe-up bottom sheet with week strip + time-sheet */}
      <CalendarBottomSheet
        initialDate={selectedDate}
        eventsByDate={eventsByDate}
        onEventPress={handleEventPress}
        onDateChange={setSelectedDate}
      />

      {/* FAB — create event */}
      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push('/create-event')}
        accessibilityLabel="Create event"
        accessibilityRole="button"
      >
        <Text style={styles.fabIcon}>+</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  fab: {
    position: 'absolute',
    bottom: 140, // sits above the collapsed bottom sheet
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: theme.colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 28,
    color: theme.colors.textInverse,
    lineHeight: 32,
    marginTop: -2,
  },
});
