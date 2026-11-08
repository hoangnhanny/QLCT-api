import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminOnly, MembershipGuard } from '../ledgers/membership.guard';
import { CreateInviteDto } from './dto/create-invite.dto';
import { InvitesService } from './invites.service';

@Controller()
export class InvitesController {
  constructor(private readonly invitesService: InvitesService) {}

  @Post('ledgers/:ledgerId/invites')
  @UseGuards(AuthGuard, MembershipGuard)
  @AdminOnly()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: CreateInviteDto,
  ) {
    return this.invitesService.create(ledgerId, user.id, dto.ttlDays);
  }

  @Delete('ledgers/:ledgerId/invites/:id')
  @UseGuards(AuthGuard, MembershipGuard)
  @AdminOnly()
  revoke(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('id') id: string,
  ) {
    return this.invitesService.revoke(ledgerId, user.id, id);
  }

  @Get('invites/:token')
  preview(@Param('token') token: string) {
    return this.invitesService.preview(token);
  }

  @Post('invites/:token/accept')
  @UseGuards(AuthGuard)
  accept(
    @CurrentUser() user: AuthenticatedUser,
    @Param('token') token: string,
  ) {
    return this.invitesService.accept(token, user.id);
  }
}
