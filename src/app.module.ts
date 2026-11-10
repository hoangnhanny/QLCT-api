import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AttachmentsModule } from './attachments/attachments.module';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { BudgetsModule } from './budgets/budgets.module';
import { DatabaseModule } from './database/database.module';
import { Profile } from './database/entities';
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
    TypeOrmModule.forFeature([Profile]),
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
  controllers: [AppController, HealthController, AuthController],
  providers: [AppService, AuthGuard],
})
export class AppModule {}
