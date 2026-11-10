import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PushSubscription } from '../database/entities';
import { SupabaseModule } from '../supabase/supabase.module';
import { PushController } from './push.controller';
import { PushService } from './push.service';

@Module({
  imports: [TypeOrmModule.forFeature([PushSubscription]), SupabaseModule],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService, TypeOrmModule],
})
export class PushModule {}
