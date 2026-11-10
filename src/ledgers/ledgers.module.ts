import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Ledger, Member, Category } from '../database/entities';
import { LedgersController } from './ledgers.controller';
import { LedgersService } from './ledgers.service';
import { MembershipGuard } from './membership.guard';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([Ledger, Member, Category])],
  controllers: [LedgersController],
  providers: [LedgersService, MembershipGuard],
  exports: [LedgersService, MembershipGuard],
})
export class LedgersModule {}
