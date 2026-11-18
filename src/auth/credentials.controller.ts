import {
  Body,
  Controller,
  HttpCode,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { AuthenticatedUser } from './authenticated-user';
import {
  ChangePasswordDto,
  LoginCredentialsDto,
  RegisterCredentialsDto,
} from './credentials.dto';
import { CredentialProfile, CredentialsService } from './credentials.service';
import { CurrentUser } from './current-user.decorator';

@Controller('auth')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Post('credentials/register')
  register(@Body() body: RegisterCredentialsDto): Promise<CredentialProfile> {
    return this.credentials.register(
      body.email,
      body.password,
      body.displayName,
    );
  }

  @Post('credentials/login')
  @HttpCode(200)
  login(@Body() body: LoginCredentialsDto): Promise<CredentialProfile> {
    return this.credentials.login(body.email, body.password);
  }

  @Patch('password')
  @UseGuards(AuthGuard)
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() body: ChangePasswordDto,
  ): Promise<{ success: true }> {
    await this.credentials.changePassword(
      user.id,
      body.currentPassword,
      body.newPassword,
    );
    return { success: true };
  }
}
