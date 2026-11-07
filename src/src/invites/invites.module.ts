import { Module } from '@nestjs/common';
import { MembershipGuard } from '../ledgers/membership.guard';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  controllers: [InvitesController],
  providers: [InvitesService, MembershipGuard],
})
export class InvitesModule {}
