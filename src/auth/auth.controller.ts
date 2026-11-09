import { Controller, Get, UseGuards } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { AuthGuard } from './auth.guard';
import { AuthenticatedUser } from './authenticated-user';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
@UseGuards(AuthGuard)
export class AuthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get('me')
  async getMe(@CurrentUser() user: AuthenticatedUser) {
    const result = await this.supabase.db.query(
      `select user_id, display_name, avatar_url, created_at
       from public.profiles
       where user_id = $1`,
      [user.id],
    );
    const profile = result.rows[0];
    return {
      id: user.id,
      displayName: profile?.display_name ?? null,
      avatarUrl: profile?.avatar_url ?? null,
      createdAt: profile?.created_at ?? null,
    };
  }
}
