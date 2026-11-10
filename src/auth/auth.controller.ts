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
  async checkUser(@Query('id') id?: string, @Query('email') email?: string) {
    if (!id && !email) {
      throw new BadRequestException('Provide either id or email');
    }

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
          `select user_id, email, display_name, avatar_url, created_at, updated_at
           from public.profiles
           where ${conditions.join(' or ')}
           limit 1`,
          params,
        );
        const profile = result.rows[0];
        return {
          exists: Boolean(profile),
          profile: profile
            ? {
                id: profile.user_id,
                email: profile.email,
                displayName: profile.display_name,
                avatarUrl: profile.avatar_url,
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

    const profile = await this.profileRepo!.findOne({
      where: whereConditions,
    });

    return {
      exists: Boolean(profile),
      profile: profile
        ? {
            id: profile.userId,
            email: profile.email,
            displayName: profile.displayName,
            avatarUrl: profile.avatarUrl,
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
    },
  ) {
    if (!body?.id) {
      throw new BadRequestException('Missing user id');
    }
    const userId = body.id;
    const email = body.email ?? null;
    const displayName = body.displayName ?? null;
    const avatarUrl = body.avatarUrl ?? null;

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

      // 2. Upsert user into public.profiles
      let profile: any;
      try {
        const result = await this.legacyDb.query(
          `insert into public.profiles (user_id, email, display_name, avatar_url, updated_at)
           values ($1, $2, $3, $4, now())
           on conflict (user_id) do update set
             email = coalesce(excluded.email, public.profiles.email),
             display_name = coalesce(excluded.display_name, public.profiles.display_name),
             avatar_url = coalesce(excluded.avatar_url, public.profiles.avatar_url),
             updated_at = now()
           returning user_id, email, display_name, avatar_url, created_at, updated_at`,
          [userId, email, displayName, avatarUrl],
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

    let existing = await this.profileRepo!.findOne({ where: { userId } });
    if (!existing) {
      existing = this.profileRepo!.create({
        userId,
        email,
        displayName,
        avatarUrl,
      });
    } else {
      if (email !== null) existing.email = email;
      if (displayName !== null) existing.displayName = displayName;
      if (avatarUrl !== null) existing.avatarUrl = avatarUrl;
    }
    const saved = await this.profileRepo!.save(existing);

    return {
      success: true,
      profile: {
        id: saved.userId,
        email: saved.email,
        displayName: saved.displayName,
        avatarUrl: saved.avatarUrl,
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
