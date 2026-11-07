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
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { ListLedgersQueryDto } from './dto/list-ledgers-query.dto';
import { TransferAdminDto } from './dto/transfer-admin.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { LedgersService } from './ledgers.service';
import { AdminOnly, MembershipGuard } from './membership.guard';

@Controller('ledgers')
@UseGuards(AuthGuard)
export class LedgersController {
  constructor(private readonly ledgersService: LedgersService) {}

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateLedgerDto) {
    return this.ledgersService.create(user.id, dto);
  }

  @Get()
  listForUser(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListLedgersQueryDto,
  ) {
    return this.ledgersService.listForUser(user.id, query.month);
  }

  @Get(':ledgerId/members')
  @UseGuards(MembershipGuard)
  listMembers(@Param('ledgerId') ledgerId: string) {
    return this.ledgersService.listMembers(ledgerId);
  }

  @Delete(':ledgerId/members/:userId')
  @UseGuards(MembershipGuard)
  @AdminOnly()
  removeMember(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('userId') userId: string,
  ) {
    return this.ledgersService.removeMember(ledgerId, user.id, userId);
  }

  @Post(':ledgerId/leave')
  @UseGuards(MembershipGuard)
  leave(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
  ) {
    return this.ledgersService.leave(ledgerId, user.id);
  }

  @Post(':ledgerId/transfer-admin')
  @UseGuards(MembershipGuard)
  @AdminOnly()
  transferAdmin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: TransferAdminDto,
  ) {
    return this.ledgersService.transferAdmin(ledgerId, user.id, dto.userId);
  }

  @Get(':ledgerId/categories')
  @UseGuards(MembershipGuard)
  listCategories(@Param('ledgerId') ledgerId: string) {
    return this.ledgersService.listCategories(ledgerId);
  }

  @Post(':ledgerId/categories')
  @UseGuards(MembershipGuard)
  @AdminOnly()
  addCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Body() dto: CreateCategoryDto,
  ) {
    return this.ledgersService.addCategory(ledgerId, user.id, dto);
  }

  @Patch(':ledgerId/categories/:categoryId')
  @UseGuards(MembershipGuard)
  @AdminOnly()
  updateCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('categoryId') categoryId: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.ledgersService.updateCategory(
      ledgerId,
      user.id,
      categoryId,
      dto,
    );
  }

  @Delete(':ledgerId/categories/:categoryId')
  @UseGuards(MembershipGuard)
  @AdminOnly()
  deleteCategory(
    @CurrentUser() user: AuthenticatedUser,
    @Param('ledgerId') ledgerId: string,
    @Param('categoryId') categoryId: string,
  ) {
    return this.ledgersService.deleteCategory(ledgerId, user.id, categoryId);
  }
}
