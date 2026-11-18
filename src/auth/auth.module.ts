import { Global, Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';

@Global()
@Module({
  controllers: [AuthController, CredentialsController],
  providers: [AuthGuard, CredentialsService],
  exports: [AuthGuard],
})
export class AuthModule {}
