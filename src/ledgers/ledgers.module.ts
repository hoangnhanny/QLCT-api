import { Module } from '@nestjs/common';
import { LedgersController } from './ledgers.controller';
import { LedgersService } from './ledgers.service';
import { MembershipGuard } from './membership.guard';

@Module({
  controllers: [LedgersController],
  providers: [LedgersService, MembershipGuard],
})
export class LedgersModule {}
