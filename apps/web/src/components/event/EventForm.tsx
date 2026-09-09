'use client';

import { useState, type CSSProperties } from 'react';
import { buildRRule, type RepeatSelection, type EndRepeatSelection } from '@planpal/recurrence';
import type { Visibility } from '@planpal/types';
import { theme } from '@planpal/ui';
import { Button } from '../Button';
import { Text } from '../Text';

/**
 * Create or edit a master event on web (T28, §P9).
 *
 * The RRULE is built by `@planpal/recurrence.buildRRule` — the same function
 * the mobile form calls. That is the whole point of moving it into the package
 * (AD-3): two forms, one rule builder, and a round-trip test against the parser
 * standing behind both.
 */

export interface EventFormValues {
  title: string;
  description: string | null;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  recurrenceRule: string | null;
  isVariableSchedule: boolean;
  visibility: Visibility;
}

interface EventFormProps {
  timezoneId: string;
  initial?: Partial<EventFormValues> & { date?: string };
  onSubmit: (values: EventFormValues) => Promise<void> | void;
  onCancel: () => void;
  submitting?: boolean;
}

const REPEAT_OPTIONS: { value: RepeatSelection; label: string }[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
  { value: 'variable', label: 'Variable schedule' },
];

const VISIBILITY_OPTIONS = [
  { value: 'private', label: 'Private' },
  { value: 'shared_all', label: 'All friends' },
  { value: 'shared_select', label: 'Select friends' },
  { value: 'sensitive_public', label: 'Busy (time only)' },
];

export function EventForm({ timezoneId, initial, onSubmit, onCancel, submitting }: EventFormProps) {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [date, setDate] = useState(initial?.date ?? '');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [repeat, setRepeat] = useState<RepeatSelection>('none');
  const [endRepeat, setEndRepeat] = useState<EndRepeatSelection>('never');
  const [endDate, setEndDate] = useState('');
  const [count, setCount] = useState('');
  const [visibility, setVisibility] = useState<Visibility>(initial?.visibility ?? 'private');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    if (title.trim() === '' || date === '' || startTime === '' || endTime === '') {
      setError('Title, date and both times are required.');
      return;
    }
    setError(null);
    void onSubmit({
      title: title.trim(),
      description: description.trim() === '' ? null : description.trim(),
      localStart: `${date}T${startTime}:00`,
      localEnd: `${date}T${endTime}:00`,
      timezoneId,
      recurrenceRule: buildRRule({ repeat, endRepeat, endDate, count }),
      isVariableSchedule: repeat === 'variable',
      visibility,
    });
  }

  return (
    <form
      style={formStyle}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label style={labelStyle}>
        Title
        <input
          style={inputStyle}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          aria-label="Title"
        />
      </label>

      <label style={labelStyle}>
        Description
        <textarea
          style={inputStyle}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="Description"
        />
      </label>

      <label style={labelStyle}>
        Date
        <input
          style={inputStyle}
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date"
        />
      </label>

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

      <label style={labelStyle}>
        Repeats
        <select
          style={inputStyle}
          value={repeat}
          onChange={(e) => setRepeat(e.target.value as RepeatSelection)}
          aria-label="Repeats"
        >
          {REPEAT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {repeat !== 'none' && repeat !== 'variable' ? (
        <>
          <label style={labelStyle}>
            Ends
            <select
              style={inputStyle}
              value={endRepeat}
              onChange={(e) => setEndRepeat(e.target.value as EndRepeatSelection)}
              aria-label="Ends"
            >
              <option value="never">Never</option>
              <option value="ondate">On date</option>
              <option value="aftercount">After N occurrences</option>
            </select>
          </label>

          {endRepeat === 'ondate' ? (
            <input
              style={inputStyle}
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              aria-label="Repeat until"
            />
          ) : null}
          {endRepeat === 'aftercount' ? (
            <input
              style={inputStyle}
              type="number"
              min={1}
              value={count}
              onChange={(e) => setCount(e.target.value)}
              aria-label="Occurrence count"
            />
          ) : null}
        </>
      ) : null}

      <label style={labelStyle}>
        Visibility
        <select
          style={inputStyle}
          value={visibility}
          onChange={(e) => setVisibility(e.target.value as Visibility)}
          aria-label="Visibility"
        >
          {VISIBILITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>

      {error === null ? null : (
        <Text color="danger" size="sm">
          {error}
        </Text>
      )}

      <div style={actionsStyle}>
        <Button label="Save event" onPress={submit} loading={submitting} />
        <Button label="Cancel" variant="secondary" onPress={onCancel} />
      </div>
    </form>
  );
}

const formStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing.sm,
  maxWidth: 480,
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

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: theme.spacing.sm,
};
