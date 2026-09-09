/**
 * HomeScreen — the calendar, on real data.
 *
 * Composes:
 *   - MonthView (calendar grid, US holidays, event dots)
 *   - CalendarBottomSheet (week strip + 24h time-sheet, swipe-up)
 *   - FAB to open event creation
 *
 * Data comes from `src/lib/loadOccurrences` — cache first for an instant warm
 * start, then always a network refresh, which is what makes both "is this
 * stale?" and "are we offline?" answerable. The window and the colour rule are
 * pure functions in `src/lib/occurrenceWindow`. All three live outside this
 * file so they are testable without a renderer; the offline bug that shipped
 * here was in wiring no test could reach.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { theme } from '@planpal/ui';
import { currentYearMonth, today } from '@planpal/calendar-core';
import { MonthView } from '../src/components/calendar/MonthView';
import { CalendarBottomSheet } from '../src/components/calendar/CalendarBottomSheet';
import { CalendarState, EDITS_BLOCKED, type CalendarStateKind } from '../src/lib/emptyStates';
import { loadOccurrences } from '../src/lib/loadOccurrences';
import { OfflineBanner } from '../src/components/OfflineBanner';
import {
  occurrenceWindow,
  shiftLocalDateTime,
  type OccurrenceItem,
} from '../src/lib/occurrenceWindow';
import { planpalClient } from '../src/lib/planpalClient';

type LoadState = { kind: 'loading' } | { kind: 'ready' } | { kind: CalendarStateKind };

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

    void loadOccurrences(
      planpalClient.occurrences,
      window,
      // Early paint from cache, so a warm start renders immediately instead of
      // showing a spinner until the network answers.
      (cached) => {
        if (!active) return;
        setItems(cached.items);
        setStaleSince(cached.fetchedAt);
        setState({ kind: cached.items.length === 0 ? 'empty' : 'ready' });
      },
    ).then((result) => {
      if (!active) return;
      setItems(result.items);
      setStaleSince(result.fetchedAt);
      setOffline(result.offline);
      setState(
        result.failure !== null
          ? { kind: result.failure }
          : { kind: result.items.length === 0 ? 'empty' : 'ready' },
      );
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
    // `offline` belongs here: without it the callback captures the value from
    // the render that created it and the guard above never fires.
    [reload, offline],
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
