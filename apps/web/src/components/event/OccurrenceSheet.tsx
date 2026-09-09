'use client';

import { useState, type CSSProperties } from 'react';
import { theme } from '@planpal/ui';
import { Button } from '../Button';
import { Text } from '../Text';
import type { WebOccurrence } from '../calendar/types';

/**
 * Edit or cancel ONE occurrence of a series (T28, §P9).
 *
 * The distinction this component exists to keep is the one PR #3's defect 1 got
 * wrong in the other direction: a change made here must touch a single date,
 * never the master. `updateMaster` is accepted as a prop only so the tests can
 * assert it is NOT called — this component never invokes it.
 */

interface OccurrenceSheetProps {
  occurrence: WebOccurrence;
  overrideOccurrence: (
    eventId: string,
    date: string,
    patch: { localStart: string; localEnd: string },
  ) => Promise<void>;
  cancelOccurrence: (eventId: string, date: string) => Promise<void>;
  /** Present so "did not touch the series" is assertable. Never called here. */
  updateMaster?: (eventId: string, patch: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}

/** `2026-09-14T09:00:00` -> `09:00`, for a time input. */
function timeOf(localDateTime: string): string {
  return localDateTime.slice(11, 16);
}

export function OccurrenceSheet({
  occurrence,
  overrideOccurrence,
  cancelOccurrence,
  onClose,
}: OccurrenceSheetProps) {
  const [startTime, setStartTime] = useState(() => timeOf(occurrence.localStart));
  const [endTime, setEndTime] = useState(() => timeOf(occurrence.localEnd));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside style={sheetStyle} aria-label={`Occurrence on ${occurrence.occurrenceDate}`}>
      <Text weight="semibold">{occurrence.title}</Text>
      <Text color="textSecondary" size="sm">
        {occurrence.occurrenceDate}
        {occurrence.isException ? ' — already moved' : ''}
      </Text>

      <label style={labelStyle}>
        Start time
        <input
          style={inputStyle}
          type="time"
          value={startTime}
          onChange={(e) => setStartTime(e.target.value)}
          aria-label="Start time"
        />
      </label>

      <label style={labelStyle}>
        End time
        <input
          style={inputStyle}
          type="time"
          value={endTime}
          onChange={(e) => setEndTime(e.target.value)}
          aria-label="End time"
        />
      </label>

      {error === null ? null : (
        <Text color="danger" size="sm">
          {error}
        </Text>
      )}

      <Button
        label="Save this occurrence"
        loading={busy}
        onPress={() =>
          void run(() =>
            // The date is the ORIGINAL occurrence date, not the new time's
            // date: it identifies which instance is being replaced.
            overrideOccurrence(occurrence.eventId, occurrence.occurrenceDate, {
              localStart: `${occurrence.occurrenceDate}T${startTime}:00`,
              localEnd: `${occurrence.occurrenceDate}T${endTime}:00`,
            }),
          )
        }
      />
      <Button
        label="Cancel this occurrence"
        variant="danger"
        loading={busy}
        onPress={() =>
          void run(() => cancelOccurrence(occurrence.eventId, occurrence.occurrenceDate))
        }
      />
      <Button label="Close" variant="ghost" onPress={onClose} />
    </aside>
  );
}

const sheetStyle: CSSProperties = {
  backgroundColor: theme.colors.surface,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.radius.md,
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing.sm,
  maxWidth: 360,
  padding: theme.spacing.md,
};

const labelStyle: CSSProperties = {
  color: theme.colors.textSecondary,
  display: 'flex',
  flexDirection: 'column',
  fontFamily: theme.typography.fontFamily.sans,
  fontSize: theme.typography.fontSize.sm,
  gap: 4,
};

const inputStyle: CSSProperties = {
  backgroundColor: theme.colors.bgMuted,
  border: `1px solid ${theme.colors.border}`,
  borderRadius: theme.radius.md,
  color: theme.colors.textPrimary,
  fontFamily: theme.typography.fontFamily.sans,
  fontSize: theme.typography.fontSize.md,
  padding: theme.spacing.xs,
};
