/**
 * EventBar — a single event block in the DayTimeSheet.
 * Height and vertical position are computed from the event's localStart/localEnd.
 * Sensitive-public events show a gray "Busy" block with time/duration only.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { theme } from '@planpal/ui';
import { fmtTime } from '@planpal/calendar-core';
import { eventColor, type OccurrenceItem } from '../../lib/occurrenceWindow';

// The shape and the colour rule live in `lib/occurrenceWindow`, which imports
// no React Native and so is testable without a renderer. Re-exported because
// several calendar components already import the type from here.
export type { OccurrenceItem };

interface EventBarProps {
  event: OccurrenceItem;
  hourHeight: number; // px per hour in the time-sheet
  topOffset: number; // calculated by parent (hours from midnight * hourHeight)
  barHeight: number; // calculated by parent
  column: number; // 0-based column index for overlap layout
  totalColumns: number; // total columns in this time slot
  onPress: (event: OccurrenceItem) => void;
}

export function EventBar({
  event,
  hourHeight: _hourHeight,
  topOffset,
  barHeight,
  column,
  totalColumns,
  onPress,
}: EventBarProps) {
  const isSensitive = event.visibility === 'sensitive_public';
  const color = eventColor(event, column);
  const colWidth = 1 / totalColumns;

  const minHeight = Math.max(barHeight, 24);

  return (
    <TouchableOpacity
      style={[
        styles.bar,
        {
          top: topOffset,
          height: minHeight,
          left: `${column * colWidth * 100}%` as unknown as number,
          width: `${colWidth * 100}%` as unknown as number,
          backgroundColor: color + '33', // 20% opacity fill
          borderLeftColor: color,
        },
      ]}
      onPress={() => onPress(event)}
      activeOpacity={0.8}
      accessibilityLabel={isSensitive ? 'Busy' : event.title}
    >
      <Text style={[styles.title, { color }]} numberOfLines={1}>
        {isSensitive ? 'Busy' : event.title}
      </Text>
      {!isSensitive && barHeight > 32 && (
        <Text style={[styles.time, { color }]} numberOfLines={1}>
          {fmtTime(event.localStart)}
        </Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  bar: {
    position: 'absolute',
    borderLeftWidth: 3,
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingTop: 2,
    overflow: 'hidden',
  },
  title: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
  },
  time: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: 10,
    marginTop: 1,
  },
});
