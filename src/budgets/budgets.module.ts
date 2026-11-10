import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Budget,
  BudgetAlert,
  Ledger,
  Category,
  Member,
  Expense,
} from '../database/entities';
import { PushModule } from '../push/push.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AlertsService } from './alerts.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Budget,
      BudgetAlert,
      Ledger,
      Category,
      Member,
      Expense,
    ]),
    SupabaseModule,
    PushModule,
  ],
  controllers: [BudgetsController],
  providers: [BudgetsService, AlertsService],
  exports: [BudgetsService, AlertsService, TypeOrmModule],
})
export class BudgetsModule {}
