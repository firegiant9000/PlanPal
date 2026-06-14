/**
 * DayTimeSheet — vertical 24-hour scroll view for a single day.
 * Shows event bars positioned by their localStart/localEnd.
 * Horizontal swipe between days is handled by the parent (CalendarBottomSheet).
 */
import React, { useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { theme } from '@planpal/ui';
import { timeToHourFraction } from '../../lib/calendarUtils';
import { EventBar, type OccurrenceItem } from './EventBar';

const HOUR_HEIGHT = 60; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const TOTAL_HEIGHT = 24 * HOUR_HEIGHT;

const pad = (n: number) => String(n).padStart(2, '0');
const fmtHour = (h: number) => {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
};

interface DayTimeSheetProps {
  date: string;
  events: OccurrenceItem[];
  onEventPress: (event: OccurrenceItem) => void;
}

export function DayTimeSheet({ events, onEventPress }: DayTimeSheetProps) {
  const scrollRef = useRef<ScrollView>(null);

  // Lay out events in columns to handle overlaps.
  const laid = layoutEvents(events);

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
            <Text style={styles.hourLabel}>{fmtHour(h)}</Text>
            <View style={styles.hourLine} />
          </View>
        ))}

        {/* Event bars */}
        <View style={styles.eventsLayer}>
          {laid.map(({ event, top, height, column, totalColumns }) => (
            <EventBar
              key={`${event.eventId}-${event.occurrenceDate}`}
              event={event}
              hourHeight={HOUR_HEIGHT}
              topOffset={top}
              barHeight={height}
              column={column}
              totalColumns={totalColumns}
              onPress={onEventPress}
            />
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

interface LaidEvent {
  event: OccurrenceItem;
  top: number;
  height: number;
  column: number;
  totalColumns: number;
}

function layoutEvents(events: OccurrenceItem[]): LaidEvent[] {
  // Sort by start time, then by end time descending.
  const sorted = [...events]
    .filter((e) => !e.isVariableSchedule)
    .sort((a, b) => a.localStart.localeCompare(b.localStart));

  const laid: LaidEvent[] = [];
  // Columns: track which column each "slot" ends at.
  const columns: number[] = []; // columns[i] = end fraction of column i's current event

  for (const event of sorted) {
    const startFrac = timeToHourFraction(event.localStart);
    const endFrac = timeToHourFraction(event.localEnd);
    const top = startFrac * HOUR_HEIGHT;
    const height = Math.max((endFrac - startFrac) * HOUR_HEIGHT, 20);

    // Find first available column.
    let col = columns.findIndex((end) => end <= startFrac);
    if (col === -1) { col = columns.length; columns.push(0); }
    columns[col] = endFrac;

    laid.push({ event, top, height, column: col, totalColumns: 0 });
  }

  // Second pass: set totalColumns = max column used in each overlapping group.
  for (let i = 0; i < laid.length; i++) {
    const { top: topA, height: hA, column: colA } = laid[i]!;
    const endA = topA + hA;
    let max = colA;
    for (let j = 0; j < laid.length; j++) {
      if (j === i) continue;
      const { top: topB, height: hB, column: colB } = laid[j]!;
      const endB = topB + hB;
      // Overlapping?
      if (topB < endA && topA < endB) max = Math.max(max, colB);
    }
    laid[i]!.totalColumns = max + 1;
  }

  return laid;
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
