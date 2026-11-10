import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Invite, Ledger, Member } from '../database/entities';
import { MembershipGuard } from '../ledgers/membership.guard';
import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';

@Module({
  imports: [TypeOrmModule.forFeature([Invite, Ledger, Member])],
  controllers: [InvitesController],
  providers: [InvitesService, MembershipGuard],
  exports: [InvitesService, TypeOrmModule],
})
export class InvitesModule {}
