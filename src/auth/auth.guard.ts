import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { jwtVerify } from 'jose';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthenticatedUser } from './authenticated-user';
import { getJwtSecret } from './jwt-secret';

/**
 * Verifies JWT tokens with application `JWT_SECRET`.
 * On success, sets `request.user = { id: <sub> }` and upserts the caller's
 * `profiles` row from the token's `user_metadata`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret: Uint8Array;

  constructor(private readonly supabase: SupabaseService) {
    this.secret = getJwtSecret();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers?.authorization);
    if (!token) {
      throw new UnauthorizedException('Missing bearer token');
    }

    let payload: Record<string, unknown>;
    try {
      const result = await jwtVerify(token, this.secret, {
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
    const email =
      (payload.email as string | undefined) ??
      (metadata.email as string | undefined) ??
      null;

    try {
      await this.supabase.db.query(
        `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', coalesce($2, ''), '', now(), now(), now())
         on conflict (id) do update set
           email = coalesce(excluded.email, auth.users.email),
           updated_at = now()`,
        [userId, email],
      );
    } catch {
      // In case auth.users table is not directly accessible or already managed
    }

    await this.supabase.db.query(
      `insert into public.profiles (user_id, email, display_name, avatar_url, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (user_id) do update set
         email = coalesce(excluded.email, public.profiles.email),
         display_name = excluded.display_name,
         avatar_url = excluded.avatar_url,
         updated_at = now()
       where public.profiles.display_name is distinct from excluded.display_name
          or public.profiles.avatar_url is distinct from excluded.avatar_url
          or public.profiles.email is distinct from excluded.email`,
      [userId, email, displayName, avatarUrl],
    );
  }
}

function extractBearerToken(authorizationHeader?: string): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1];
}
