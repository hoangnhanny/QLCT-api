import { Module } from '@nestjs/common';
import { BudgetsModule } from '../budgets/budgets.module';
import { SupabaseModule } from '../supabase/supabase.module';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';

@Module({
  imports: [SupabaseModule, BudgetsModule],
  controllers: [ExpensesController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
