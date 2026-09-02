/**
 * WeekStrip — horizontal 7-day row inside the swipe-up bottom sheet.
 * Tapping a day switches the DayTimeSheet to that date.
 */
import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { theme } from '@planpal/ui';
import { buildWeekDays, fmtDayLabel } from '../../lib/calendarUtils';

interface WeekStripProps {
  anchorDate: string; // any date in the week
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

export function WeekStrip({ anchorDate, selectedDate, onSelectDate }: WeekStripProps) {
  const days = buildWeekDays(anchorDate);

  return (
    <View style={styles.row}>
      {days.map((day) => {
        const isSelected = day.date === selectedDate;
        const [dayName, dayNum] = fmtDayLabel(day.date).split(' ');
        return (
          <TouchableOpacity
            key={day.date}
            style={[styles.cell, isSelected && styles.selectedCell]}
            onPress={() => onSelectDate(day.date)}
            accessibilityLabel={day.date}
            accessibilityState={{ selected: isSelected }}
          >
            <Text style={[styles.dayName, isSelected && styles.selectedText]}>{dayName}</Text>
            <View style={[styles.circle, day.isToday && styles.todayCircle, isSelected && styles.selectedCircle]}>
              <Text style={[styles.dayNum, isSelected && styles.selectedText, day.isToday && !isSelected && styles.todayNum]}>
                {dayNum}
              </Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: theme.colors.bg,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingVertical: theme.spacing.sm,
  },
  cell: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  selectedCell: {
    // no background — we highlight the circle instead
  },
  circle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCircle: {
    borderWidth: 1.5,
    borderColor: theme.colors.accent,
  },
  selectedCircle: {
    backgroundColor: theme.colors.accent,
    borderWidth: 0,
  },
  dayName: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.xs,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
  },
  dayNum: {
    fontFamily: theme.typography.fontFamily.sans,
    fontSize: theme.typography.fontSize.sm,
    fontWeight: theme.typography.fontWeight.medium,
    color: theme.colors.textPrimary,
  },
  todayNum: {
    color: theme.colors.accent,
    fontWeight: theme.typography.fontWeight.bold,
  },
  selectedText: {
    color: theme.colors.textInverse,
    fontWeight: theme.typography.fontWeight.bold,
  },
});
