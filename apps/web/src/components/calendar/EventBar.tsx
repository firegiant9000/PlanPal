'use client';

import type { CSSProperties } from 'react';
import { fmtTime, resolveEventColor } from '@planpal/calendar-core';
import { theme } from '@planpal/ui';
import type { WebOccurrence } from './types';

interface EventBarProps {
  occurrence: WebOccurrence;
  /** Fraction of the day, 0 at midnight. */
  topFraction: number;
  heightFraction: number;
  column: number;
  columnCount: number;
  onSelect?: (occurrence: WebOccurrence) => void;
}

/**
 * One event block in the day view. The DOM twin of the mobile `EventBar` —
 * same rules from `calendar-core`, different markup (AD-3).
 */
export function EventBar({
  occurrence,
  topFraction,
  heightFraction,
  column,
  columnCount,
  onSelect,
}: EventBarProps) {
  const isSensitive = occurrence.visibility === 'sensitive_public';
  const color = resolveEventColor(occurrence, column, theme.colors.busyBlock);

  const style: CSSProperties = {
    backgroundColor: color,
    borderRadius: theme.radius.sm,
    color: theme.colors.textInverse,
    cursor: onSelect ? 'pointer' : 'default',
    fontSize: 11,
    left: `${(column / columnCount) * 100}%`,
    // A zero-height bar is unreadable; floor it the way the mobile sheet does.
    minHeight: 18,
    overflow: 'hidden',
    padding: '2px 4px',
    position: 'absolute',
    top: `${topFraction * 100}%`,
    height: `${heightFraction * 100}%`,
    width: `${(1 / columnCount) * 100}%`,
  };

  return (
    <button
      type="button"
      style={style}
      onClick={onSelect ? () => onSelect(occurrence) : undefined}
      // Sensitive-public shows time and duration only. NOTE: this is
      // presentation, in the owner's own view. Server-side redaction for shared
      // views is M7 — nothing here should be read as enforcing privacy.
      aria-label={`${isSensitive ? 'Busy' : occurrence.title} at ${fmtTime(occurrence.localStart)}`}
    >
      {fmtTime(occurrence.localStart)} {isSensitive ? 'Busy' : occurrence.title}
    </button>
  );
}
