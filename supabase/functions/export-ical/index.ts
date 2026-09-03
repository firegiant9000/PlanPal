/**
 * /export/ical — the caller's calendar as an .ics document (M3, T13).
 *
 * Returns the calendar body directly, so it cannot use the shared `ok()`
 * helper: that wraps everything in the ApiResult envelope, and an importer
 * handed `{"ok":true,"data":"BEGIN:VCALENDAR..."}` rejects the file. Errors
 * still use the envelope, because those are read by our own client.
 */
import { type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getUserClient } from '../_shared/auth.ts';
import {
  corsHeaders,
  dbError,
  handleOptions,
  methodNotAllowed,
  unauthenticated,
} from '../_shared/response.ts';
import { buildIcal, type IcalEventRow, type IcalExceptionRow } from '../_shared/ical.ts';

const MASTER_COLUMNS =
  'id,title,description,location,local_start,local_end,timezone_id,recurrence_rule,visibility,created_at,updated_at';
const EXCEPTION_COLUMNS =
  'master_event_id,recurrence_exception_date,is_cancelled,title,description,location,local_start,local_end,timezone_id';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return handleOptions();
  if (req.method !== 'GET') return methodNotAllowed();

  const auth = await getUserClient(req);
  if (!auth) return unauthenticated();
  const { client, userId } = auth;

  return exportIcal(client, userId);
});

async function exportIcal(client: SupabaseClient, userId: string) {
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

  // Widening cast per AD-11; removed by T32.
  const events = (masters ?? []) as unknown as IcalEventRow[];

  let exceptions: IcalExceptionRow[] = [];
  if (events.length > 0) {
    const { data, error } = await client
      .from('events')
      .select(EXCEPTION_COLUMNS)
      .eq('owner_id', userId)
      .eq('is_master', false)
      .in(
        'master_event_id',
        events.map((e) => e.id),
      );
    if (error) return dbError(error, 'export:ical:exceptions');
    exceptions = (data ?? []) as unknown as IcalExceptionRow[];
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
