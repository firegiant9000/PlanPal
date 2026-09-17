/**
 * parse-worker — M5 Stages 1–8: OCR → extraction → normalisation → conflict detection → B2 variable-schedule detection → push notification → retry
 *
 * Triggered by pg_cron every minute via net.http_post (same auth pattern as
 * notify-scheduler). Per invocation: pops one job from parse:queue, downloads
 * the image from Supabase Storage, runs Claude vision OCR (Textract fallback),
 * extracts structured event candidates via a second Claude call, normalises those
 * candidates (resolve dates, flag out-of-window, convert recurrence to RRULE),
 * overlap-checks them against the user's existing calendar, detects alignment with
 * variable-schedule routines (B2), then sends an Expo push notification. Sets
 * parse_jobs.status = 'done' on completion.
 *
 * B2 detection: for each candidate whose date falls on a valid weekly slot of a
 * variable-schedule master, a variableScheduleSuggestions entry is attached.
 * The review UI offers to pre-fill that week; nothing is auto-committed.
 *
 * Transient failures (API blips, storage hiccups) are retried up to MAX_RETRIES
 * times by re-enqueuing the same parse_jobs row. The rate limit counts rows, not
 * worker invocations, so retries never consume an extra slot.
 *
 * Cross-cutting (cost monitoring): every Claude call's token usage is priced
 * and recorded to parse_spend_ledger via `_shared/spend.ts`, which `parse`
 * reads to trip a global spend kill-switch before accepting new jobs.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';
import { AwsClient } from 'https://esm.sh/aws4fetch@1.0.20';
import * as chrono from 'https://esm.sh/chrono-node@2.7.7';
import { recordClaudeSpend, type ClaudeUsage } from '../_shared/spend.ts';
import {
  expandOccurrences,
  localToUtc,
  mapEventRow,
  parseLocal,
  parseRRule,
  UnsupportedRRuleError,
  type EventRow,
} from '../_shared/recurrence/index.ts';

const CLAUDE_OCR_MODEL = 'claude-haiku-4-5-20251001';
const CLAUDE_EXTRACTION_MODEL = 'claude-haiku-4-5-20251001';
const TEXTRACT_MAX_BYTES = 5 * 1024 * 1024; // 5 MB inline limit for DetectDocumentText

const MAX_RETRIES = 3;

// Transient external-API / infrastructure failures worth retrying on the same row.
// Configuration errors and logic errors (CONFIG_MISSING, IMAGE_TOO_LARGE, etc.)
// will not resolve by themselves and are not retried.
const RETRYABLE_ERROR_CODES = new Set([
  'STORAGE_DOWNLOAD_FAILED',
  'CLAUDE_API_ERROR',
  'TEXTRACT_ERROR',
  'EXTRACTION_FAILED',
]);

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (!cronSecret || req.headers.get('X-Cron-Secret') !== cronSecret) {
    return jsonResponse({ error: 'Forbidden.' }, 403);
  }

  const job = await dequeueFromRedis();
  if (!job) {
    return jsonResponse({ processed: 0 });
  }

  const { jobId, userId, storagePath } = job;
  const admin = makeAdminClient();

  // Claim the job before any async work so a second worker tick cannot race.
  await admin.from('parse_jobs').update({ status: 'processing' }).eq('id', jobId);

  try {
    const { data: blob, error: downloadError } = await admin.storage
      .from('screenshots')
      .download(storagePath);
    if (downloadError || !blob) {
      throw new ParseError('STORAGE_DOWNLOAD_FAILED', 'Could not download image from storage.');
    }

    const imageBytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = blob.type || 'image/jpeg';

    // Stage 1: OCR — Claude vision primary, Textract fallback on low confidence.
    let ocrText: string;
    let ocrProvider: 'claude' | 'textract';

    const claudeResult = await runClaudeOcr(toBase64(imageBytes), mediaType);
    await recordClaudeSpend(admin, jobId, 'ocr', claudeResult.usage);
    if (claudeResult.confidence === 'high') {
      ocrText = claudeResult.text;
      ocrProvider = 'claude';
    } else {
      if (imageBytes.length > TEXTRACT_MAX_BYTES) {
        throw new ParseError('IMAGE_TOO_LARGE', 'Image exceeds the 5 MB Textract inline limit.');
      }
      ocrText = await runTextractOcr(imageBytes);
      ocrProvider = 'textract';
    }

    await admin
      .from('parse_jobs')
      .update({ ocr_text: ocrText, ocr_provider: ocrProvider })
      .eq('id', jobId);

    console.info('[parse-worker] stage-1 complete', { jobId, ocrProvider, chars: ocrText.length });

    // Stage 2: LLM extraction — structured event candidates from OCR text.
    const { events, reason: extractionReason, usage: extractionUsage } = await runExtraction(ocrText);
    if (extractionUsage) {
      await recordClaudeSpend(admin, jobId, 'extraction', extractionUsage);
    }
    await admin
      .from('parse_jobs')
      .update({ extracted_events: events })
      .eq('id', jobId);

    console.info('[parse-worker] stage-2 complete', {
      jobId,
      count: events.length,
      reason: extractionReason,
    });

    // Fetch the user's timezone once — used by both Stage 3 and Stage 4.
    const { data: userRow, error: userError } = await admin
      .from('users')
      .select('timezone_id')
      .eq('id', userId)
      .single();
    if (userError || !userRow) {
      throw new ParseError('USER_NOT_FOUND', 'Could not fetch user profile for normalisation.');
    }
    const timezone: string = userRow.timezone_id;

    // Stage 3: Normalisation — resolve dates, flag out-of-window, convert recurrence to RRULE.
    const normalised = runNormalisation(events, timezone);
    await admin
      .from('parse_jobs')
      .update({ normalised_events: normalised })
      .eq('id', jobId);

    console.info('[parse-worker] stage-3 complete', {
      jobId,
      total: normalised.length,
      flagged: normalised.filter((e) => e.flagged).length,
    });

    // Stage 4: Conflict detection — overlap-check against the user's calendar.
    const conflictChecked = await runConflictDetection(normalised, userId, timezone, admin);
    const conflictCount = conflictChecked.filter((e) => e.flagReasons.includes('CONFLICT')).length;

    console.info('[parse-worker] stage-4 complete', { jobId, conflictCount });

    // Stage 5 (B2): Variable-schedule detection — attach pre-fill suggestions.
    const finalEvents = await runVariableScheduleDetection(conflictChecked, userId, admin);
    const suggestionCount = finalEvents.filter(
      (e) => e.variableScheduleSuggestions.length > 0,
    ).length;

    await admin
      .from('parse_jobs')
      .update({
        normalised_events: finalEvents,
        status: 'done',
        event_count: finalEvents.length,
      })
      .eq('id', jobId);

    console.info('[parse-worker] pipeline complete — job done', {
      jobId,
      eventCount: finalEvents.length,
      conflictCount,
      suggestionCount,
    });

    // Stage 6 (Step 6): Push notification — non-blocking, best-effort.
    await sendParseCompleteNotification(userId, jobId, finalEvents.length, admin);

    return jsonResponse({
      processed: 1,
      jobId,
      ocrProvider,
      eventCount: finalEvents.length,
      conflictCount,
      suggestionCount,
    });
  } catch (e) {
    const code = e instanceof ParseError ? e.code : 'OCR_FAILED';
    console.error('[parse-worker] job failed', { jobId, code, error: String(e) });

    if (RETRYABLE_ERROR_CODES.has(code)) {
      // Read current retry count. No race risk — the job is claimed (status=processing)
      // so no other worker tick can be operating on this row concurrently.
      const { data: jobRow } = await admin
        .from('parse_jobs')
        .select('retry_count')
        .eq('id', jobId)
        .single();
      const nextRetry = (jobRow?.retry_count ?? 0) + 1;

      if (nextRetry <= MAX_RETRIES) {
        await admin
          .from('parse_jobs')
          .update({ status: 'queued', retry_count: nextRetry })
          .eq('id', jobId);
        const requeued = await requeueToRedis(jobId, userId, storagePath);
        if (requeued) {
          console.info('[parse-worker] job requeued for retry', { jobId, nextRetry, code });
          return jsonResponse({ processed: 0, jobId, retrying: true, retryNumber: nextRetry, code });
        }
        // Redis re-enqueue failed — fall through to mark failed so the user isn't left waiting.
      }
    }

    await admin.from('parse_jobs').update({ status: 'failed', error_code: code }).eq('id', jobId);
    return jsonResponse({ processed: 0, jobId, error: code });
  }
});

// ---------------------------------------------------------------------------
// Redis dequeue
// ---------------------------------------------------------------------------

type QueuePayload = { jobId: string; userId: string; storagePath: string };

async function dequeueFromRedis(): Promise<QueuePayload | null> {
  const redisUrl = Deno.env.get('UPSTASH_REDIS_REST_URL');
  const redisToken = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
  if (!redisUrl || !redisToken) {
    console.warn('[parse-worker] Redis not configured — nothing to dequeue.');
    return null;
  }

  const res = await fetch(redisUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${redisToken}`,
      'Content-Type': 'application/json',
    },
    // RPOP from right = FIFO with LPUSH from the enqueue side.
    body: JSON.stringify(['RPOP', 'parse:queue']),
  });

  if (!res.ok) {
    console.error('[parse-worker] Redis RPOP failed', res.status, await res.text());
    return null;
  }

  const { result } = await res.json();
  if (!result) return null;

  try {
    return JSON.parse(result) as QueuePayload;
  } catch {
    console.error('[parse-worker] Unparseable Redis payload', result);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Redis re-enqueue (retry path)
// ---------------------------------------------------------------------------

// Returns true if the job was successfully pushed back onto the queue.
// On failure the caller falls through to mark the job failed.
async function requeueToRedis(
  jobId: string,
  userId: string,
  storagePath: string,
): Promise<boolean> {
  const redisUrl = Deno.env.get('UPSTASH_REDIS_REST_URL');
  const redisToken = Deno.env.get('UPSTASH_REDIS_REST_TOKEN');
  if (!redisUrl || !redisToken) {
    console.warn('[parse-worker] Redis not configured — retry cannot be re-queued.');
    return false;
  }

  const payload = JSON.stringify({ jobId, userId, storagePath });
  try {
    // RPUSH adds to the tail so retried jobs yield to newly submitted ones.
    const res = await fetch(redisUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${redisToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(['RPUSH', 'parse:queue', payload]),
    });
    if (!res.ok) {
      console.error('[parse-worker] Redis RPUSH (retry) failed', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('[parse-worker] Redis RPUSH (retry) exception', String(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Stage 1a: Claude vision OCR (primary)
// ---------------------------------------------------------------------------

async function runClaudeOcr(
  imageBase64: string,
  mediaType: string,
): Promise<{ text: string; confidence: 'high' | 'low'; usage: ClaudeUsage }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ParseError('CONFIG_MISSING', 'ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_OCR_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: imageBase64 },
            },
            {
              type: 'text',
              text: `Extract all text from this image exactly as it appears. Return a JSON object with this exact shape:
{"text":"<all raw text from the image>","confidence":"high"}

Change "high" to "low" only if the image is too blurry, rotated, or low-resolution to read reliably, or contains no legible text.

Return only the JSON object — no markdown fences, no explanation.`,
            },
          ],
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new ParseError('CLAUDE_API_ERROR', `Claude API returned ${res.status}`);
  }

  const data = await res.json();
  const raw: string = data.content?.[0]?.text ?? '';
  const usage: ClaudeUsage = data.usage ?? { input_tokens: 0, output_tokens: 0 };

  try {
    // Strip markdown fences Claude sometimes adds despite instructions.
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
      text: String(parsed.text ?? ''),
      confidence: parsed.confidence === 'low' ? 'low' : 'high',
      usage,
    };
  } catch {
    // Non-JSON response — treat the raw text as high-confidence output.
    return { text: raw, confidence: 'high', usage };
  }
}

// ---------------------------------------------------------------------------
// Stage 1b: Textract fallback (low-confidence images)
// ---------------------------------------------------------------------------

async function runTextractOcr(imageBytes: Uint8Array): Promise<string> {
  const accessKeyId = Deno.env.get('AWS_ACCESS_KEY_ID');
  const secretAccessKey = Deno.env.get('AWS_SECRET_ACCESS_KEY');
  const region = Deno.env.get('AWS_REGION') ?? 'us-east-1';

  if (!accessKeyId || !secretAccessKey) {
    throw new ParseError('CONFIG_MISSING', 'AWS_ACCESS_KEY_ID or AWS_SECRET_ACCESS_KEY not set');
  }

  const aws = new AwsClient({ accessKeyId, secretAccessKey, region, service: 'textract' });

  const res = await aws.fetch(`https://textract.${region}.amazonaws.com/`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-amz-json-1.1',
      'X-Amz-Target': 'Textract.DetectDocumentText',
    },
    body: JSON.stringify({ Document: { Bytes: toBase64(imageBytes) } }),
  });

  if (!res.ok) {
    throw new ParseError('TEXTRACT_ERROR', `Textract returned ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  // Collect LINE blocks in reading order (Textract returns them top-to-bottom by default).
  return (data.Blocks ?? [])
    .filter((b: { BlockType: string; Text?: string }) => b.BlockType === 'LINE' && b.Text)
    .map((b: { BlockType: string; Text: string }) => b.Text)
    .join('\n');
}

// ---------------------------------------------------------------------------
// Stage 2: LLM extraction
// ---------------------------------------------------------------------------

type CandidateEvent = {
  name: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  location: string | null;
  recurrence: string | null;
};

async function runExtraction(
  ocrText: string,
): Promise<{ events: CandidateEvent[]; reason: string | null; usage: ClaudeUsage | null }> {
  if (!ocrText.trim()) {
    // No Claude call made — nothing to price.
    return { events: [], reason: 'NO_OCR_TEXT', usage: null };
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) throw new ParseError('CONFIG_MISSING', 'ANTHROPIC_API_KEY not set');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: CLAUDE_EXTRACTION_MODEL,
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `You are a calendar-event extractor. Given OCR text from a schedule screenshot, identify every calendar event and return a JSON array. Each element must have exactly these fields:
  name       – event title (string, required)
  date       – the date exactly as it appears in the text (string, required)
  startTime  – start time exactly as it appears, or null
  endTime    – end time exactly as it appears, or null
  location   – location or room if present, or null
  recurrence – recurrence pattern exactly as it appears ("every Monday", "weekly", etc.), or null

Return ONLY a JSON array — no markdown fences, no explanation. If no events are found, return [].

OCR text:
${ocrText}`,
        },
      ],
    }),
  });

  if (!res.ok) {
    throw new ParseError('EXTRACTION_FAILED', `Claude API returned ${res.status} during extraction`);
  }

  const data = await res.json();
  const raw: string = data.content?.[0]?.text ?? '';
  const usage: ClaudeUsage = data.usage ?? { input_tokens: 0, output_tokens: 0 };

  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      return { events: [], reason: 'EXTRACTION_PARSE_ERROR', usage };
    }
    const events = parsed.map((e: Record<string, unknown>) => ({
      name: String(e.name ?? ''),
      date: String(e.date ?? ''),
      startTime: e.startTime != null ? String(e.startTime) : null,
      endTime: e.endTime != null ? String(e.endTime) : null,
      location: e.location != null ? String(e.location) : null,
      recurrence: e.recurrence != null ? String(e.recurrence) : null,
    }));
    return { events, reason: events.length === 0 ? 'NO_EVENTS_FOUND' : null, usage };
  } catch {
    return { events: [], reason: 'EXTRACTION_PARSE_ERROR', usage };
  }
}

// ---------------------------------------------------------------------------
// Stage 3: Normalisation
// ---------------------------------------------------------------------------

type VariableScheduleSuggestion = {
  masterId: string;
  masterTitle: string;
  occurrenceDate: string; // YYYY-MM-DD — the week slot to pre-fill
};

type NormalizedEvent = CandidateEvent & {
  startDateTime: string | null;    // "YYYY-MM-DDTHH:mm:ss" local — no offset
  endDateTime: string | null;      // "YYYY-MM-DDTHH:mm:ss" local — no offset
  recurrenceRule: string | null;   // RFC 5545 RRULE string, or null
  flagged: boolean;
  flagReasons: string[];           // PAST_DATE | OUTSIDE_WINDOW | UNPARSEABLE_DATE | UNSUPPORTED_RRULE | CONFLICT
  conflictingEventIds: string[];   // master event IDs of overlapping calendar events
  variableScheduleSuggestions: VariableScheduleSuggestion[]; // B2: weeks that match a variable routine
};

const WINDOW_DAYS = 180;

// Map common natural-language recurrence strings to RRULE. The engine's
// parseRRule is called afterward to confirm validity.
const DAY_CODES: Record<string, string> = {
  monday: 'MO', mon: 'MO',
  tuesday: 'TU', tue: 'TU',
  wednesday: 'WE', wed: 'WE',
  thursday: 'TH', thu: 'TH',
  friday: 'FR', fri: 'FR',
  saturday: 'SA', sat: 'SA',
  sunday: 'SU', sun: 'SU',
};

function toRRule(text: string): string | null {
  const t = text.toLowerCase().trim();

  if (/\bdail(y|ies)\b|every\s+day\b/.test(t)) return 'FREQ=DAILY';
  if (/\bbiweekl(y|ies)\b|every\s+(other|two|2)\s+week/.test(t)) return 'FREQ=WEEKLY;INTERVAL=2';
  if (/\bweekl(y|ies)\b|every\s+week\b/.test(t)) return 'FREQ=WEEKLY';
  if (/\bmonthl(y|ies)\b|every\s+month\b/.test(t)) return 'FREQ=MONTHLY';
  if (/\byearl(y|ies)\b|every\s+year\b|\bannual/.test(t)) return 'FREQ=YEARLY';
  if (/\bweekday/.test(t)) return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';

  const m = t.match(/every\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b/);
  if (m) {
    const code = DAY_CODES[m[1]!];
    if (code) return `FREQ=WEEKLY;BYDAY=${code}`;
  }

  return null;
}

// Format a JS Date as a local "YYYY-MM-DDTHH:mm:ss" string in the given timezone.
function toLocalDateTimeString(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  const datePart = `${get('year')}-${get('month')}-${get('day')}`;
  const timePart = `${get('hour')}:${get('minute')}:${get('second')}`;
  return `${datePart}T${timePart}`;
}

function runNormalisation(events: CandidateEvent[], timezone: string): NormalizedEvent[] {
  // Reference date: today's calendar date in the user's timezone, set to noon
  // so relative terms like "next Tuesday" resolve without midnight edge cases.
  const todayStr = new Date().toLocaleDateString('en-CA', { timeZone: timezone });
  const [ty, tm, td] = todayStr.split('-').map(Number);
  const refDate = new Date(ty!, tm! - 1, td!, 12, 0, 0);

  const nowMs = Date.now();
  const windowEndMs = nowMs + WINDOW_DAYS * 86_400_000;

  return events.map((event): NormalizedEvent => {
    const flagReasons: string[] = [];

    // --- Date/time resolution ---
    let startDateTime: string | null = null;
    let endDateTime: string | null = null;

    const dateInput = [event.date, event.startTime].filter(Boolean).join(' ');
    const parsedStart = chrono.parseDate(dateInput, refDate);

    if (!parsedStart) {
      flagReasons.push('UNPARSEABLE_DATE');
    } else {
      startDateTime = toLocalDateTimeString(parsedStart, timezone);

      // Flag past dates and dates beyond the 180-day window.
      const startMs = parsedStart.getTime();
      if (startMs < nowMs) {
        flagReasons.push('PAST_DATE');
      } else if (startMs > windowEndMs) {
        flagReasons.push('OUTSIDE_WINDOW');
      }

      // Resolve end time if present, using the same date as anchor.
      if (event.endTime) {
        const endInput = [event.date, event.endTime].filter(Boolean).join(' ');
        const parsedEnd = chrono.parseDate(endInput, refDate);
        if (parsedEnd) {
          endDateTime = toLocalDateTimeString(parsedEnd, timezone);
        }
      }
    }

    // --- Recurrence conversion ---
    let recurrenceRule: string | null = null;
    if (event.recurrence) {
      const candidate = toRRule(event.recurrence);
      if (!candidate) {
        flagReasons.push('UNSUPPORTED_RRULE');
      } else {
        try {
          parseRRule(candidate); // throws UnsupportedRRuleError if invalid
          recurrenceRule = candidate;
        } catch (e) {
          if (e instanceof UnsupportedRRuleError) {
            flagReasons.push('UNSUPPORTED_RRULE');
          } else {
            throw e;
          }
        }
      }
    }

    return {
      ...event,
      startDateTime,
      endDateTime,
      recurrenceRule,
      flagged: flagReasons.length > 0,
      flagReasons,
      conflictingEventIds: [],
      variableScheduleSuggestions: [],
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 4: Conflict detection
// ---------------------------------------------------------------------------

// True when the interval [aStart, aEnd) overlaps [bStart, bEnd).
// ISO UTC strings are lexicographically comparable.
function overlapsUtc(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

// Add one hour to a "YYYY-MM-DDTHH:mm:ss" local string (used as a fallback
// end time when the candidate has no endDateTime).
function addOneHour(localDatetime: string): string {
  const ms = new Date(localDatetime + 'Z').getTime() + 3_600_000;
  return new Date(ms).toISOString().slice(0, 19);
}

async function runConflictDetection(
  normalised: NormalizedEvent[],
  userId: string,
  timezone: string,
  admin: ReturnType<typeof makeAdminClient>,
): Promise<NormalizedEvent[]> {
  // Collect the calendar-date portion of every parseable candidate.
  const validDates = normalised
    .filter((e) => e.startDateTime !== null && !e.flagReasons.includes('UNPARSEABLE_DATE'))
    .map((e) => e.startDateTime!.slice(0, 10));

  if (validDates.length === 0) return normalised;

  const from = validDates.reduce((a, b) => (a < b ? a : b));
  const to = validDates.reduce((a, b) => (a > b ? a : b));

  // Fetch all of the user's event rows (masters + exceptions) for the engine.
  const { data: rows, error: fetchError } = await admin
    .from('events')
    .select(
      'id, owner_id, title, description, location, local_start, local_end, ' +
        'timezone_id, is_master, master_event_id, recurrence_exception_date, ' +
        'recurrence_rule, is_cancelled, is_variable_schedule, visibility, color_label',
    )
    .eq('owner_id', userId);

  if (fetchError || !rows) {
    console.warn('[parse-worker] conflict detection: could not fetch events, skipping', fetchError);
    return normalised;
  }

  const records = (rows as EventRow[]).map(mapEventRow);

  let occurrences;
  try {
    occurrences = expandOccurrences(records, { from, to });
  } catch (e) {
    console.warn('[parse-worker] conflict detection: expandOccurrences failed, skipping', String(e));
    return normalised;
  }

  return normalised.map((event): NormalizedEvent => {
    if (!event.startDateTime || event.flagReasons.includes('UNPARSEABLE_DATE')) {
      return event;
    }

    const candidateUtcStart = localToUtc(parseLocal(event.startDateTime), timezone);
    const candidateUtcEnd = localToUtc(
      parseLocal(event.endDateTime ?? addOneHour(event.startDateTime)),
      timezone,
    );

    const conflictingEventIds = occurrences
      .filter((occ) => overlapsUtc(occ.utcStart, occ.utcEnd, candidateUtcStart, candidateUtcEnd))
      .map((occ) => occ.eventId)
      // Deduplicate — a recurring event can produce multiple overlapping occurrences.
      .filter((id, i, arr) => arr.indexOf(id) === i);

    if (conflictingEventIds.length === 0) return event;

    return {
      ...event,
      conflictingEventIds,
      flagged: true,
      flagReasons: [...event.flagReasons, 'CONFLICT'],
    };
  });
}

// ---------------------------------------------------------------------------
// Stage 5 (B2): Variable-schedule detection
// ---------------------------------------------------------------------------

// Same arithmetic as _shared/variable.ts:isVariableWeek — weekly on the anchor
// weekday, on or after the anchor date. Inlined here so the worker doesn't pull
// in the full OccurrenceModel machinery from variable.ts.
function onVariableWeek(anchorLocalStart: string | null, date: string): boolean {
  if (!anchorLocalStart) return false;
  const c = parseLocal(anchorLocalStart); // reuse already-imported parseLocal
  const anchorMs = Date.UTC(c.year, c.month - 1, c.day);
  const dateMs = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(dateMs) || dateMs < anchorMs) return false;
  return (dateMs - anchorMs) % (7 * 86_400_000) === 0;
}

async function runVariableScheduleDetection(
  events: NormalizedEvent[],
  userId: string,
  admin: ReturnType<typeof makeAdminClient>,
): Promise<NormalizedEvent[]> {
  // Skip the DB fetch if no event has a resolvable date.
  const hasDateable = events.some(
    (e) => e.startDateTime !== null && !e.flagReasons.includes('UNPARSEABLE_DATE'),
  );
  if (!hasDateable) return events;

  const { data: masters, error } = await admin
    .from('events')
    .select('id,title,local_start')
    .eq('owner_id', userId)
    .eq('is_variable_schedule', true)
    .eq('is_master', true);

  if (error) {
    console.warn('[parse-worker] B2: could not fetch variable masters, skipping', error);
    return events;
  }
  if (!masters || masters.length === 0) return events;

  return events.map((event): NormalizedEvent => {
    if (!event.startDateTime || event.flagReasons.includes('UNPARSEABLE_DATE')) return event;

    const eventDate = event.startDateTime.slice(0, 10);
    const suggestions: VariableScheduleSuggestion[] = masters
      .filter((m) => onVariableWeek(m.local_start, eventDate))
      .map((m) => ({
        masterId: m.id,
        masterTitle: m.title ?? 'Variable schedule',
        occurrenceDate: eventDate,
      }));

    if (suggestions.length === 0) return event;
    return { ...event, variableScheduleSuggestions: suggestions };
  });
}

// ---------------------------------------------------------------------------
// Stage 6 (Step 6): Push notification on job completion
// ---------------------------------------------------------------------------

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

async function sendParseCompleteNotification(
  userId: string,
  jobId: string,
  eventCount: number,
  admin: ReturnType<typeof makeAdminClient>,
): Promise<void> {
  const { data: deviceRows, error: devicesError } = await admin
    .from('devices')
    .select('expo_push_token')
    .eq('user_id', userId);

  if (devicesError || !deviceRows || deviceRows.length === 0) {
    if (devicesError) {
      console.warn('[parse-worker] push: could not fetch devices', devicesError);
    }
    return;
  }

  const noun = eventCount === 1 ? 'event' : 'events';
  const body =
    eventCount === 0
      ? 'No events found. Tap to see the scan result.'
      : `Found ${eventCount} ${noun}. Tap to review.`;

  const payloads = deviceRows.map((d: { expo_push_token: string }) => ({
    to: d.expo_push_token,
    title: 'Schedule scan complete',
    body,
    badge: eventCount,
    sound: 'default' as const,
    channelId: 'default',
    data: { type: 'parse_complete', jobId, eventCount },
  }));

  const expoToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (expoToken) headers['Authorization'] = `Bearer ${expoToken}`;

  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(payloads),
    });
    if (!res.ok) {
      console.warn('[parse-worker] push: Expo returned', res.status, await res.text());
      return;
    }
    const result = await res.json();
    const tickets = Array.isArray(result?.data) ? result.data : [];
    const errors = tickets.filter((t: { status: string }) => t.status !== 'ok');
    if (errors.length > 0) {
      console.warn('[parse-worker] push: some tickets errored', JSON.stringify(errors));
    } else {
      console.info('[parse-worker] push sent', { jobId, tokens: payloads.length, eventCount });
    }
  } catch (e) {
    // Best-effort — never let a push failure fail the job.
    console.warn('[parse-worker] push: fetch threw', String(e));
  }
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

class ParseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function makeAdminClient() {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set');
  return createClient(url, key, { auth: { persistSession: false } });
}

// Build a base64 string from a Uint8Array in chunks to avoid call-stack
// overflows on large images (spread into fromCharCode has a JS arg limit).
function toBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
