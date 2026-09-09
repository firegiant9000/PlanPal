'use client';

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import { PlanPalApiError } from '@planpal/api-client';
import { buildMonthGrid, currentYearMonth, fmtMonthHeader, today } from '@planpal/calendar-core';
import { theme } from '@planpal/ui';
import { Button } from '../../components/Button';
import { Text } from '../../components/Text';
import { MonthGrid } from '../../components/calendar/MonthGrid';
import { WeekStrip } from '../../components/calendar/WeekStrip';
import { DayTimeSheet } from '../../components/calendar/DayTimeSheet';
import type { WebOccurrence } from '../../components/calendar/types';
import { EventForm } from '../../components/event/EventForm';
import { OccurrenceSheet } from '../../components/event/OccurrenceSheet';
import { getPlanPalClient } from '../../lib/planpalClient';

/**
 * The signed-in calendar — READ ONLY (§P5). Event management on web is
 * deliberately Month 4 (T28); do not quietly re-expand this route.
 *
 * A client component on purpose. AD-9 keeps the session in localStorage, which
 * a server component cannot read, so the alternative would be moving the
 * session into a cookie and reading it in a route handler — a bigger change
 * than this task, and not what AD-9 says.
 */

type Status = 'loading' | 'ready' | 'empty' | 'failed' | 'offline' | 'forbidden';

function statusForError(error: unknown): Status {
  if (error instanceof PlanPalApiError) {
    return error.status === 401 || error.status === 403 ? 'forbidden' : 'failed';
  }
  // No response to read a status off — `fetch` threw, so we are offline.
  return 'offline';
}

const MESSAGES: Record<string, string> = {
  empty: 'Nothing scheduled this month.',
  failed: "Couldn't load your calendar. Your events are safe.",
  offline: 'You are offline. Showing nothing rather than something stale.',
  forbidden: 'Your session expired. Sign in again.',
};

export default function CalendarPage() {
  const router = useRouter();
  const [initial] = useState(() => currentYearMonth());
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [selectedDate, setSelectedDate] = useState(() => today());
  const [items, setItems] = useState<WebOccurrence[]>([]);
  const [status, setStatus] = useState<Status>('loading');
  const [reloadToken, setReloadToken] = useState(0);
  const [creating, setCreating] = useState(false);
  const [sheetFor, setSheetFor] = useState<WebOccurrence | null>(null);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);
  const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York';

  // Derived from the same grid builder that renders the cells, so the fetched
  // range and the drawn range cannot drift.
  const window = useMemo(() => {
    const weeks = buildMonthGrid(year, month);
    const first = weeks[0]![0]!.date;
    const lastWeek = weeks[weeks.length - 1]!;
    return { from: first, to: lastWeek[lastWeek.length - 1]!.date };
  }, [year, month]);

  useEffect(() => {
    let active = true;
    setStatus('loading');

    getPlanPalClient()
      .occurrences.range(window.from, window.to)
      .then((occurrences) => {
        if (!active) return;
        setItems(
          occurrences.map((o) => ({
            eventId: o.eventId,
            occurrenceDate: o.occurrenceDate,
            title: o.title,
            localStart: o.localStart,
            localEnd: o.localEnd,
            timezoneId: o.timezoneId,
            visibility: o.visibility,
            colorLabel: o.colorLabel ?? null,
            isException: o.isException,
            isVariableSchedule: o.isVariableSchedule,
          })),
        );
        setStatus(occurrences.length === 0 ? 'empty' : 'ready');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setItems([]);
        setStatus(statusForError(error));
      });

    return () => {
      // A fast month-swipe leaves several reads in flight; without this the
      // slowest one wins and the page shows a month the user has left.
      active = false;
    };
  }, [window, reloadToken]);

  const occurrencesByDate = useMemo(() => {
    const map: Record<string, WebOccurrence[]> = {};
    for (const o of items) (map[o.occurrenceDate] ??= []).push(o);
    return map;
  }, [items]);

  const prevMonth = useCallback(() => {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else setMonth((m) => m - 1);
  }, [month]);

  const nextMonth = useCallback(() => {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else setMonth((m) => m + 1);
  }, [month]);

  const message = MESSAGES[status];

  return (
    <main style={pageStyle}>
      <header style={headerStyle}>
        <Button label="Previous month" variant="ghost" size="sm" onPress={prevMonth} />
        <Text size="lg" weight="bold">
          {fmtMonthHeader(year, month)}
        </Text>
        <Button label="Next month" variant="ghost" size="sm" onPress={nextMonth} />
        <Button label="New event" size="sm" onPress={() => setCreating(true)} />
      </header>

      {creating ? (
        <EventForm
          timezoneId={timezoneId}
          initial={{ date: selectedDate }}
          onCancel={() => setCreating(false)}
          onSubmit={async (values) => {
            await getPlanPalClient().events.create(values);
            setCreating(false);
            reload();
          }}
        />
      ) : null}

      {sheetFor === null ? null : (
        <Button
          label="Edit the whole series"
          variant="ghost"
          size="sm"
          onPress={() => router.push(`/calendar/event/${sheetFor.eventId}`)}
        />
      )}

      {sheetFor === null ? null : (
        <OccurrenceSheet
          occurrence={sheetFor}
          onClose={() => setSheetFor(null)}
          overrideOccurrence={async (id, date, patch) => {
            await getPlanPalClient().events.overrideOccurrence(id, date, patch);
            reload();
          }}
          cancelOccurrence={async (id, date) => {
            await getPlanPalClient().events.cancelOccurrence(id, date);
            reload();
          }}
        />
      )}

      {status === 'loading' ? (
        <Text color="textSecondary">Loading…</Text>
      ) : message !== undefined ? (
        <div style={noticeStyle}>
          <Text color="textSecondary">{message}</Text>
          {status === 'empty' ? null : (
            <Button
              label="Try again"
              variant="secondary"
              size="sm"
              onPress={() => setReloadToken((n) => n + 1)}
            />
          )}
        </div>
      ) : null}

      <MonthGrid
        year={year}
        month={month}
        occurrencesByDate={occurrencesByDate}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <WeekStrip
        anchorDate={selectedDate}
        occurrencesByDate={occurrencesByDate}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      <DayTimeSheet
        date={selectedDate}
        occurrences={occurrencesByDate[selectedDate] ?? []}
        onSelect={setSheetFor}
      />
    </main>
  );
}

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing.md,
  margin: '0 auto',
  maxWidth: 1100,
  padding: theme.spacing.lg,
};

const headerStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: theme.spacing.md,
  justifyContent: 'space-between',
};

const noticeStyle: CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: theme.spacing.sm,
};
