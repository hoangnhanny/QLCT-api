import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { jwtVerify } from 'jose';
import { DataSource, Repository } from 'typeorm';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthenticatedUser } from './authenticated-user';
import { getJwtSecret } from './jwt-secret';
import { Profile as ProfileEntity } from '../database/entities/profile.entity';

/**
 * Verifies JWT tokens with application `JWT_SECRET`.
 * On success, sets `request.user = { id: <sub> }` and upserts the caller's
 * `profiles` row from the token's `user_metadata`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly secret: Uint8Array;
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly profileRepo?: Repository<ProfileEntity>;
  private readonly dataSource?: DataSource;

  constructor(
    @InjectRepository(ProfileEntity)
    profileRepoOrSupabase: Repository<ProfileEntity> | SupabaseService | any,
    @InjectDataSource()
    @Optional()
    dataSource?: DataSource,
  ) {
    this.secret = getJwtSecret();
    if (profileRepoOrSupabase?.db) {
      this.legacyDb = profileRepoOrSupabase.db;
    } else {
      this.profileRepo = profileRepoOrSupabase as Repository<ProfileEntity>;
      this.dataSource = dataSource;
    }
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

    try {
      await this.upsertProfile(userId, payload);
    } catch {
      // Non-blocking: don't fail user requests if profile upsert fails
    }

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

    if (this.legacyDb) {
      try {
        await this.legacyDb.query(
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

      try {
        await this.legacyDb.query(
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
      } catch {
        try {
          await this.legacyDb.query(
            `insert into public.profiles (user_id, display_name, avatar_url)
             values ($1, $2, $3)
             on conflict (user_id) do update set
               display_name = excluded.display_name,
               avatar_url = excluded.avatar_url`,
            [userId, displayName, avatarUrl],
          );
        } catch {
          // Silently ignore if profiles table has foreign key constraint issues
        }
      }
      return;
    }

    if (this.dataSource) {
      try {
        await this.dataSource.query(
          `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
           values ('00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', coalesce($2, ''), '', now(), now(), now())
           on conflict (id) do update set
             email = coalesce(excluded.email, auth.users.email),
             updated_at = now()`,
          [userId, email],
        );
      } catch {
        // Ignore
      }
    }

    let existing = await this.profileRepo!.findOne({ where: { userId } });
    if (!existing) {
      existing = this.profileRepo!.create({
        userId,
        email,
        displayName,
        avatarUrl,
      });
      await this.profileRepo!.save(existing);
    } else {
      let changed = false;
      if (displayName && existing.displayName !== displayName) {
        existing.displayName = displayName;
        changed = true;
      }
      if (avatarUrl && existing.avatarUrl !== avatarUrl) {
        existing.avatarUrl = avatarUrl;
        changed = true;
      }
      if (email && existing.email !== email) {
        existing.email = email;
        changed = true;
      }
      if (changed) {
        await this.profileRepo!.save(existing);
      }
    }
  }
}

function extractBearerToken(authorizationHeader?: string): string | undefined {
  if (!authorizationHeader) {
    return undefined;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
  return match?.[1];
}
