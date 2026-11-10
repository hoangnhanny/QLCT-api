import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SavingsGoal, SavingsEntry } from '../database/entities';
import { SupabaseModule } from '../supabase/supabase.module';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SavingsGoal, SavingsEntry]),
    SupabaseModule,
  ],
  controllers: [SavingsController],
  providers: [SavingsService],
  exports: [SavingsService, TypeOrmModule],
})
export class SavingsModule {}
