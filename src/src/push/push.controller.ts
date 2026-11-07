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
    return { publicKey: this.pushService.getPublicKey() };
  }

  @Post('subscriptions')
  @UseGuards(AuthGuard)
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SubscribeDto,
  ) {
    await this.pushService.subscribe(user.id, dto);
    return { ok: true };
  }

  @Delete('subscriptions')
  @UseGuards(AuthGuard)
  async unsubscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body?: UnsubscribeDto,
    @Query('endpoint') queryEndpoint?: string,
  ) {
    const endpoint = body?.endpoint ?? queryEndpoint;
    if (endpoint) {
      await this.pushService.unsubscribe(user.id, endpoint);
    }
    return { ok: true };
  }
}
