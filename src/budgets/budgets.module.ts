import { Module } from '@nestjs/common';
import { PushModule } from '../push/push.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { AlertsService } from './alerts.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsService } from './budgets.service';

@Module({
  imports: [SupabaseModule, PushModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, AlertsService],
  exports: [BudgetsService, AlertsService],
})
export class BudgetsModule {}
