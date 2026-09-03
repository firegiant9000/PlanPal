import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ANON_KEY,
  callFn,
  createTestUser,
  deleteTestUser,
  expectErr,
  expectOk,
  requireLocalStack,
  type TestUser,
} from './harness';

let user: TestUser;

beforeAll(async () => {
  await requireLocalStack();
  user = await createTestUser('ical');
});

afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

async function createEvent(token: string, body: Record<string, unknown>) {
  return expectOk(
    await callFn<Record<string, unknown>>('events', { method: 'POST', token, body }),
    201,
  );
}

/** Unfold a folded .ics back into logical lines, per RFC 5545 §3.1. */
function unfold(ics: string): string[] {
  return ics.replace(/\r\n[ \t]/g, '').split('\r\n');
}

describe('GET /export/ical', () => {
  it('returns text/calendar, not the JSON envelope', async () => {
    const res = await callFn('export-ical', { token: user.accessToken });

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/calendar/);
    expect(res.headers.get('content-type')).toMatch(/charset=utf-8/);
    expect(res.headers.get('content-disposition')).toMatch(/\.ics/);
    // The envelope would make every importer reject the file.
    expect(res.body).toBeNull();
    expect(res.text.startsWith('BEGIN:VCALENDAR')).toBe(true);
  });

  it('emits a structurally valid, CRLF-delimited document', async () => {
    const res = await callFn('export-ical', { token: user.accessToken });

    expect(res.text.endsWith('\r\n')).toBe(true);
    // Every line break must be CRLF — a bare LF is the single most common
    // reason an otherwise-fine .ics is rejected.
    expect(/[^\r]\n/.test(res.text)).toBe(false);

    const lines = unfold(res.text);
    expect(lines[0]).toBe('BEGIN:VCALENDAR');
    expect(lines).toContain('VERSION:2.0');
    expect(lines).toContain('CALSCALE:GREGORIAN');
    expect(lines.some((l) => l.startsWith('PRODID:'))).toBe(true);
    expect(lines.filter((l) => l === 'END:VCALENDAR')).toHaveLength(1);
  });

  it('401s without a user token', async () => {
    const res = await callFn('export-ical', { token: ANON_KEY });
    expect(expectErr(res, 401).code).toBe('UNAUTHENTICATED');
  });

  it('405s a non-GET verb', async () => {
    const res = await callFn('export-ical', {
      method: 'POST',
      token: user.accessToken,
      body: {},
    });
    expect(expectErr(res, 405).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('what is and is not exported', () => {
  it('excludes private events', async () => {
    // `private` is the default visibility, so this is the difference between
    // sharing a few events and handing over an entire calendar.
    const owner = await createTestUser('ical-private');
    try {
      await createEvent(owner.accessToken, {
        title: 'SECRET private thing',
        localStart: '2026-09-07T09:00:00',
        localEnd: '2026-09-07T09:30:00',
        timezoneId: 'America/New_York',
        visibility: 'private',
      });
      await createEvent(owner.accessToken, {
        title: 'Shared thing',
        localStart: '2026-09-08T09:00:00',
        localEnd: '2026-09-08T09:30:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
      });

      const res = await callFn('export-ical', { token: owner.accessToken });
      expect(res.text).not.toContain('SECRET private thing');
      expect(res.text).toContain('Shared thing');
    } finally {
      await deleteTestUser(owner.id);
    }
  });

  it("excludes another user's events entirely", async () => {
    const other = await createTestUser('ical-other');
    try {
      await createEvent(other.accessToken, {
        title: 'Belongs to someone else',
        localStart: '2026-09-09T09:00:00',
        localEnd: '2026-09-09T09:30:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
      });
      const res = await callFn('export-ical', { token: user.accessToken });
      expect(res.text).not.toContain('Belongs to someone else');
    } finally {
      await deleteTestUser(other.id);
    }
  });

  it('excludes variable-schedule placeholders', async () => {
    // Their local_start is a placeholder the engine never expands; exporting
    // it would write fictional times into the importing calendar.
    const owner = await createTestUser('ical-variable');
    try {
      await createEvent(owner.accessToken, {
        title: 'Variable placeholder',
        localStart: '2026-09-07T09:00:00',
        localEnd: '2026-09-07T17:00:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
        isVariableSchedule: true,
      });
      const res = await callFn('export-ical', { token: owner.accessToken });
      expect(res.text).not.toContain('Variable placeholder');
    } finally {
      await deleteTestUser(owner.id);
    }
  });
});

describe('recurrence, cancellations and overrides', () => {
  it('passes the RRULE through and anchors DTSTART to the event timezone', async () => {
    const owner = await createTestUser('ical-rrule');
    try {
      await createEvent(owner.accessToken, {
        title: 'Weekly standup',
        localStart: '2026-09-07T09:00:00',
        localEnd: '2026-09-07T09:30:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      });

      const lines = unfold((await callFn('export-ical', { token: owner.accessToken })).text);

      expect(lines).toContain('RRULE:FREQ=WEEKLY;BYDAY=MO');
      // A floating DTSTART would drift by an hour across a DST boundary in the
      // importing calendar. TZID is what pins it.
      expect(lines).toContain('DTSTART;TZID=America/New_York:20260907T090000');
      expect(lines).toContain('DTEND;TZID=America/New_York:20260907T093000');
      expect(lines.some((l) => l.startsWith('UID:'))).toBe(true);
      expect(lines.some((l) => l.startsWith('DTSTAMP:'))).toBe(true);
    } finally {
      await deleteTestUser(owner.id);
    }
  });

  it('emits EXDATE for a cancelled occurrence, matching DTSTART time-of-day', async () => {
    const owner = await createTestUser('ical-exdate');
    try {
      const master = await createEvent(owner.accessToken, {
        title: 'Cancellable series',
        localStart: '2026-09-07T09:00:00',
        localEnd: '2026-09-07T09:30:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      expectOk(
        await callFn(`events/${master.id}/occurrences/2026-09-21`, {
          method: 'DELETE',
          token: owner.accessToken,
        }),
      );

      const lines = unfold((await callFn('export-ical', { token: owner.accessToken })).text);

      // The value must carry the same TZID and the same time-of-day as
      // DTSTART, or the importer cannot match it to an instance and the
      // cancellation is silently lost.
      expect(lines).toContain('EXDATE;TZID=America/New_York:20260921T090000');
    } finally {
      await deleteTestUser(owner.id);
    }
  });

  it('emits a RECURRENCE-ID VEVENT per override, sharing the master UID', async () => {
    const owner = await createTestUser('ical-override');
    try {
      const master = await createEvent(owner.accessToken, {
        title: 'Overridable series',
        localStart: '2026-09-07T09:00:00',
        localEnd: '2026-09-07T09:30:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
        recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO',
      });
      expectOk(
        await callFn(`events/${master.id}/occurrences/2026-09-14`, {
          method: 'PUT',
          token: owner.accessToken,
          body: {
            title: 'Moved standup',
            localStart: '2026-09-14T11:00:00',
            localEnd: '2026-09-14T11:30:00',
          },
        }),
      );

      const text = (await callFn('export-ical', { token: owner.accessToken })).text;
      const lines = unfold(text);

      // Two VEVENTs: the master series and the replaced instance.
      expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(2);
      expect(text.match(/END:VEVENT/g)).toHaveLength(2);

      // RECURRENCE-ID must name the ORIGINAL occurrence start, not the new
      // one, or the importer cannot tell which instance is replaced.
      expect(lines).toContain('RECURRENCE-ID;TZID=America/New_York:20260914T090000');
      expect(lines).toContain('DTSTART;TZID=America/New_York:20260914T110000');
      expect(lines).toContain('SUMMARY:Moved standup');

      // Both VEVENTs share the master's UID — that is what links them.
      const uids = lines.filter((l) => l.startsWith('UID:'));
      expect(uids).toHaveLength(2);
      expect(uids[0]).toBe(uids[1]);
      expect(uids[0]).toBe(`UID:${master.id}@planpal.app`);
    } finally {
      await deleteTestUser(owner.id);
    }
  });
});

describe('escaping and folding', () => {
  it('escapes commas, semicolons and backslashes in TEXT values', async () => {
    const owner = await createTestUser('ical-escape');
    try {
      await createEvent(owner.accessToken, {
        title: 'Lunch, then a talk; with C:\\path',
        description: 'Line one\nLine two',
        localStart: '2026-09-07T12:00:00',
        localEnd: '2026-09-07T13:00:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
      });

      const lines = unfold((await callFn('export-ical', { token: owner.accessToken })).text);
      const summary = lines.find((l) => l.startsWith('SUMMARY:'));

      // Unescaped, the comma would split the value into a list and the
      // semicolon would start a new parameter — corrupting the property.
      expect(summary).toBe('SUMMARY:Lunch\\, then a talk\\; with C:\\\\path');

      const description = lines.find((l) => l.startsWith('DESCRIPTION:'));
      expect(description).toBe('DESCRIPTION:Line one\\nLine two');
    } finally {
      await deleteTestUser(owner.id);
    }
  });

  it('folds long lines at 75 octets and they unfold to the original value', async () => {
    const owner = await createTestUser('ical-fold');
    const longTitle = 'A'.repeat(180);
    try {
      await createEvent(owner.accessToken, {
        title: longTitle,
        localStart: '2026-09-07T12:00:00',
        localEnd: '2026-09-07T13:00:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
      });

      const text = (await callFn('export-ical', { token: owner.accessToken })).text;

      // Physically folded...
      for (const physical of text.split('\r\n')) {
        expect(new TextEncoder().encode(physical).length).toBeLessThanOrEqual(75);
      }
      // ...and logically intact once unfolded.
      expect(unfold(text)).toContain(`SUMMARY:${longTitle}`);
    } finally {
      await deleteTestUser(owner.id);
    }
  });

  it('keeps multi-byte characters intact across a fold boundary', async () => {
    // Folding is measured in octets, so a naive character-based split would
    // cut a multi-byte codepoint in half and produce invalid UTF-8.
    const owner = await createTestUser('ical-utf8');
    const title = 'Café ☕ '.repeat(20).trim();
    try {
      await createEvent(owner.accessToken, {
        title,
        localStart: '2026-09-07T12:00:00',
        localEnd: '2026-09-07T13:00:00',
        timezoneId: 'America/New_York',
        visibility: 'shared_all',
      });

      const text = (await callFn('export-ical', { token: owner.accessToken })).text;
      expect(text).not.toContain('\uFFFD'); // replacement char = broken encoding
      expect(unfold(text)).toContain(`SUMMARY:${title}`);
    } finally {
      await deleteTestUser(owner.id);
    }
  });
});
