import { Module } from '@nestjs/common';
import { SupabaseModule } from '../supabase/supabase.module';
import { SavingsController } from './savings.controller';
import { SavingsService } from './savings.service';

@Module({
  imports: [SupabaseModule],
  controllers: [SavingsController],
  providers: [SavingsService],
})
export class SavingsModule {}
