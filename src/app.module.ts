import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthModule } from './auth/auth.module';
import { BudgetsModule } from './budgets/budgets.module';
import { DatabaseModule } from './database/database.module';
import { ExpensesModule } from './expenses/expenses.module';
import { HealthController } from './health/health.controller';
import { InvitesModule } from './invites/invites.module';
import { LedgersModule } from './ledgers/ledgers.module';
import { PushModule } from './push/push.module';
import { ReportsModule } from './reports/reports.module';
import { SavingsModule } from './savings/savings.module';
import { SupabaseModule } from './supabase/supabase.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    SupabaseModule,
    LedgersModule,
    InvitesModule,
    ExpensesModule,
    BudgetsModule,
    PushModule,
    ReportsModule,
    AttachmentsModule,
    SavingsModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
