/**
 * Create Event screen — wraps CreateEventForm and handles the POST /events call.
 * Auth wiring + real API call land in Month 3; for M3 the form validates and logs.
 */
import React, { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { getAnalytics } from '../src/lib/observability';
import { CreateEventForm, type CreateEventPayload } from '../src/components/event/CreateEventForm';

export default function CreateEventScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // Timezone: auto-detect from device. Intl.DateTimeFormat().resolvedOptions()
  // is available in Hermes (React Native's JS engine) and V8 (web).
  const timezoneId =
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York';

  const handleSubmit = useCallback(
    async (payload: CreateEventPayload) => {
      setSubmitting(true);
      try {
        // TODO (M3): POST to the events Edge Function with the user's JWT.
        // For now, log the payload and track the creation event.
        console.log('[CreateEvent] payload:', JSON.stringify(payload, null, 2));
        getAnalytics().track('event_created', {
          source: 'manual',
          is_recurring: payload.recurrenceRule !== null || payload.isVariableSchedule,
        });
        router.back();
      } catch (err) {
        console.error('[CreateEvent] failed:', err);
      } finally {
        setSubmitting(false);
      }
    },
    [router],
  );

  return (
    <CreateEventForm
      timezoneId={timezoneId}
      onSubmit={handleSubmit}
      onCancel={() => router.back()}
      submitting={submitting}
    />
  );
}
