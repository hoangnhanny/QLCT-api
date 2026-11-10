import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { AuthGuard } from '../../src/auth/auth.guard';
import { DEFAULT_LOCAL_JWT_SECRET } from '../../src/auth/jwt-secret';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('AuthGuard', () => {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const supabase = { db: { query } } as unknown as SupabaseService;

  beforeEach(() => {
    query.mockClear();
    process.env.JWT_SECRET = DEFAULT_LOCAL_JWT_SECRET;
  });

  function requestContext(token?: string) {
    const request = {
      headers: { authorization: token ? `Bearer ${token}` : undefined },
      user: undefined as { id: string } | undefined,
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { request, context };
  }

  function createToken(sub = 'user-1', secret = DEFAULT_LOCAL_JWT_SECRET) {
    return new SignJWT({
      user_metadata: {
        full_name: 'Test User',
        avatar_url: 'https://example.com/avatar.jpg',
      },
      email: 'test@example.com',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(secret));
  }

  it('accepts a valid HS256 JWT token', async () => {
    const token = await createToken('user-1');
    const { request, context } = requestContext(token);

    await expect(new AuthGuard(supabase).canActivate(context)).resolves.toBe(
      true,
    );
    expect(request.user).toEqual({ id: 'user-1' });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('profiles'), [
      'user-1',
      'test@example.com',
      'Test User',
      'https://example.com/avatar.jpg',
    ]);
  });

  it('rejects an expired token', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-1')
      .setExpirationTime(1)
      .sign(new TextEncoder().encode(DEFAULT_LOCAL_JWT_SECRET));
    const { context } = requestContext(token);

    await expect(
      new AuthGuard(supabase).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = await createToken(
      'user-1',
      'completely-wrong-secret-key-32-chars-long',
    );
    const { context } = requestContext(token);

    await expect(
      new AuthGuard(supabase).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a missing or malformed token', async () => {
    for (const token of [undefined, 'not-a-jwt']) {
      const { context } = requestContext(token);
      await expect(
        new AuthGuard(supabase).canActivate(context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('rejects a token with an empty subject', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(DEFAULT_LOCAL_JWT_SECRET));
    const { context } = requestContext(token);

    await expect(
      new AuthGuard(supabase).canActivate(context),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
