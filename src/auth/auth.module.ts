import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  controllers: [AuthController],
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
