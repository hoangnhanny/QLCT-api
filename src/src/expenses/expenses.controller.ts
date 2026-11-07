import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { MembershipGuard } from '../ledgers/membership.guard';
import {
  CreateExpenseBatchDto,
  CreateExpenseItemDto,
} from './dto/create-expense-batch.dto';
import { ListExpensesDto } from './dto/list-expenses.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { ExpensesService } from './expenses.service';
import { Expense } from './expenses.types';

@Controller('ledgers/:ledgerId/expenses')
@UseGuards(AuthGuard, MembershipGuard)
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Body()
    body: CreateExpenseBatchDto | CreateExpenseItemDto[] | CreateExpenseItemDto,
  ): Promise<Expense[]> {
    let items: CreateExpenseItemDto[];
    if (Array.isArray(body)) {
      items = body;
    } else if (body && Array.isArray((body as CreateExpenseBatchDto).items)) {
      items = (body as CreateExpenseBatchDto).items;
    } else {
      items = [body as CreateExpenseItemDto];
    }

    return this.expensesService.createBatch(ledgerId, user.id, items);
  }

  @Get()
  list(
    @Param('ledgerId') ledgerId: string,
    @Query() query: ListExpensesDto,
  ): Promise<Expense[]> {
    return this.expensesService.list(ledgerId, query);
  }

  @Get(':id')
  getById(
    @Param('ledgerId') ledgerId: string,
    @Param('id') id: string,
  ): Promise<Expense> {
    return this.expensesService.getById(ledgerId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('id') id: string,
    @Body() dto: UpdateExpenseDto,
  ): Promise<Expense> {
    return this.expensesService.update(ledgerId, user.id, id, dto);
  }

  @Delete(':id')
  remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.expensesService.remove(ledgerId, user.id, id);
  }
}
