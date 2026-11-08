import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthenticatedUser } from './authenticated-user';
import { getJwtSecret } from './jwt-secret';

/**
 * Verifies Supabase ES256 tokens with JWKS and legacy HS256 tokens with
 * `SUPABASE_JWT_SECRET`.
 * On success, sets `request.user = { id: <sub> }` and upserts the caller's
 * `profiles` row from the token's `user_metadata`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret: Uint8Array;
  private readonly issuer: string;
  private readonly jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(private readonly supabase: SupabaseService) {
    this.secret = getJwtSecret();
    const supabaseUrl = (
      process.env.SUPABASE_URL || 'http://127.0.0.1:54321'
    ).replace(/\/$/, '');
    this.issuer = `${supabaseUrl}/auth/v1`;
    this.jwks = createRemoteJWKSet(
      new URL(`${this.issuer}/.well-known/jwks.json`),
    );
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: Record<string, unknown>;
    try {
      const { alg } = decodeProtectedHeader(token);
      const result =
        alg === 'ES256'
          ? await jwtVerify(token, this.jwks, {
              algorithms: ['ES256'],
              issuer: this.issuer,
              audience: 'authenticated',
            })
          : await jwtVerify(token, this.secret, {
              algorithms: ['HS256'],
            });
      payload = result.payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const userId = payload.sub;
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new UnauthorizedException('Token is missing a subject');
    }

    await this.upsertProfile(userId, payload);

    const user: AuthenticatedUser = { id: userId };
    request.user = user;
    return true;
  }

  private async upsertProfile(
    userId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const metadata =
      (payload.user_metadata as Record<string, unknown> | undefined) ?? {};
    const displayName =
      (metadata.full_name as string | undefined) ??
      (metadata.name as string | undefined) ??
      null;
    const avatarUrl =
      (metadata.avatar_url as string | undefined) ??
      (payload.picture as string | undefined) ??
      null;

    await this.supabase.db.query(
      `insert into public.profiles (user_id, display_name, avatar_url)
       values ($1, $2, $3)
       on conflict (user_id) do update set
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url
       where public.profiles.display_name is distinct from excluded.display_name
          or public.profiles.avatar_url is distinct from excluded.avatar_url`,
      [userId, displayName, avatarUrl],
    );
  }
}

function extractBearerToken(authorizationHeader?: string): string | undefined {
  if (!authorizationHeader?.startsWith('Bearer ')) {
    return undefined;
  }
  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token.length > 0 ? token : undefined;
}
