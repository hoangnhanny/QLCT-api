export const DEFAULT_LOCAL_JWT_SECRET =
  'super-secret-jwt-token-with-at-least-32-characters-long';

/**
 * Resolves the JWT HS256 secret as bytes. In production,
 * `JWT_SECRET` (or legacy `SUPABASE_JWT_SECRET`) must be explicitly set;
 * outside production it falls back to the fixed dev secret so tests keep working.
 */
export function getJwtSecret(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const secret = env.JWT_SECRET || env.SUPABASE_JWT_SECRET;
  if (!secret) {
    if (env.NODE_ENV === 'production') {
      throw new Error(
        'SUPABASE_JWT_SECRET must be set in production (refusing to fall back to the local dev secret)',
      );
    }
    return new TextEncoder().encode(DEFAULT_LOCAL_JWT_SECRET);
  }
  return new TextEncoder().encode(secret);
}
