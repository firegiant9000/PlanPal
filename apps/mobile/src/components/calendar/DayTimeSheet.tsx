/**
 * DayTimeSheet — vertical 24-hour scroll view for a single day.
 * Shows event bars positioned by their localStart/localEnd.
 * Horizontal swipe between days is handled by the parent (CalendarBottomSheet).
 */
import React, { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@planpal/ui';
import { fmtHourLabel, layoutDay } from '@planpal/calendar-core';
import { EventBar, type OccurrenceItem } from './EventBar';

const HOUR_HEIGHT = 60; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TOTAL_HEIGHT = 24 * HOUR_HEIGHT;
/** Below this a bar cannot show its title; a presentation floor, not maths. */
const MIN_BAR_HEIGHT = 20;

interface DayTimeSheetProps {
  date: string;
  events: OccurrenceItem[];
  onEventPress: (event: OccurrenceItem) => void;
}

export function DayTimeSheet({ events, onEventPress }: DayTimeSheetProps) {
  const scrollRef = useRef<ScrollView>(null);

  // Overlap packing lives in @planpal/calendar-core so web cannot end up with
  // a second, divergent copy (AD-3). It returns fractions of a 24-hour day;
  // converting those to this sheet's pixel scale is the view's job.
  const laid = layoutDay(events);

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={{ height: TOTAL_HEIGHT + 32 }}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.grid}>
        {/* Hour rows */}
        {HOURS.map((h) => (
          <View key={h} style={[styles.hourRow, { top: h * HOUR_HEIGHT }]}>
            <Text style={styles.hourLabel}>{fmtHourLabel(h)}</Text>
            <View style={styles.hourLine} />
          </View>
        ))}

        {/* Event bars */}
        <View style={styles.eventsLayer}>
          {laid.map(({ occurrence, topFraction, heightFraction, column, columnCount }) => (
            <EventBar
              key={`${occurrence.eventId}-${occurrence.occurrenceDate}`}
              event={occurrence}
              hourHeight={HOUR_HEIGHT}
              topOffset={topFraction * TOTAL_HEIGHT}
              barHeight={Math.max(heightFraction * TOTAL_HEIGHT, MIN_BAR_HEIGHT)}
              column={column}
              totalColumns={columnCount}
              onPress={onEventPress}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flex: 1,
    backgroundColor: theme.colors.bg,
  },
  grid: {
    position: 'relative',
    marginLeft: 56,
    marginRight: 8,
  },
  hourRow: {
    position: 'absolute',
    left: -56,
    right: 0,
    height: HOUR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  hourLabel: {
    width: 52,
    paddingRight: 8,
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: 10,
    color: theme.colors.textSecondary,
    textAlign: 'right',
    marginTop: -6,
  },
  hourLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.colors.border,
    marginTop: 0,
  },
  eventsLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
