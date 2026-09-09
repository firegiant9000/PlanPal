import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * §15's last rule, made enforceable: "No component imports `supabase-js` or
 * calls `fetch` — enforced by lint, not by convention."
 *
 * §5 says to ban `fetch` with `no-restricted-imports`. That cannot work —
 * `fetch` is a global, and `no-restricted-imports` only sees import
 * declarations. `no-restricted-globals` is the rule that can see it.
 *
 * These three snippets are the proof the rule fires. A lint rule nobody has
 * watched reject anything is indistinguishable from no rule at all, and the
 * third case passes vacuously without the first two, which is why all three
 * are here.
 */

const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

const SUPABASE_IMPORT = `
import { createClient } from '@supabase/supabase-js';
export const client = createClient('url', 'key');
`;

const BARE_FETCH = `
export async function loadEvents(): Promise<unknown> {
  const res = await fetch('https://example.test/events');
  return res.json();
}
`;

async function lint(code: string, relativePath: string) {
  // Linting text through the Node API is slower than the CLI, so this stays at
  // three snippets rather than growing into a second test suite.
  const eslint = new ESLint({ cwd: REPO_ROOT });
  const [result] = await eslint.lintText(code, {
    filePath: fileURLToPath(new URL(relativePath, `file://${REPO_ROOT.replace(/\\/g, '/')}`)),
  });
  return result?.messages ?? [];
}

describe('the api-client boundary is enforced by lint', () => {
  it('flags a supabase-js import in apps/web', async () => {
    const messages = await lint(SUPABASE_IMPORT, 'apps/web/src/x.ts');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('no-restricted-imports');
    expect(messages[0]?.message).toContain('@planpal/api-client');
  });

  it('flags a bare fetch call in apps/mobile', async () => {
    const messages = await lint(BARE_FETCH, 'apps/mobile/src/x.ts');

    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('no-restricted-globals');
    expect(messages[0]?.message).toContain('@planpal/api-client');
  });

  it('allows both inside packages/api-client', async () => {
    // This package is the one legal place for either. Without the two tests
    // above, this one would pass with no rule configured at all.
    const supabase = await lint(SUPABASE_IMPORT, 'packages/api-client/src/x.ts');
    const bare = await lint(BARE_FETCH, 'packages/api-client/src/x.ts');

    expect(supabase).toEqual([]);
    expect(bare).toEqual([]);
  });
});
