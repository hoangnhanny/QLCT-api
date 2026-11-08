import {
  getJwtSecret,
  DEFAULT_LOCAL_JWT_SECRET,
} from '../../src/auth/jwt-secret';

describe('getJwtSecret', () => {
  it('throws in production when SUPABASE_JWT_SECRET is missing', () => {
    expect(() => getJwtSecret({ NODE_ENV: 'production' })).toThrow(
      /SUPABASE_JWT_SECRET must be set/,
    );
  });

  it('returns the local default outside production', () => {
    const secret = getJwtSecret({});
    expect(secret).toEqual(new TextEncoder().encode(DEFAULT_LOCAL_JWT_SECRET));
  });

  it('uses SUPABASE_JWT_SECRET when set', () => {
    const secret = getJwtSecret({
      NODE_ENV: 'production',
      SUPABASE_JWT_SECRET: 'my-real-secret',
    });
    expect(secret).toEqual(new TextEncoder().encode('my-real-secret'));
  });
});
