import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Optional,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthGuard } from './auth.guard';
import { AuthenticatedUser } from './authenticated-user';
import { CurrentUser } from './current-user.decorator';
import { Profile as ProfileEntity } from '../database/entities/profile.entity';

function normalizeProvider(provider?: string | null): string | null {
  const value = provider?.trim().toLowerCase();
  return value ? value : null;
}

function matchesRegisteredProvider(
  profileUserId: string,
  authProviders: string[] | null | undefined,
  requestedId?: string,
  requestedProvider?: string | null,
): boolean {
  if (!requestedProvider) return true;
  if (Array.isArray(authProviders) && authProviders.length > 0) {
    return authProviders.includes(requestedProvider);
  }
  return Boolean(requestedId && profileUserId === requestedId);
}

@Controller('auth')
export class AuthController {
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
    if (profileRepoOrSupabase?.db) {
      this.legacyDb = profileRepoOrSupabase.db;
    } else {
      this.profileRepo = profileRepoOrSupabase as Repository<ProfileEntity>;
      this.dataSource = dataSource;
    }
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `select user_id, email, display_name, avatar_url, created_at, updated_at
         from public.profiles
         where user_id = $1`,
        [user.id],
      );
      const profile = result.rows[0];
      return {
        id: user.id,
        email: profile?.email ?? null,
        displayName: profile?.display_name ?? null,
        avatarUrl: profile?.avatar_url ?? null,
        createdAt: profile?.created_at ?? null,
        updatedAt: profile?.updated_at ?? null,
      };
    }

    const profile = await this.profileRepo!.findOne({
      where: { userId: user.id },
    });
    return {
      id: user.id,
      email: profile?.email ?? null,
      displayName: profile?.displayName ?? null,
      avatarUrl: profile?.avatarUrl ?? null,
      createdAt: profile?.createdAt ?? null,
      updatedAt: profile?.updatedAt ?? null,
    };
  }

  @Get('check-user')
  async checkUser(
    @Query('id') id?: string,
    @Query('email') email?: string,
    @Query('provider') provider?: string,
  ) {
    if (!id && !email) {
      throw new BadRequestException('Provide either id or email');
    }
    const normalizedProvider = normalizeProvider(provider);

    if (this.legacyDb) {
      try {
        const conditions: string[] = [];
        const params: unknown[] = [];
        if (id) {
          params.push(id);
          conditions.push(`user_id = $${params.length}`);
        }
        if (email) {
          params.push(email);
          conditions.push(`email = $${params.length}`);
        }
        const result = await this.legacyDb.query(
          `select user_id, email, display_name, avatar_url, auth_providers, created_at, updated_at
           from public.profiles
           where ${conditions.join(' or ')}
           order by created_at asc`,
          params,
        );
        const rows = result.rows ?? [];
        const exactRow = id
          ? rows.find((r: any) => r.user_id === id)
          : undefined;
        const profile = exactRow ?? rows[0];
        const exists = Boolean(
          profile &&
          matchesRegisteredProvider(
            profile.user_id,
            profile.auth_providers,
            id,
            normalizedProvider,
          ),
        );
        return {
          exists,
          profile: exists
            ? {
                id: profile.user_id,
                email: profile.email,
                displayName: profile.display_name,
                avatarUrl: profile.avatar_url,
                authProviders: profile.auth_providers ?? [],
                createdAt: profile.created_at,
                updatedAt: profile.updated_at,
              }
            : null,
        };
      } catch {
        if (id) {
          try {
            const result = await this.legacyDb.query(
              `select user_id, display_name, avatar_url, created_at
               from public.profiles
               where user_id = $1
               limit 1`,
              [id],
            );
            const profile = result.rows[0];
            return {
              exists: Boolean(profile),
              profile: profile
                ? {
                    id: profile.user_id,
                    email: null,
                    displayName: profile.display_name,
                    avatarUrl: profile.avatar_url,
                    authProviders: [],
                    createdAt: profile.created_at,
                    updatedAt: null,
                  }
                : null,
            };
          } catch {
            return { exists: false, profile: null };
          }
        }
        return { exists: false, profile: null };
      }
    }

    const whereConditions: Array<{ userId?: string; email?: string }> = [];
    if (id) whereConditions.push({ userId: id });
    if (email) whereConditions.push({ email });

    const profiles = await this.profileRepo!.find({
      where: whereConditions,
      order: { createdAt: 'ASC' },
    });
    const exactProfile = id
      ? profiles.find((item) => item.userId === id)
      : undefined;
    const profile = exactProfile ?? profiles[0];
    const exists = Boolean(
      profile &&
      matchesRegisteredProvider(
        profile.userId,
        profile.authProviders,
        id,
        normalizedProvider,
      ),
    );

    return {
      exists,
      profile: exists
        ? {
            id: profile.userId,
            email: profile.email,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
            authProviders: profile.authProviders ?? [],
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
          }
        : null,
    };
  }

  @Post('register')
  async register(
    @Body()
    body: {
      id: string;
      email?: string;
      displayName?: string;
      avatarUrl?: string;
      provider?: string;
    },
  ) {
    if (!body?.id) {
      throw new BadRequestException('Missing user id');
    }
    const userId = body.id;
    const email = body.email ?? null;
    const displayName = body.displayName ?? null;
    const avatarUrl = body.avatarUrl ?? null;
    const provider = normalizeProvider(body.provider);

    if (this.legacyDb) {
      // 1. Maintain optional auth.users record if table exists
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
        // In case auth.users table is not accessible
      }

      // 2. Upsert user into public.profiles (reusing existing user_id when email matches)
      let profile: any;
      try {
        const result = await this.legacyDb.query(
          `with existing as (
             select user_id from public.profiles
             where user_id = $1 or ($2::text is not null and email = $2)
             order by (user_id = $1) desc, created_at asc
             limit 1
           ),
           target as (
             select coalesce((select user_id from existing), $1::uuid) as resolved_user_id
           )
           insert into public.profiles (user_id, email, display_name, avatar_url, auth_providers, updated_at)
           select
             target.resolved_user_id,
             $2,
             $3,
             $4,
             case when $5::text is not null then array[$5::text] else '{}'::text[] end,
             now()
           from target
           on conflict (user_id) do update set
             email = coalesce(excluded.email, public.profiles.email),
             display_name = coalesce(excluded.display_name, public.profiles.display_name),
             avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
             auth_providers = case
               when $5::text is not null and not ($5::text = any(coalesce(public.profiles.auth_providers, '{}'::text[])))
                 then array_append(coalesce(public.profiles.auth_providers, '{}'::text[]), $5::text)
               else coalesce(public.profiles.auth_providers, '{}'::text[])
             end,
             updated_at = now()
           returning user_id, email, display_name, avatar_url, auth_providers, created_at, updated_at`,
          [userId, email, displayName, avatarUrl, provider],
        );
        profile = result.rows[0];
      } catch {
        try {
          const fallbackResult = await this.legacyDb.query(
            `insert into public.profiles (user_id, display_name, avatar_url)
             values ($1, $2, $3)
             on conflict (user_id) do update set
               display_name = coalesce(excluded.display_name, public.profiles.display_name),
               avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url)
             returning user_id, display_name, avatar_url, created_at`,
            [userId, displayName, avatarUrl],
          );
          profile = fallbackResult.rows[0];
        } catch {
          profile = {
            user_id: userId,
            email,
            display_name: displayName,
            avatar_url: avatarUrl,
            auth_providers: provider ? [provider] : [],
            created_at: new Date(),
            updated_at: new Date(),
          };
        }
      }

      return {
        success: true,
        profile: {
          id: profile?.user_id ?? userId,
          email: profile?.email ?? email,
          displayName: profile?.display_name ?? displayName,
          avatarUrl: profile?.avatar_url ?? avatarUrl,
          authProviders:
            profile?.auth_providers ?? (provider ? [provider] : []),
          createdAt: profile?.created_at ?? new Date(),
          updatedAt: profile?.updated_at ?? new Date(),
        },
      };
    }

    // TypeORM implementation
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
        // Ignore if auth.users table not accessible
      }
    }

    const whereLookup: Array<{ userId?: string; email?: string }> = [
      { userId },
    ];
    if (email) whereLookup.push({ email });
    const matches = await this.profileRepo!.find({
      where: whereLookup,
      order: { createdAt: 'ASC' },
    });
    let existing =
      matches.find((p) => p.userId === userId) ?? matches[0] ?? null;

    if (!existing) {
      existing = this.profileRepo!.create({
        userId,
        email,
        displayName,
        avatarUrl,
        authProviders: provider ? [provider] : [],
      });
    } else {
      if (email !== null) existing.email = email;
      if (displayName !== null) existing.displayName = displayName;
      if (avatarUrl !== null) existing.avatarUrl = avatarUrl;
      const currentProviders = existing.authProviders ?? [];
      if (provider && !currentProviders.includes(provider)) {
        existing.authProviders = [...currentProviders, provider];
      }
    }
    const saved = await this.profileRepo!.save(existing);

    return {
      success: true,
      profile: {
        id: saved.userId,
        email: saved.email,
        displayName: saved.displayName,
        avatarUrl: saved.avatarUrl,
        authProviders: saved.authProviders ?? [],
        createdAt: saved.createdAt,
        updatedAt: saved.updatedAt,
      },
    };
  }

  @Post('sync')
  @UseGuards(AuthGuard)
  async syncUser(
    @CurrentUser() user: AuthenticatedUser,
    @Body()
    body: {
      email?: string;
      displayName?: string;
      avatarUrl?: string;
    },
  ) {
    return this.register({
      id: user.id,
      email: body?.email,
      displayName: body?.displayName,
      avatarUrl: body?.avatarUrl,
    });
  }
}
