import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { SubscribeDto, UnsubscribeDto } from './dto/subscribe.dto';
import { PushService } from './push.service';

@Controller('push')
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get('public-key')
  getPublicKey() {
    return {
      publicKey: this.pushService.getPublicKey(),
      provider: this.pushService.isFirebaseEnabled() ? 'firebase' : 'vapid',
    };
  }

  @Post('subscriptions')
  @UseGuards(AuthGuard)
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeDto,
  ) {
    await this.pushService.subscribe(user.id, dto as any);
    return { ok: true };
  }

  @Delete('subscriptions')
  @UseGuards(AuthGuard)
  async unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body?: UnsubscribeDto,
    @Query('endpoint') queryEndpoint?: string,
    @Query('token') queryToken?: string,
  ) {
    const target = body?.token ?? body?.endpoint ?? queryToken ?? queryEndpoint;
    if (target) {
      await this.pushService.unsubscribe(user.id, target);
    }
    return { ok: true };
  }
}
