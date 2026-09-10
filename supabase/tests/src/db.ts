/**
 * Direct Postgres access for assertions the HTTP surface cannot make.
 *
 * Most of this suite deliberately goes through the API, because that is the
 * path a client takes. But two of the gates in §13 are properties of the
 * *database* — which functions are executable by which role, and whether RLS is
 * enabled with policies on every table — and those live in system catalogs that
 * PostgREST does not expose. They need a real connection.
 *
 * Superuser on purpose: the audit has to be able to see grants it is asserting
 * the *absence* of. A restricted role would report "cannot see it" and "it is
 * not there" identically, which is exactly the failure mode being guarded
 * against.
 */
import { Client } from 'pg';

/** Local stack default from `supabase start`; overridable for CI. */
export const DATABASE_URL =
  process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Run a multi-statement SQL script, such as a seed file.
 *
 * Separate from `query` because node-postgres switches to the extended
 * protocol as soon as a parameter array is supplied, and that protocol rejects
 * more than one statement per request.
 */
export async function exec(sql: string): Promise<void> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query(sql, params);
    return result.rows as T[];
  } finally {
    await client.end();
  }
}
