'use client';

import type { CSSProperties } from 'react';
import { buildMonthGrid, fmtTime, getHolidayName, resolveEventColor } from '@planpal/calendar-core';
import { theme } from '@planpal/ui';
import type { WebOccurrence } from './types';

/**
 * The month view, in the DOM.
 *
 * Markup is written twice across platforms; logic is not (AD-3). Every rule
 * here — the 6x7 shape, holiday names, the colour of a bar — comes from
 * `@planpal/calendar-core`, so the web and mobile calendars cannot drift.
 */

interface MonthGridProps {
  year: number;
  /** 1-12. */
  month: number;
  occurrencesByDate: Record<string, WebOccurrence[]>;
  selectedDate?: string;
  onSelectDate: (date: string) => void;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MonthGrid({
  year,
  month,
  occurrencesByDate,
  selectedDate,
  onSelectDate,
}: MonthGridProps) {
  const weeks = buildMonthGrid(year, month);

  return (
    <div role="grid" aria-label="Month" style={gridStyle}>
      {WEEKDAYS.map((label) => (
        <div key={label} role="columnheader" style={headerStyle}>
          {label}
        </div>
      ))}

      {weeks.flat().map((day) => {
        const items = occurrencesByDate[day.date] ?? [];
        const holiday = getHolidayName(day.date);
        const isSelected = day.date === selectedDate;

        return (
          <div
            key={day.date}
            role="gridcell"
            data-testid={`day-${day.date}`}
            aria-selected={isSelected}
            tabIndex={0}
            onClick={() => onSelectDate(day.date)}
            onKeyDown={(e) => {
              // Keyboard parity with click — §P5 counts desktop interaction as
              // part of the task, not as polish.
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelectDate(day.date);
              }
            }}
            style={{
              ...cellStyle,
              backgroundColor: isSelected ? theme.colors.bgMuted : theme.colors.surface,
              opacity: day.isOutsideMonth ? 0.45 : 1,
              outline: day.isToday ? `2px solid ${theme.colors.accent}` : undefined,
            }}
          >
            <div style={dayNumberStyle}>{day.day}</div>
            {holiday ? (
              <div style={holidayStyle} title={holiday}>
                {holiday}
              </div>
            ) : null}

            {items.map((o, index) => (
              <div
                key={`${o.eventId}-${o.occurrenceDate}`}
                style={{
                  ...chipStyle,
                  borderLeft: `3px solid ${resolveEventColor(o, index, theme.colors.busyBlock)}`,
                }}
              >
                {/* The time comes off the OCCURRENCE, never recomputed from the
                    series — that is what makes a moved override render at its
                    overridden time. */}
                <span style={chipTimeStyle}>
                  {o.isVariableSchedule ? 'TBC' : fmtTime(o.localStart)}
                </span>{' '}
                <span>{o.visibility === 'sensitive_public' ? 'Busy' : o.title}</span>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gap: 1,
  gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
};

const headerStyle: CSSProperties = {
  color: theme.colors.textSecondary,
  fontSize: theme.typography.fontSize.sm,
  padding: theme.spacing.xs,
  textAlign: 'center',
};

const cellStyle: CSSProperties = {
  border: `1px solid ${theme.colors.border}`,
  cursor: 'pointer',
  minHeight: 96,
  padding: theme.spacing.xs,
  textAlign: 'left',
};

const dayNumberStyle: CSSProperties = {
  color: theme.colors.textPrimary,
  fontSize: theme.typography.fontSize.sm,
  fontWeight: theme.typography.fontWeight.semibold,
};

const holidayStyle: CSSProperties = {
  color: theme.colors.textSecondary,
  fontSize: 10,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const chipStyle: CSSProperties = {
  fontSize: 11,
  marginTop: 2,
  overflow: 'hidden',
  paddingLeft: 4,
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const chipTimeStyle: CSSProperties = {
  color: theme.colors.textSecondary,
};
