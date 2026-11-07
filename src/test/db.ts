import { Pool, types } from 'pg';

types.setTypeParser(1082, (val: string) => val);

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

let pool: Pool | undefined;

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/**
 * Throws unless `url` points at a local Postgres instance (127.0.0.1,
 * localhost, or ::1). Guards destructive test helpers against ever running
 * against a misconfigured `DATABASE_URL` (CI secret, shared staging, etc.).
 */
export function assertLocalDatabaseUrl(url: string): void {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    throw new Error(`Refusing to operate on non-local database URL: ${url}`);
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to operate on non-local database host "${hostname}". ` +
        `Only 127.0.0.1, localhost, or ::1 are allowed.`,
    );
  }
}

/** Returns a shared pg Pool connected to the local Supabase Postgres instance. */
export function getPool(): Pool {
  if (!pool) {
    assertLocalDatabaseUrl(DATABASE_URL);
    pool = new Pool({ connectionString: DATABASE_URL });
  }
  return pool;
}

/**
 * Truncates all app tables (cascading) and deletes rows created in
 * `auth.users` by tests, leaving the schema itself intact.
 */
export async function resetDb(): Promise<void> {
  assertLocalDatabaseUrl(DATABASE_URL);
  const db = getPool();
  await db.query(
    `truncate table
      public.push_subscriptions,
      public.invites,
      public.budget_alerts,
      public.budgets,
      public.expenses,
      public.categories,
      public.members,
      public.ledgers,
      public.profiles
    restart identity cascade`,
  );
  await db.query(`delete from auth.users`);
}

/**
 * Inserts a row into `auth.users` and returns its uuid. Does NOT create the
 * corresponding `profiles` row — callers that need one must insert it
 * themselves.
 */
export async function createTestUser(displayName?: string): Promise<string> {
  assertLocalDatabaseUrl(DATABASE_URL);
  const db = getPool();
  const email = `${displayName ?? 'test'}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}@example.com`;
  const result = await db.query<{ id: string }>(
    `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, '', now(), now(), now())
     returning id`,
    [email],
  );
  return result.rows[0].id;
}
