import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CreateSavingsEntryDto, CreateSavingsGoalDto } from './savings.dto';
import { SavingsService } from './savings.service';

@Controller('savings')
@UseGuards(AuthGuard)
export class SavingsController {
  constructor(private readonly savings: SavingsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.savings.list(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSavingsGoalDto,
  ) {
    return this.savings.create(user.id, dto);
  }

  @Get(':goalId/entries')
  entries(
    @CurrentUser() user: AuthenticatedUser,
    @Param('goalId', ParseUUIDPipe) goalId: string,
  ) {
    return this.savings.entries(user.id, goalId);
  }

  @Post(':goalId/entries')
  addEntry(
    @CurrentUser() user: AuthenticatedUser,
    @Param('goalId', ParseUUIDPipe) goalId: string,
    @Body() dto: CreateSavingsEntryDto,
  ) {
    return this.savings.addEntry(user.id, goalId, dto);
  }
}
