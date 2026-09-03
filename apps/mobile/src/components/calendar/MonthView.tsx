/**
 * MonthView — M3 calendar grid.
 *
 * Renders a 6×7 grid for a given (year, month), with:
 *   - Current-day highlight
 *   - US federal holiday labels (non-editable, gray text)
 *   - Dot indicators for days that have events
 *   - Friend avatar bubbles (stubbed — shows initials, wired in B3/B4)
 *   - Tap on a day → calls onDayPress to open the bottom sheet
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '@planpal/ui';
import {
  buildMonthGrid,
  fmtMonthHeader,
  getHolidayName,
  type CalendarDay,
} from '@planpal/calendar-core';

export interface EventDot {
  date: string;
  color?: string;
}

// Stubbed friend avatar info — replaced by real friend data in B3/B4.
export interface FriendBubble {
  date: string;
  initials: string;
  color: string;
}

interface MonthViewProps {
  year: number;
  month: number;
  eventDots?: EventDot[];
  friendBubbles?: FriendBubble[];
  onDayPress: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthView({
  year,
  month,
  eventDots = [],
  friendBubbles = [],
  onDayPress,
  onPrevMonth,
  onNextMonth,
}: MonthViewProps) {
  const weeks = buildMonthGrid(year, month);
  const dotsByDate = new Set(eventDots.map((d) => d.date));
  const bubblesByDate = new Map<string, FriendBubble[]>();
  for (const b of friendBubbles) {
    const arr = bubblesByDate.get(b.date) ?? [];
    arr.push(b);
    bubblesByDate.set(b.date, arr);
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={onPrevMonth}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.navArrow}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.monthTitle}>{fmtMonthHeader(year, month)}</Text>
        <TouchableOpacity
          onPress={onNextMonth}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        >
          <Text style={styles.navArrow}>›</Text>
        </TouchableOpacity>
      </View>

      {/* Day-of-week labels */}
      <View style={styles.dowRow}>
        {DAY_LABELS.map((label) => (
          <View key={label} style={styles.dowCell}>
            <Text style={styles.dowLabel}>{label}</Text>
          </View>
        ))}
      </View>

      {/* Calendar grid */}
      {weeks.map((week, wi) => (
        <View key={wi} style={styles.week}>
          {week.map((day) => (
            <DayCell
              key={day.date}
              day={day}
              hasDot={dotsByDate.has(day.date)}
              bubbles={bubblesByDate.get(day.date) ?? []}
              onPress={() => onDayPress(day.date)}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

interface DayCellProps {
  day: CalendarDay;
  hasDot: boolean;
  bubbles: FriendBubble[];
  onPress: () => void;
}

function DayCell({ day, hasDot, bubbles, onPress }: DayCellProps) {
  const holiday = getHolidayName(day.date);

  return (
    <TouchableOpacity
      style={styles.dayCell}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityLabel={`${day.date}${holiday ? `, ${holiday}` : ''}`}
    >
      {/* Day number */}
      <View style={[styles.dayNumber, day.isToday && styles.todayCircle]}>
        <Text
          style={[
            styles.dayText,
            day.isOutsideMonth && styles.outsideMonthText,
            day.isToday && styles.todayText,
            day.isWeekend && !day.isToday && styles.weekendText,
          ]}
        >
          {day.day}
        </Text>
      </View>

      {/* Holiday label */}
      {holiday && !day.isOutsideMonth && (
        <Text style={styles.holidayLabel} numberOfLines={1}>
          {holiday}
        </Text>
      )}

      {/* Event dot */}
      {hasDot && <View style={styles.dot} />}

      {/* Stubbed friend avatar bubbles (B3/B4) */}
      {bubbles.length > 0 && (
        <View style={styles.bubblesRow}>
          {bubbles.slice(0, 3).map((b, i) => (
            <View key={i} style={[styles.bubble, { backgroundColor: b.color }]}>
              <Text style={styles.bubbleInitials}>{b.initials.slice(0, 2)}</Text>
            </View>
          ))}
        </View>
      )}
    </TouchableOpacity>
  );
}

const CELL_HEIGHT = 72;

const styles = StyleSheet.create({
  container: {
    backgroundColor: theme.colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
  },
  monthTitle: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.lg,
    fontWeight: theme.typography.fontWeight.bold,
    color: theme.colors.textPrimary,
  },
  navArrow: {
    fontSize: 24,
    color: theme.colors.accent,
    lineHeight: 28,
  },
  dowRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  dowCell: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: theme.spacing.xs,
  },
  dowLabel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.xs,
    fontWeight: theme.typography.fontWeight.semibold,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  week: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  dayCell: {
    flex: 1,
    minHeight: CELL_HEIGHT,
    padding: 4,
    alignItems: 'center',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: theme.colors.border,
  },
  dayNumber: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: {
    backgroundColor: theme.colors.accent,
  },
  dayText: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
  },
  todayText: {
    color: theme.colors.textInverse,
    fontWeight: theme.typography.fontWeight.bold,
  },
  outsideMonthText: {
    color: theme.colors.textSecondary,
    opacity: 0.4,
  },
  weekendText: {
    color: theme.colors.textSecondary,
  },
  holidayLabel: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: 9,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.colors.accent,
    marginTop: 3,
  },
  bubblesRow: {
    flexDirection: 'row',
    marginTop: 2,
    gap: 2,
  },
  bubble: {
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleInitials: {
    fontSize: 8,
    color: '#fff',
    fontWeight: '700',
  },
});
