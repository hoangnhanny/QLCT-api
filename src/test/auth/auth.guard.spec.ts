import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { AuthGuard } from '../../src/auth/auth.guard';
import { DEFAULT_LOCAL_JWT_SECRET } from '../../src/auth/jwt-secret';
import { SupabaseService } from '../../src/supabase/supabase.service';

describe('AuthGuard', () => {
  let server: Server;
  let supabaseUrl: string;
  let keys: Awaited<ReturnType<typeof generateKeyPair>>;
  const originalUrl = process.env.SUPABASE_URL;
  const originalSecret = process.env.SUPABASE_JWT_SECRET;
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const supabase = { db: { query } } as unknown as SupabaseService;

  beforeAll(async () => {
    keys = await generateKeyPair('ES256');
    const publicKey = await exportJWK(keys.publicKey);
    server = createServer((request, response) => {
      if (request.url !== '/auth/v1/.well-known/jwks.json') {
        response.writeHead(404).end();
        return;
      }
      response.setHeader('Content-Type', 'application/json');
      response.end(
        JSON.stringify({
          keys: [{ ...publicKey, kid: 'test-key', alg: 'ES256', use: 'sig' }],
        }),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    supabaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  beforeEach(() => {
    query.mockClear();
    process.env.SUPABASE_URL = supabaseUrl;
    process.env.SUPABASE_JWT_SECRET = DEFAULT_LOCAL_JWT_SECRET;
  });

  afterAll(async () => {
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalSecret === undefined) delete process.env.SUPABASE_JWT_SECRET;
    else process.env.SUPABASE_JWT_SECRET = originalSecret;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
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

  function esToken() {
    return new SignJWT({ user_metadata: { full_name: 'Test User' } })
      .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
      .setSubject('user-1')
      .setIssuer(`${supabaseUrl}/auth/v1`)
      .setAudience('authenticated')
      .setExpirationTime('5m');
  }

  it('accepts a valid Supabase ES256 token using its JWKS', async () => {
    const token = await esToken().sign(keys.privateKey);
    const { request, context } = requestContext(token);

    await expect(new AuthGuard(supabase).canActivate(context)).resolves.toBe(
      true,
    );
    expect(request.user).toEqual({ id: 'user-1' });
    expect(query).toHaveBeenCalledWith(expect.any(String), [
      'user-1',
      'Test User',
      null,
    ]);
  });

  it('continues accepting legacy HS256 tokens', async () => {
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('legacy-user')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(DEFAULT_LOCAL_JWT_SECRET));
    const { request, context } = requestContext(token);

    await expect(new AuthGuard(supabase).canActivate(context)).resolves.toBe(
      true,
    );
    expect(request.user).toEqual({ id: 'legacy-user' });
  });

  it.each(['expired', 'wrong issuer', 'wrong audience', 'wrong signature'])(
    'rejects an ES256 token with %s',
    async (failure) => {
      const builder = esToken();
      if (failure === 'expired') builder.setExpirationTime(1);
      if (failure === 'wrong issuer')
        builder.setIssuer('https://other.example/auth/v1');
      if (failure === 'wrong audience') builder.setAudience('other');
      const privateKey =
        failure === 'wrong signature'
          ? (await generateKeyPair('ES256')).privateKey
          : keys.privateKey;
      const { context } = requestContext(await builder.sign(privateKey));

      await expect(
        new AuthGuard(supabase).canActivate(context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(query).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'not-a-jwt'])(
    'rejects a missing or malformed token: %s',
    async (token) => {
      const { context } = requestContext(token);
      await expect(
        new AuthGuard(supabase).canActivate(context),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(query).not.toHaveBeenCalled();
    },
  );
});
