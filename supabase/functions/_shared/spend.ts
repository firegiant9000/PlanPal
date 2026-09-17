/**
 * Cost tracking + spend kill-switch for the screenshot-parse pipeline
 * (M5 cross-cutting: cost monitoring & budget alerts).
 *
 * Only Claude's OCR/extraction calls are priced here. Textract is the
 * low-confidence-image fallback path (`parse-worker`'s Stage 1b); this file
 * does not attach a dollar figure to it because there is no sourced, current
 * AWS price backing one in this codebase — adding that is a follow-up once
 * confirmed against the AWS console/billing, not a number to guess at here.
 * Claude is the dominant cost driver (every job calls it at least once, for
 * OCR; Textract only runs when Claude's own OCR confidence is low), so
 * pricing it alone still makes the kill-switch meaningful.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.116.0';

/**
 * Claude Haiku 4.5 pricing, USD per million tokens (as of the pricing table
 * cached 2026-06-24). Re-check https://www.anthropic.com/pricing before
 * relying on this for real budget enforcement — per-token pricing can change.
 */
const HAIKU_INPUT_USD_PER_MTOK = 1.0;
const HAIKU_OUTPUT_USD_PER_MTOK = 5.0;

export type ParseSpendStage = 'ocr' | 'extraction';

export interface ClaudeUsage {
  input_tokens: number;
  output_tokens: number;
}

export function claudeCostUsd(usage: ClaudeUsage): number {
  return (
    (usage.input_tokens / 1_000_000) * HAIKU_INPUT_USD_PER_MTOK +
    (usage.output_tokens / 1_000_000) * HAIKU_OUTPUT_USD_PER_MTOK
  );
}

/**
 * Record one Claude call's cost against a job. Non-fatal by design — a
 * ledger write failure must never break the parse pipeline it is only
 * observing; it's logged and swallowed, the same posture `parse-worker`
 * already takes toward its (non-critical) push notification.
 */
export async function recordClaudeSpend(
  admin: SupabaseClient,
  jobId: string,
  stage: ParseSpendStage,
  usage: ClaudeUsage,
): Promise<void> {
  const cost = claudeCostUsd(usage);
  const { error } = await admin
    .from('parse_spend_ledger')
    .insert({ job_id: jobId, provider: 'claude', stage, cost_usd: cost });

  if (error) {
    console.warn('[spend] could not record Claude spend', { jobId, stage, error });
  }
}

/**
 * Whether the trailing-24h Claude spend across ALL users has crossed
 * `PARSE_DAILY_SPEND_LIMIT_USD`. Unset (or non-numeric/non-positive) disables
 * the kill switch entirely — it must be opted into deliberately by setting an
 * env var, not trip by default in an environment nobody has configured a
 * threshold for.
 *
 * The window is rolling, not a fixed calendar day: MONTH5.md's "until reset"
 * happens naturally as old spend ages out of the trailing 24h — the same
 * design `parse/index.ts`'s per-user rate limit already uses, so there is no
 * separate reset mechanism to build or operate.
 *
 * Fails OPEN on a DB error, mirroring `isRateLimited`'s own reasoning: an
 * infrastructure hiccup in reading the ledger should not take the whole
 * upload flow down.
 *
 * Sums client-side rather than via a DB-side `sum()`: at this product's scale
 * (at most 2 ledger rows per job, jobs rate-limited to 15/user/day) the row
 * count in any 24h window stays small. Move this to a database aggregate
 * (an RPC, or a materialized view) if that stops being true.
 */
export async function isSpendCapped(admin: SupabaseClient): Promise<boolean> {
  const limitRaw = Deno.env.get('PARSE_DAILY_SPEND_LIMIT_USD');
  if (!limitRaw) return false;

  const limit = Number(limitRaw);
  if (!Number.isFinite(limit) || limit <= 0) {
    console.warn(
      '[spend] PARSE_DAILY_SPEND_LIMIT_USD is set but not a positive number — kill switch disabled',
      limitRaw,
    );
    return false;
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await admin
    .from('parse_spend_ledger')
    .select('cost_usd')
    .gte('created_at', since);

  if (error) {
    console.error('[spend] could not read spend ledger — failing open', error);
    return false;
  }

  const total = (data ?? []).reduce(
    (sum, row: { cost_usd: number }) => sum + Number(row.cost_usd),
    0,
  );
  return total >= limit;
}
