import {
  resolveDatabaseUrl,
  DEFAULT_DATABASE_URL,
} from '../../src/supabase/database-url';

describe('resolveDatabaseUrl', () => {
  it('throws in production when DATABASE_URL is missing', () => {
    expect(() => resolveDatabaseUrl({ NODE_ENV: 'production' })).toThrow(
      /DATABASE_URL must be set/,
    );
  });

  it('returns the local default outside production', () => {
    expect(resolveDatabaseUrl({})).toBe(DEFAULT_DATABASE_URL);
  });

  it('uses DATABASE_URL when set', () => {
    expect(
      resolveDatabaseUrl({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgres://user:pass@host:5432/db',
      }),
    ).toBe('postgres://user:pass@host:5432/db');
  });
});
