import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthGuard } from './auth.guard';
import { AuthenticatedUser } from './authenticated-user';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class AuthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('me')
  @UseGuards(AuthGuard)
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.supabase.db.query(
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

  @Get('check-user')
  async checkUser(@Query('id') id?: string, @Query('email') email?: string) {
    if (!id && !email) {
      throw new BadRequestException('Provide either id or email');
    }
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
      const result = await this.supabase.db.query(
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
          const result = await this.supabase.db.query(
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

    // 1. Maintain optional auth.users record if table exists
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
      // In case auth.users table is not accessible
    }

    // 2. Upsert user into public.profiles
    let profile;
    try {
      const result = await this.supabase.db.query(
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
        const fallbackResult = await this.supabase.db.query(
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
