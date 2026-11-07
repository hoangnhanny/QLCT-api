import { assertLocalDatabaseUrl } from './db';

describe('assertLocalDatabaseUrl', () => {
  it('throws for a non-local host', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://u:p@db.example.com:5432/postgres'),
    ).toThrow(/local/i);
  });

  it('passes for 127.0.0.1', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://u:p@127.0.0.1:54322/postgres'),
    ).not.toThrow();
  });

  it('passes for localhost', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://u:p@localhost:54322/postgres'),
    ).not.toThrow();
  });

  it('passes for ::1', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://u:p@[::1]:54322/postgres'),
    ).not.toThrow();
  });
});
