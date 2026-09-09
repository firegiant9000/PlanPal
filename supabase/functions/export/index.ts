/**
 * /export/ical — the caller's calendar as an .ics document (M3, T13).
 *
 * Returns the calendar body directly, so it cannot use the shared `ok()`
 * helper: that wraps everything in the ApiResult envelope, and an importer
 * handed `{"ok":true,"data":"BEGIN:VCALENDAR..."}` rejects the file. Errors
 * still use the envelope, because those are read by our own client.
 *
 * The function directory is `export`, not `export-ical`, so this answers at
 * /functions/v1/export/ical — the path the contract declares. Named
 * `export-ical` it served /functions/v1/export-ical, and a client generated
 * from openapi.yaml asking for /export/ical got a gateway 404. Same reasoning
 * as the /me/devices routes living in `me` (see me/index.ts).
 */
import { getUserClient, type DbClient } from '../_shared/auth.ts';
import {
  corsHeaders,
  dbError,
  handleOptions,
  methodNotAllowed,
  notFound,
  unauthenticated,
} from '../_shared/response.ts';
import { buildIcal, type IcalEventRow, type IcalExceptionRow } from '../_shared/ical.ts';

const MASTER_COLUMNS =
  'id,title,description,location,local_start,local_end,timezone_id,recurrence_rule,visibility,created_at,updated_at';
// `visibility` is read so a per-occurrence override marked private can be
// excluded. Without it the column is not even fetched, and buildIcal cannot
// tell a shared override from a private one.
const EXCEPTION_COLUMNS =
  'master_event_id,recurrence_exception_date,is_cancelled,title,description,location,local_start,local_end,timezone_id,visibility';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();

  const url = new URL(req.url);
  const segments = url.pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  // segments[0] = "export", [1] = "ical"
  if (segments[1] !== 'ical') return notFound('Route');

  if (req.method !== 'GET') return methodNotAllowed();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  return exportIcal(client, userId);
});

async function exportIcal(client: DbClient, userId: string) {
  // Non-private only, per §6. `private` is the default visibility, so this is
  // the difference between exporting a handful of deliberately-shared events
  // and handing over someone's entire calendar to whatever they paste the file
  // into.
  //
  // Variable-schedule masters are excluded too: their local_start is a
  // placeholder the engine deliberately never expands, so exporting them would
  // write fictional times into the importing calendar.
  const { data: masters, error: mastersErr } = await client
    .from('events')
    .select(MASTER_COLUMNS)
    .eq('owner_id', userId)
    .eq('is_master', true)
    .eq('is_variable_schedule', false)
    .neq('visibility', 'private')
    .order('local_start', { ascending: true });

  if (mastersErr) return dbError(mastersErr, 'export:ical:masters');

  const events: IcalEventRow[] = masters ?? [];

  let exceptions: IcalExceptionRow[] = [];
  if (events.length > 0) {
    // No `.in('master_event_id', <every master id>)` filter. It bought nothing
    // — buildIcal groups exceptions by master and ignores any whose master is
    // not in the exported set — while serialising one UUID per master into the
    // request URL, which a calendar with a few thousand masters pushes past the
    // gateway's URL limit and fails the export outright.
    const { data, error } = await client
      .from('events')
      .select(EXCEPTION_COLUMNS)
      .eq('owner_id', userId)
      .eq('is_master', false);
    if (error) return dbError(error, 'export:ical:exceptions');
    // A runtime filter, not a cast. `master_event_id` and
    // `recurrence_exception_date` are nullable on the table — a master row has
    // neither — and this query selects only non-master rows, where both are
    // always set. Asserting that with `as unknown as` would put `undefined`
    // into a date calculation if it were ever untrue; dropping the row instead
    // means a malformed exception costs one missing VEVENT rather than a
    // corrupt .ics.
    exceptions = (data ?? []).filter(
      (row): row is IcalExceptionRow =>
        row.master_event_id !== null && row.recurrence_exception_date !== null,
    );
  }

  const body = buildIcal(events, exceptions);

  return new Response(body, {
    status: 200,
    headers: {
      // charset matters: a title with an accent is mojibake without it.
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="planpal.ics"',
      // The calendar changes whenever any event does, and this is cheap to
      // regenerate, so never serve a stale copy from an intermediary.
      'Cache-Control': 'no-store',
      ...corsHeaders,
    },
  });
}
