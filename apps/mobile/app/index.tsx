/**
 * HomeScreen — the calendar, on real data.
 *
 * Composes:
 *   - MonthView (calendar grid, US holidays, event dots)
 *   - CalendarBottomSheet (week strip + 24h time-sheet, swipe-up)
 *   - FAB to open event creation
 *
 * Reads `client.occurrences.range` for the whole visible grid. The window and
 * the colour rule are pure functions in `src/lib/occurrenceWindow`, so both are
 * testable without a renderer.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@planpal/ui';
import { PlanPalApiError } from '@planpal/api-client';
import { currentYearMonth, today } from '@planpal/calendar-core';
import { MonthView } from '../src/components/calendar/MonthView';
import { CalendarBottomSheet } from '../src/components/calendar/CalendarBottomSheet';
import { CalendarState, EDITS_BLOCKED, type CalendarStateKind } from '../src/lib/emptyStates';
import { OfflineBanner } from '../src/components/OfflineBanner';
import {
  occurrenceWindow,
  shiftLocalDateTime,
  type OccurrenceItem,
} from '../src/lib/occurrenceWindow';
import { planpalClient } from '../src/lib/planpalClient';

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: CalendarStateKind };

/**
 * Which state an error puts the screen into.
 *
 * A thrown `TypeError` from `fetch` is the offline case — there is no response
 * to read a status off, so it must be told apart by type rather than by code.
 */
function stateForError(error: unknown): CalendarStateKind {
  if (error instanceof PlanPalApiError) {
    return error.status === 401 || error.status === 403 ? 'forbidden' : 'failed';
  }
  return 'offline';
}

export default function HomeScreen() {
  const router = useRouter();

  const [initial] = useState(() => currentYearMonth());
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [selectedDate, setSelectedDate] = useState(() => today());

  const [items, setItems] = useState<OccurrenceItem[]>([]);
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  /** Non-null once a read has been served that we could not refresh (T29). */
  const [staleSince, setStaleSince] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  const window = useMemo(() => occurrenceWindow(year, month), [year, month]);

  useEffect(() => {
    let active = true;
    setState({ kind: 'loading' });

    planpalClient.occurrences
      // `cache-first` is what makes a cold start with no network show the last
      // known calendar instead of a spinner (T29, AD-10). `rangeDetailed`
      // rather than `range` because the banner needs `fetchedAt`.
      .rangeDetailed(window.from, window.to, { policy: 'cache-first' })
      .then(({ items: occurrences, fetchedAt }) => {
        if (!active) return;
        setStaleSince(fetchedAt);
        setOffline(false);
        setItems(
          occurrences.map((o) => ({
            eventId: o.eventId,
            occurrenceDate: o.occurrenceDate,
            title: o.title,
            localStart: o.localStart,
            localEnd: o.localEnd,
            timezoneId: o.timezoneId,
            visibility: o.visibility,
            colorLabel: o.colorLabel ?? null,
            isException: o.isException,
            isVariableSchedule: o.isVariableSchedule,
          })),
        );
        setState({ kind: occurrences.length === 0 ? 'empty' : 'ready' });
      })
      .catch((error: unknown) => {
        if (!active) return;
        const kind = stateForError(error);
        setOffline(kind === 'offline');
        // Keep whatever is on screen when we go offline: replacing a readable
        // calendar with an empty one is a worse offline experience than a
        // slightly stale one, which is the whole point of T29.
        if (kind !== 'offline') setItems([]);
        setState({ kind });
      });

    return () => {
      // A fast month-swipe leaves several reads in flight; without this the
      // slowest one wins and the screen shows a month the user has left.
      active = false;
    };
  }, [window, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const handlePrevMonth = useCallback(() => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }, [month]);

  const handleNextMonth = useCallback(() => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }, [month]);

  const eventsByDate = useMemo(() => {
    const map: Record<string, OccurrenceItem[]> = {};
    for (const e of items) (map[e.occurrenceDate] ??= []).push(e);
    return map;
  }, [items]);

  const eventDots = useMemo(
    () => Object.keys(eventsByDate).map((date) => ({ date })),
    [eventsByDate],
  );

  const handleDayPress = useCallback((date: string) => setSelectedDate(date), []);

  /**
   * Minimal occurrence actions.
   *
   * A proper editor is T28's shape of work; what T18 needs is that the
   * override and cancel routes are reachable from the phone and that the
   * calendar reflects the result. "Move an hour later" is a deliberate stand-in
   * for a time picker, not a shipping affordance.
   */
  const handleEventPress = useCallback(
    (event: OccurrenceItem) => {
      if (offline) {
        // Offline EDITING is Post-V1. Explain it rather than letting the write
        // fail with a network error the user cannot interpret (T29 DoD).
        Alert.alert('You are offline', EDITS_BLOCKED, [{ text: 'OK', style: 'cancel' }]);
        return;
      }

      Alert.alert(event.title, event.isException ? 'Moved occurrence' : 'Part of a series', [
        {
          text: 'Move 1 hour later',
          onPress: () => {
            void planpalClient.events
              .overrideOccurrence(event.eventId, event.occurrenceDate, {
                localStart: shiftLocalDateTime(event.localStart, 1),
                localEnd: shiftLocalDateTime(event.localEnd, 1),
              })
              .then(reload)
              .catch((e: unknown) =>
                Alert.alert('Could not move it', e instanceof Error ? e.message : 'Unknown error'),
              );
          },
        },
        {
          text: 'Cancel this occurrence',
          style: 'destructive',
          onPress: () => {
            void planpalClient.events
              .cancelOccurrence(event.eventId, event.occurrenceDate)
              .then(reload)
              .catch((e: unknown) =>
                Alert.alert(
                  'Could not cancel it',
                  e instanceof Error ? e.message : 'Unknown error',
                ),
              );
          },
        },
        { text: 'Dismiss', style: 'cancel' },
      ]);
    },
    [reload],
  );

  // Offline with something cached is not an error state — it renders the
  // calendar plus a banner. Offline with nothing cached still needs the state.
  const servingStale = offline && items.length > 0;
  const showState = !servingStale && state.kind !== 'ready' && state.kind !== 'loading';

  return (
    <SafeAreaView style={styles.root}>
      {servingStale ? <OfflineBanner fetchedAt={staleSince} /> : null}

      <MonthView
        year={year}
        month={month}
        eventDots={eventDots}
        onDayPress={handleDayPress}
        onPrevMonth={handlePrevMonth}
        onNextMonth={handleNextMonth}
      />

      {showState ? (
        <View style={styles.stateOverlay}>
          <CalendarState kind={state.kind as CalendarStateKind} onRetry={reload} />
        </View>
      ) : (
        <CalendarBottomSheet
          initialDate={selectedDate}
          eventsByDate={eventsByDate}
          onEventPress={handleEventPress}
          onDateChange={setSelectedDate}
        />
      )}

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
  stateOverlay: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
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
