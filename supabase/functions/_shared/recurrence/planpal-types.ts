// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Deno-local mirror of the two type-only imports the recurrence engine takes
// from @planpal/types. Regenerate: pnpm recurrence:sync
// ---------------------------------------------------------------------------

export type Visibility = 'private' | 'shared_all' | 'shared_select' | 'sensitive_public';

export interface EventOccurrence {
  eventId: string;
  occurrenceDate: string;
  title: string;
  description?: string | null;
  location?: string | null;
  localStart: string;
  localEnd: string;
  timezoneId: string;
  utcStart: string;
  utcEnd: string;
  visibility: Visibility;
  colorLabel?: string | null;
  isException: boolean;
}
