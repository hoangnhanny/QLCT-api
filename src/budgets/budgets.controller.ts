import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { AdminOnly, MembershipGuard } from '../ledgers/membership.guard';
import { BudgetsService } from './budgets.service';
import { Budget } from './budgets.types';
import { ListBudgetsQueryDto } from './dto/list-budgets-query.dto';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';

@Controller('ledgers/:ledgerId/budgets')
@UseGuards(AuthGuard, MembershipGuard)
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Put()
  @AdminOnly()
  upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: UpsertBudgetDto,
  ): Promise<Budget> {
    return this.budgetsService.upsert(ledgerId, user.id, dto);
  }

  @Get()
  list(
    @Param('ledgerId') ledgerId: string,
    @Query() query: ListBudgetsQueryDto,
  ): Promise<Budget[]> {
    return this.budgetsService.list(ledgerId, query.month);
  }

  @Delete(':id')
  @AdminOnly()
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.budgetsService.remove(ledgerId, user.id, id);
  }
}
