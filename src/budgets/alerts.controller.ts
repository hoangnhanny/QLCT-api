import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AuthenticatedUser } from '../auth/authenticated-user';
import { CurrentUser } from '../auth/current-user.decorator';
import { AlertsService } from './alerts.service';
import { BudgetAlertItem } from './budgets.types';
import { ListAlertsQueryDto } from './dto/list-alerts-query.dto';

@Controller('alerts')
@UseGuards(AuthGuard)
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListAlertsQueryDto,
  ): Promise<BudgetAlertItem[]> {
    return this.alertsService.listForUser(user.id, {
      ledgerId: query.ledgerId,
      month: query.month,
    });
  }
}
