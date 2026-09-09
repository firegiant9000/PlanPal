'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { theme } from '@planpal/ui';
import { Button } from '../../../../components/Button';
import { Text } from '../../../../components/Text';
import { EventForm, type EventFormValues } from '../../../../components/event/EventForm';
import { getPlanPalClient } from '../../../../lib/planpalClient';

/**
 * Edit or delete a master event (T28, §P9).
 *
 * Edits here apply to the SERIES. Changing one occurrence is
 * `OccurrenceSheet`'s job, reached from the day view — keeping those two apart
 * is the distinction PR #3's defect 1 got wrong.
 */
export default function EditEventPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [initial, setInitial] = useState<(Partial<EventFormValues> & { date?: string }) | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getPlanPalClient()
      .events.get(id)
      .then((event) => {
        if (!active) return;
        setInitial({
          title: event.title,
          description: event.description ?? null,
          visibility: event.visibility,
          date: event.localStart.slice(0, 10),
        });
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : 'Could not load the event.');
      });
    return () => {
      active = false;
    };
  }, [id]);

  if (error !== null) {
    return (
      <main style={pageStyle}>
        <Text color="danger">{error}</Text>
        <Button label="Back to calendar" variant="secondary" onPress={() => router.push('/calendar')} />
      </main>
    );
  }

  if (initial === null) {
    return (
      <main style={pageStyle}>
        <Text color="textSecondary">Loading…</Text>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <Text size="lg" weight="bold">
        Edit event
      </Text>

      <EventForm
        timezoneId={Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York'}
        initial={initial}
        submitting={busy}
        onCancel={() => router.push('/calendar')}
        onSubmit={async (values) => {
          setBusy(true);
          try {
            await getPlanPalClient().events.update(id, values);
            router.push('/calendar');
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Could not save the event.');
          } finally {
            setBusy(false);
          }
        }}
      />

      <Button
        label="Delete this event"
        variant="danger"
        loading={busy}
        onPress={() => {
          // Deletes the whole series, which is why it is not offered from the
          // day view — a mis-click there would destroy every occurrence.
          setBusy(true);
          void getPlanPalClient()
            .events.remove(id)
            .then(() => router.push('/calendar'))
            .catch((e: unknown) =>
              setError(e instanceof Error ? e.message : 'Could not delete the event.'),
            )
            .finally(() => setBusy(false));
        }}
      />
    </main>
  );
}

const pageStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing.md,
  margin: '0 auto',
  maxWidth: 640,
  padding: theme.spacing.lg,
};
