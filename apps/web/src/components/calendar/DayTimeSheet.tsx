'use client';

import type { CSSProperties } from 'react';
import { fmtHourLabel, layoutDay } from '@planpal/calendar-core';
import { theme } from '@planpal/ui';
import { EventBar } from './EventBar';
import type { WebOccurrence } from './types';

interface DayTimeSheetProps {
  date: string;
  occurrences: WebOccurrence[];
  onSelect?: (occurrence: WebOccurrence) => void;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const HOUR_HEIGHT = 48;

/**
 * The 24-hour day view.
 *
 * Overlap packing comes from `calendar-core.layoutDay`, which returns fractions
 * of a day; turning those into pixels is this view's job and the only thing it
 * decides. Mobile's sheet does the same with its own scale.
 */
export function DayTimeSheet({ date, occurrences, onSelect }: DayTimeSheetProps) {
  const laid = layoutDay(occurrences);

  // Variable-schedule placeholders have no concrete times, so `layoutDay`
  // excludes them. Dropping them entirely would hide the event outright.
  const unscheduled = occurrences.filter((o) => o.isVariableSchedule);

  return (
    <section aria-label={`Day view for ${date}`}>
      {unscheduled.length > 0 ? (
        <ul style={unscheduledStyle}>
          {unscheduled.map((o) => (
            <li key={o.eventId}>{o.title} — schedule not yet entered</li>
          ))}
        </ul>
      ) : null}

      <div style={{ ...sheetStyle, height: HOURS.length * HOUR_HEIGHT }}>
        {HOURS.map((h) => (
          <div key={h} style={{ ...hourRowStyle, top: h * HOUR_HEIGHT, height: HOUR_HEIGHT }}>
            <span style={hourLabelStyle}>{fmtHourLabel(h)}</span>
          </div>
        ))}

        {laid.map((p) => (
          <EventBar
            key={`${p.occurrence.eventId}-${p.occurrence.occurrenceDate}`}
            occurrence={p.occurrence}
            topFraction={p.topFraction}
            heightFraction={p.heightFraction}
            column={p.column}
            columnCount={p.columnCount}
            onSelect={onSelect}
          />
        ))}
      </div>
    </section>
  );
}

const sheetStyle: CSSProperties = {
  borderTop: `1px solid ${theme.colors.border}`,
  position: 'relative',
};

const hourRowStyle: CSSProperties = {
  borderBottom: `1px solid ${theme.colors.border}`,
  left: 0,
  position: 'absolute',
  right: 0,
};

const hourLabelStyle: CSSProperties = {
  color: theme.colors.textSecondary,
  fontSize: 10,
  paddingLeft: 2,
};

const unscheduledStyle: CSSProperties = {
  color: theme.colors.textSecondary,
  fontSize: theme.typography.fontSize.sm,
  margin: 0,
  padding: theme.spacing.sm,
};
