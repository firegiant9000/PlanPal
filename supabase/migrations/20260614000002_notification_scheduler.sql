-- Migration: push notification scheduler (M2)
-- ---------------------------------------------------------------------------
-- Installs pg_cron + a SQL function that the Edge Function calls each minute
-- to fetch events whose lead-time windows are about to fire. The Edge Function
-- does the actual Expo Push dispatch; this migration owns the DB side.
--
-- Architecture:
--   1. `get_pending_notifications(now_utc)` — a SECURITY DEFINER RPC that
--      returns the (device_token, event payload) rows due in the next minute.
--   2. `record_notification_sent(event_id, device_token)` — marks a send so
--      it is not double-fired on the next tick.
--   3. pg_cron schedule invokes the Edge Function URL every minute (the Edge
--      Function URL is set via the NOTIFY_FUNCTION_URL env var in Supabase
--      Dashboard → Settings → Edge Functions → Secrets).
--
-- Notification logic:
--   An event fires for user U at time T when:
--     utc_start - (lead_time_minutes * interval '1 minute') is within the
--     current minute [now, now + 1 min), AND push_enabled = true, AND the
--     send has not already been recorded, AND the device is registered.
--   Quiet hours are in local wall-clock time; the scheduler converts the
--   user's timezone_id to check if now() falls inside the quiet window.
-- ---------------------------------------------------------------------------

-- Enable pg_cron (safe to call if already enabled).
create extension if not exists pg_cron;

-- Track which (event_id, expo_push_token, lead_time_minutes) combos have
-- already been dispatched so they are never re-fired.
create table if not exists public.notification_sends (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events (id) on delete cascade,
  expo_push_token  text not null references public.devices (expo_push_token) on delete cascade,
  lead_time_minutes integer not null,
  sent_at          timestamptz not null default now(),
  constraint notification_sends_unique unique (event_id, expo_push_token, lead_time_minutes)
);
create index notification_sends_event_idx on public.notification_sends (event_id);

-- RLS: only the service role (used by the Edge Function) touches this table.
alter table public.notification_sends enable row level security;
-- No authenticated user policies — the Edge Function uses the service key.

-- ---------------------------------------------------------------------------
-- get_pending_notifications(p_now)
-- Returns one row per (device, lead_time) that is due in the 60-second window
-- [p_now, p_now + 1 minute). The Edge Function calls this at the start of each
-- tick and dispatches the returned rows.
-- ---------------------------------------------------------------------------
create or replace function public.get_pending_notifications(p_now timestamptz)
returns table (
  event_id           uuid,
  owner_id           uuid,
  title              text,
  local_start        timestamp,
  timezone_id        text,
  utc_start          timestamptz,
  expo_push_token    text,
  lead_time_minutes  integer
)
language sql
security definer
set search_path = public
as $$
  select
    e.id                      as event_id,
    e.owner_id,
    e.title,
    e.local_start,
    e.timezone_id,
    e.utc_start,
    d.expo_push_token,
    lt.lead_time_minutes
  from public.events e
  -- Expand the user's lead_time array into individual rows.
  join public.notification_preferences np on np.user_id = e.owner_id
  join lateral unnest(np.lead_times_minutes) as lt(lead_time_minutes) on true
  join public.devices d on d.user_id = e.owner_id
  -- Skip if already sent for this (event, device, lead_time) combo.
  where np.push_enabled = true
    and e.utc_start is not null
    -- Fire window: the lead-time instant falls in [p_now, p_now + 1 minute).
    and (e.utc_start - (lt.lead_time_minutes * interval '1 minute'))
          between p_now and (p_now + interval '1 minute' - interval '1 millisecond')
    -- Not already sent.
    and not exists (
      select 1 from public.notification_sends ns
       where ns.event_id         = e.id
         and ns.expo_push_token  = d.expo_push_token
         and ns.lead_time_minutes = lt.lead_time_minutes
    )
    -- Quiet hours check: skip if now() (in the user's timezone) is inside
    -- [quiet_hours_start, quiet_hours_end). Handles overnight windows too.
    and (
      np.quiet_hours_start is null
      or np.quiet_hours_end is null
      or (
        -- Convert p_now to the user's local time-of-day for comparison.
        case
          when np.quiet_hours_start < np.quiet_hours_end then
            -- Same-day window (e.g. 22:00–23:00).
            (p_now at time zone e.timezone_id)::time
              not between np.quiet_hours_start and np.quiet_hours_end
          else
            -- Overnight window (e.g. 22:00–07:00).
            (p_now at time zone e.timezone_id)::time
              not between np.quiet_hours_end and np.quiet_hours_start
        end
      )
    );
$$;

-- ---------------------------------------------------------------------------
-- record_notification_sent — called by the Edge Function after a successful
-- Expo push dispatch to prevent re-sending on the next tick.
-- ---------------------------------------------------------------------------
create or replace function public.record_notification_sent(
  p_event_id          uuid,
  p_expo_push_token   text,
  p_lead_time_minutes integer
)
returns void language sql security definer set search_path = public as $$
  insert into public.notification_sends
    (event_id, expo_push_token, lead_time_minutes)
  values
    (p_event_id, p_expo_push_token, p_lead_time_minutes)
  on conflict (event_id, expo_push_token, lead_time_minutes) do nothing;
$$;

-- ---------------------------------------------------------------------------
-- pg_cron: invoke the Edge Function every minute.
-- The Edge Function URL pattern for Supabase:
--   https://<project-ref>.supabase.co/functions/v1/notify-scheduler
-- Set SUPABASE_NOTIFY_FUNCTION_URL and SUPABASE_SERVICE_ROLE_KEY in the
-- Supabase Dashboard → Settings → Vault before enabling this schedule.
-- ---------------------------------------------------------------------------
-- NOTE: pg_cron's `cron.schedule` with an http call requires the pg_net
-- extension. We schedule a lightweight pg_net.http_post here; the Edge
-- Function handles the heavy lifting. Uncomment once pg_net + secrets are
-- configured in the cloud project.
--
-- select cron.schedule(
--   'notify-scheduler',
--   '* * * * *',  -- every minute
--   $$
--     select pg_net.http_post(
--       url     := current_setting('app.notify_function_url'),
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || current_setting('app.service_role_key'),
--         'Content-Type',  'application/json'
--       ),
--       body    := '{}'::jsonb
--     );
--   $$
-- );
