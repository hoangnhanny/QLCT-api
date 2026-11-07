const LOCAL_DB_USER = 'postgres';
const LOCAL_DB_PASSWORD = 'postgres';
const LOCAL_DB_HOST = '127.0.0.1';
const LOCAL_DB_PORT = '54322';
const LOCAL_DB_NAME = 'postgres';

export const DEFAULT_DATABASE_URL = `postgresql://${LOCAL_DB_USER}:${LOCAL_DB_PASSWORD}@${LOCAL_DB_HOST}:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`;

/**
 * Resolves the Postgres connection string. In production, `DATABASE_URL`
 * must be explicitly set; outside production it falls back to the local
 * Supabase CLI's Postgres instance so tests keep working.
 */
export function resolveDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'DATABASE_URL must be set in production (refusing to fall back to the local Postgres instance)',
      );
    }
    return DEFAULT_DATABASE_URL;
  }
  return databaseUrl;
}
