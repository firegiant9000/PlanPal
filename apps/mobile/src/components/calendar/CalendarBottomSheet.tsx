/**
 * CalendarBottomSheet — swipe-up panel that reveals the WeekStrip + DayTimeSheet.
 *
 * Behaviour:
 *   - Collapsed: just the WeekStrip is visible at the bottom of the screen.
 *   - Expanded: full-height panel with WeekStrip + vertical 24h DayTimeSheet.
 *   - Horizontal swipe between days changes the selected date.
 *   - Vertical drag on the handle collapses / expands the panel.
 *
 * Implemented with Animated.Value (no external library) to keep the
 * dependency footprint minimal for M3. A BottomSheetModal upgrade is
 * planned for Post-V1 if more complex snap-point logic is needed.
 */
import React, { useCallback, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  PanResponder,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme } from '@planpal/ui';
import { WeekStrip } from './WeekStrip';
import { DayTimeSheet } from './DayTimeSheet';
import type { OccurrenceItem } from './EventBar';
import { TODAY } from '../../lib/calendarUtils';

const { height: SCREEN_H } = Dimensions.get('window');
const COLLAPSED_HEIGHT = 120; // WeekStrip + handle
const EXPANDED_HEIGHT = SCREEN_H * 0.85;
const SNAP_THRESHOLD = 60; // px drag before snapping

interface CalendarBottomSheetProps {
  initialDate?: string;
  eventsByDate: Record<string, OccurrenceItem[]>;
  onEventPress: (event: OccurrenceItem) => void;
  onDateChange?: (date: string) => void;
}

export function CalendarBottomSheet({
  initialDate = TODAY,
  eventsByDate,
  onEventPress,
  onDateChange,
}: CalendarBottomSheetProps) {
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [expanded, setExpanded] = useState(false);

  const animHeight = useRef(new Animated.Value(COLLAPSED_HEIGHT)).current;
  const dragStart = useRef(0);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, { dy }) => Math.abs(dy) > 8,
      onPanResponderGrant: (_, { y0 }) => {
        dragStart.current = y0;
      },
      onPanResponderRelease: (_, { dy }) => {
        const isExpanded = dy < -SNAP_THRESHOLD || (expanded && dy < SNAP_THRESHOLD);
        const targetHeight = isExpanded ? EXPANDED_HEIGHT : COLLAPSED_HEIGHT;
        setExpanded(isExpanded);
        Animated.spring(animHeight, {
          toValue: targetHeight,
          useNativeDriver: false,
          bounciness: 4,
        }).start();
      },
    }),
  ).current;

  const handleSelectDate = useCallback(
    (date: string) => {
      setSelectedDate(date);
      onDateChange?.(date);
      // Auto-expand when user taps a day.
      if (!expanded) {
        setExpanded(true);
        Animated.spring(animHeight, {
          toValue: EXPANDED_HEIGHT,
          useNativeDriver: false,
          bounciness: 4,
        }).start();
      }
    },
    [expanded, animHeight, onDateChange],
  );

  const dayEvents = eventsByDate[selectedDate] ?? [];

  return (
    <Animated.View style={[styles.sheet, { height: animHeight }]}>
      {/* Drag handle */}
      <View {...panResponder.panHandlers} style={styles.handleArea}>
        <View style={styles.handle} />
      </View>

      {/* Week strip */}
      <WeekStrip
        anchorDate={selectedDate}
        selectedDate={selectedDate}
        onSelectDate={handleSelectDate}
      />

      {/* Day time-sheet (only visible when expanded) */}
      {expanded && (
        <DayTimeSheet
          date={selectedDate}
          events={dayEvents}
          onEventPress={onEventPress}
        />
      )}

      {/* Collapsed hint */}
      {!expanded && dayEvents.length > 0 && (
        <View style={styles.collapsedHint}>
          <Text style={styles.hintText}>
            {dayEvents.length} event{dayEvents.length !== 1 ? 's' : ''} · swipe up to view
          </Text>
        </View>
      )}
      {!expanded && dayEvents.length === 0 && (
        <View style={styles.collapsedHint}>
          <Text style={styles.hintText}>No events · swipe up to view day</Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.colors.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 12,
  },
  handleArea: {
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.gray300,
  },
  collapsedHint: {
    paddingVertical: theme.spacing.sm,
    alignItems: 'center',
  },
  hintText: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.sm,
    color: theme.colors.textSecondary,
  },
});
