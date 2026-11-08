import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { MembershipGuard } from '../ledgers/membership.guard';
import {
  MonthlyReportQueryDto,
  RangeReportQueryDto,
} from './dto/monthly-report-query.dto';
import { ReportsService } from './reports.service';

@Controller('ledgers/:ledgerId/reports')
@UseGuards(AuthGuard, MembershipGuard)
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('monthly')
  getMonthly(
    @Param('ledgerId') ledgerId: string,
    @Query() query: MonthlyReportQueryDto,
  ) {
    return this.reportsService.monthly(ledgerId, query.month, {
      categoryId: query.categoryId,
      userId: query.userId,
    });
  }

  @Get('range')
  getRange(
    @Param('ledgerId') ledgerId: string,
    @Query() query: RangeReportQueryDto,
  ) {
    return this.reportsService.range(
      ledgerId,
      query.from,
      query.to,
      query.groupBy,
    );
  }
}
