'use client';

import type { CSSProperties } from 'react';
import { buildWeekDays, fmtDayLabel } from '@planpal/calendar-core';
import { theme } from '@planpal/ui';
import type { WebOccurrence } from './types';

interface WeekStripProps {
  /** Any date inside the week to show. */
  anchorDate: string;
  occurrencesByDate: Record<string, WebOccurrence[]>;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

/** The seven-day strip above the day view. */
export function WeekStrip({
  anchorDate,
  occurrencesByDate,
  selectedDate,
  onSelectDate,
}: WeekStripProps) {
  const days = buildWeekDays(anchorDate);

  return (
    <div role="tablist" aria-label="Week" style={stripStyle}>
      {days.map((day) => {
        const count = (occurrencesByDate[day.date] ?? []).length;
        const isSelected = day.date === selectedDate;

        return (
          <button
            key={day.date}
            type="button"
            role="tab"
            aria-selected={isSelected}
            data-testid={`week-${day.date}`}
            onClick={() => onSelectDate(day.date)}
            style={{
              ...dayStyle,
              backgroundColor: isSelected ? theme.colors.accent : 'transparent',
              color: isSelected ? theme.colors.textInverse : theme.colors.textPrimary,
            }}
          >
            {/* `fmtDayLabel` already yields "Mon 7" — the day number is in it. */}
            <span style={labelStyle}>{fmtDayLabel(day.date)}</span>
            {/* A dot rather than a number: the strip is a navigation aid, and
                the count is already visible in the day view below it. */}
            <span style={dotStyle} aria-hidden="true">
              {count > 0 ? '•' : ' '}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const stripStyle: CSSProperties = {
  display: 'grid',
  gap: theme.spacing.xs,
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
};

const dayStyle: CSSProperties = {
  alignItems: 'center',
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.radius.md,
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  fontFamily: theme.typography.fontFamily.sans,
  padding: theme.spacing.xs,
};

const labelStyle: CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
};

const dotStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: '12px',
  minHeight: 12,
};
