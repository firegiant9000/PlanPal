#!/usr/bin/env node
/**
 * Mirror `packages/recurrence/src` into `supabase/functions/_shared/recurrence`
 * as Deno-resolvable TypeScript.
 *
 * Why this exists
 * ---------------
 * `@planpal/recurrence` is the ONE recurrence engine. It is authored for Node
 * (NodeNext resolution, `./x.js` specifiers) and tested with `node:test`. Deno —
 * which runs the Edge Functions — cannot resolve a `./x.js` specifier to an
 * `x.ts` file, and cannot resolve the `@planpal/types` workspace alias.
 *
 * Rather than hand-maintaining a second copy inside the function (which is how
 * the two implementations silently diverged in the first place), this script
 * generates the Deno copy mechanically and CI fails if the checked-in output
 * has drifted. Same pattern the repo already uses for
 * `packages/types/src/generated/openapi.ts`.
 *
 * Transformations (all purely mechanical):
 *   - `from './x.js'`        -> `from './x.ts'`
 *   - `from '@planpal/types'` -> `from './planpal-types.ts'` (local type shim)
 *   - a DO-NOT-EDIT banner is prepended to every file
 *   - `*.test.ts` are not copied (they run under `node:test` in the package)
 *
 * Usage:
 *   node scripts/sync-recurrence-edge.mjs         # write
 *   node scripts/sync-recurrence-edge.mjs --check # verify no drift (CI)
 */
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(root, 'packages', 'recurrence', 'src');
const OUT = join(root, 'supabase', 'functions', '_shared', 'recurrence');

const BANNER = `// ---------------------------------------------------------------------------
// GENERATED FILE — DO NOT EDIT.
// Source: packages/recurrence/src/{FILE}
// Regenerate: pnpm recurrence:sync   (CI verifies with --check)
// ---------------------------------------------------------------------------
`;

/**
 * Local stand-in for the two type-only imports the engine takes from
 * `@planpal/types`. Kept structurally identical to the generated contract types
 * (packages/types/src/generated/openapi.ts) so the engine type-checks the same
 * under Deno as it does under tsc.
 */
const TYPE_SHIM = `// ---------------------------------------------------------------------------
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
`;

function transform(source, file) {
  const body = source
    .replace(/(from\s+['"])(\.\.?\/[^'"]+)\.js(['"])/g, '$1$2.ts$3')
    .replace(/(from\s+['"])@planpal\/types(['"])/g, "$1./planpal-types.ts$2");
  return BANNER.replace('{FILE}', file) + '\n' + body;
}

function build() {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
  const out = new Map();
  for (const file of files) {
    out.set(file, transform(readFileSync(join(SRC, file), 'utf8'), file));
  }
  out.set('planpal-types.ts', TYPE_SHIM);
  return out;
}

const generated = build();
const check = process.argv.includes('--check');

if (check) {
  const problems = [];
  const existing = existsSync(OUT)
    ? new Set(readdirSync(OUT).filter((f) => f.endsWith('.ts')))
    : new Set();

  for (const [file, content] of generated) {
    const path = join(OUT, file);
    if (!existsSync(path)) {
      problems.push(`missing: ${file}`);
      continue;
    }
    if (readFileSync(path, 'utf8') !== content) problems.push(`drifted: ${file}`);
    existing.delete(file);
  }
  for (const stale of existing) problems.push(`stale (no longer in source): ${stale}`);

  if (problems.length > 0) {
    console.error('supabase/functions/_shared/recurrence is out of date:\n  ' + problems.join('\n  '));
    console.error('\nRun `pnpm recurrence:sync` and commit the result.');
    process.exit(1);
  }
  console.log('recurrence edge mirror is up to date.');
} else {
  if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  for (const [file, content] of generated) writeFileSync(join(OUT, file), content, 'utf8');
  console.log(`wrote ${generated.size} files to supabase/functions/_shared/recurrence`);
}
