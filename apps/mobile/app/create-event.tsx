/**
 * Create Event screen — wraps CreateEventForm and performs POST /events
 * through `@planpal/api-client`.
 */
import React, { useCallback, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { getAnalytics } from '../src/lib/observability';
import { planpalClient } from '../src/lib/planpalClient';
import { CreateEventForm, type CreateEventPayload } from '../src/components/event/CreateEventForm';

export default function CreateEventScreen() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  // Timezone: auto-detect from device. Intl.DateTimeFormat().resolvedOptions()
  // is available in Hermes (React Native's JS engine) and V8 (web).
  const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'America/New_York';

  const handleSubmit = useCallback(
    async (payload: CreateEventPayload) => {
      setSubmitting(true);
      try {
        await planpalClient.events.create({
          title: payload.title,
          // The form always supplies a string; the contract wants null for absent.
          description: payload.description === '' ? null : payload.description,
          localStart: payload.localStart,
          localEnd: payload.localEnd,
          timezoneId: payload.timezoneId,
          recurrenceRule: payload.recurrenceRule,
          isVariableSchedule: payload.isVariableSchedule,
          visibility: payload.visibility,
        });

        // `notificationLeadTimes` is collected by the form but is NOT part of
        // EventCreate — reminders are a notification_preferences concern, not
        // an event field. Sending it would be rejected as an unknown field.
        getAnalytics().track('event_created', {
          source: 'manual',
          is_recurring: payload.recurrenceRule !== null || payload.isVariableSchedule,
        });
        router.back();
      } catch (err) {
        // Stay on the form: navigating back would discard what they typed and
        // leave them no way to see why it failed.
        Alert.alert(
          "Couldn't create the event",
          err instanceof Error ? err.message : 'Unknown error',
        );
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
