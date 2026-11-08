import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { MembershipGuard } from '../ledgers/membership.guard';
import { AttachmentsService } from './attachments.service';
import { CreateUploadUrlDto } from './dto/create-upload-url.dto';

@Controller('ledgers/:ledgerId')
@UseGuards(AuthGuard, MembershipGuard)
export class AttachmentsController {
  constructor(private readonly attachmentsService: AttachmentsService) {}

  @Post('attachments/upload-url')
  createUploadUrl(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: CreateUploadUrlDto,
  ) {
    return this.attachmentsService.createUploadUrl(
      ledgerId,
      user.id,
      dto.contentType,
    );
  }

  @Get('expenses/:id/image')
  createViewUrl(
    @Param('ledgerId') ledgerId: string,
    @Param('id') id: string,
  ) {
    return this.attachmentsService.createViewUrl(ledgerId, id);
  }
}
