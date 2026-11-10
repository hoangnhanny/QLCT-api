import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { formatMonthDate } from '../budgets/budgets.types';
import { monthRange } from '../common/month';
import { SupabaseService } from '../supabase/supabase.service';
import {
  BudgetStatus,
  MonthlyReport,
  MonthlyReportFilter,
  RangeBucketSummary,
} from './reports.types';

@Injectable()
export class ReportsService {
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly dataSource?: DataSource;

  constructor(
    @InjectDataSource()
    dataSourceOrSupabase: DataSource | SupabaseService | any,
  ) {
    if (dataSourceOrSupabase?.db) {
      this.legacyDb = dataSourceOrSupabase.db;
    } else {
      this.dataSource = dataSourceOrSupabase as DataSource;
    }
  }

  private async executeQuery<T = any>(
    sql: string,
    params: any[] = [],
  ): Promise<{ rows: T[] }> {
    if (this.legacyDb) {
      return this.legacyDb.query(sql, params);
    }
    const rows = await this.dataSource!.query(sql, params);
    return { rows };
  }

  async monthly(
    ledgerId: string,
    monthStr: string,
    filter?: MonthlyReportFilter,
  ): Promise<MonthlyReport> {
    const month = formatMonthDate(monthStr);
    const { from, to } = monthRange(month);

    const baseConditions = [
      'e.ledger_id = $1',
      "e.type = 'expense'",
      'e.spent_at >= $2',
      'e.spent_at < $3',
    ];
    const baseParams: any[] = [ledgerId, from, to];

    // Filter conditions for total, byCategory, byMember, byDay
    const filterConditions = [...baseConditions];
    const filterParams = [...baseParams];

    if (filter?.categoryId) {
      filterParams.push(filter.categoryId);
      filterConditions.push(`e.category_id = $${filterParams.length}`);
    }

    if (filter?.userId) {
      filterParams.push(filter.userId);
      filterConditions.push(`e.created_by = $${filterParams.length}`);
    }

    // 1. Total spent
    const totalRes = await this.executeQuery<{ total: string | number }>(
      `SELECT coalesce(sum(e.amount), 0) as total
       FROM public.expenses e
       WHERE ${filterConditions.join(' AND ')}`,
      filterParams,
    );
    const total = Number(totalRes.rows[0]?.total ?? 0);

    const incomeRes = await this.executeQuery<{ income: string | number }>(
      `SELECT coalesce(sum(e.amount), 0) as income FROM public.expenses e
       WHERE ${filterConditions.map((condition) => (condition === "e.type = 'expense'" ? "e.type = 'income'" : condition)).join(' AND ')}`,
      filterParams,
    );
    const income = Number(incomeRes.rows[0]?.income ?? 0);

    // 2. byCategory
    const catConditions = [...baseConditions];
    const catParams = [...baseParams];
    if (filter?.userId) {
      catParams.push(filter.userId);
      catConditions.push(`e.created_by = $${catParams.length}`);
    }
    if (filter?.categoryId) {
      catParams.push(filter.categoryId);
      catConditions.push(`e.category_id = $${catParams.length}`);
    }

    const byCatRes = await this.executeQuery<{
      category_id: string | null;
      category_name: string | null;
      total: string | number;
    }>(
      `SELECT
        e.category_id,
        c.name as category_name,
        coalesce(sum(e.amount), 0) as total
       FROM public.expenses e
       LEFT JOIN public.categories c ON e.category_id = c.id
       WHERE ${catConditions.join(' AND ')}
       GROUP BY e.category_id, c.name
       ORDER BY total DESC`,
      catParams,
    );

    const byCategory = byCatRes.rows.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      total: Number(r.total),
    }));

    // 3. byMember (counts removed members under their profile display_name)
    const memConditions = [...baseConditions];
    const memParams = [...baseParams];
    if (filter?.categoryId) {
      memParams.push(filter.categoryId);
      memConditions.push(`e.category_id = $${memParams.length}`);
    }
    if (filter?.userId) {
      memParams.push(filter.userId);
      memConditions.push(`e.created_by = $${memParams.length}`);
    }

    const byMemRes = await this.executeQuery<{
      user_id: string;
      display_name: string | null;
      total: string | number;
    }>(
      `SELECT
        e.created_by as user_id,
        coalesce(p.display_name, 'Unknown') as display_name,
        coalesce(sum(e.amount), 0) as total
       FROM public.expenses e
       LEFT JOIN public.profiles p ON e.created_by = p.user_id
       WHERE ${memConditions.join(' AND ')}
       GROUP BY e.created_by, p.display_name
       ORDER BY total DESC`,
      memParams,
    );

    const byMember = byMemRes.rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name ?? 'Unknown',
      total: Number(r.total),
    }));

    // 4. byDay (Asia/Ho_Chi_Minh)
    const byDayRes = await this.executeQuery<{
      date: string;
      total: string | number;
    }>(
      `SELECT
        to_char(e.spent_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD') as date,
        coalesce(sum(e.amount), 0) as total
       FROM public.expenses e
       WHERE ${filterConditions.join(' AND ')}
       GROUP BY to_char(e.spent_at AT TIME ZONE 'Asia/Ho_Chi_Minh', 'YYYY-MM-DD')
       ORDER BY date ASC`,
      filterParams,
    );

    const byDay = byDayRes.rows.map((r) => ({
      date: r.date,
      total: Number(r.total),
    }));

    // 5. budgets status
    const budgetsRes = await this.executeQuery<{
      id: string;
      member_user_id: string | null;
      category_id: string | null;
      amount: string | number | bigint;
    }>(
      `SELECT id, member_user_id, category_id, amount
       FROM public.budgets
       WHERE ledger_id = $1 AND month = $2`,
      [ledgerId, month],
    );

    const budgets: BudgetStatus[] = [];
    for (const b of budgetsRes.rows) {
      const bParams: any[] = [ledgerId, from, to];
      let bSql = `SELECT coalesce(sum(amount), 0) as spent
                  FROM public.expenses
                  WHERE ledger_id = $1 AND spent_at >= $2 AND spent_at < $3 AND type = 'expense'`;

      if (b.member_user_id) {
        bParams.push(b.member_user_id);
        bSql += ` AND created_by = $${bParams.length}`;
      }

      if (b.category_id) {
        bParams.push(b.category_id);
        bSql += ` AND category_id = $${bParams.length}`;
      }

      const spentRes = await this.executeQuery<{ spent: string | number }>(
        bSql,
        bParams,
      );
      const spent = Number(spentRes.rows[0]?.spent ?? 0);
      const limit = Number(b.amount);
      const percent = limit > 0 ? Math.round((spent / limit) * 100) : 0;

      budgets.push({
        budgetId: b.id,
        scope: b.member_user_id ? 'member' : 'ledger',
        memberUserId: b.member_user_id ?? undefined,
        categoryId: b.category_id ?? undefined,
        limit,
        spent,
        percent,
      });
    }

    return {
      total,
      income,
      byCategory,
      byMember,
      byDay,
      budgets,
    };
  }

  async range(
    ledgerId: string,
    fromStr: string,
    toStr: string,
    groupBy: 'day' | 'week' | 'month',
  ): Promise<RangeBucketSummary[]> {
    const from = new Date(fromStr);
    const to = new Date(toStr);

    const validUnits = ['day', 'week', 'month'];
    const unit = validUnits.includes(groupBy) ? groupBy : 'day';

    const res = await this.executeQuery<{
      bucket: string;
      total: string | number;
    }>(
      `SELECT
        to_char(date_trunc('${unit}', e.spent_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') as bucket,
        coalesce(sum(e.amount), 0) as total
       FROM public.expenses e
      WHERE e.ledger_id = $1 AND e.spent_at >= $2 AND e.spent_at <= $3 AND e.type = 'expense'
       GROUP BY date_trunc('${unit}', e.spent_at AT TIME ZONE 'Asia/Ho_Chi_Minh')
       ORDER BY bucket ASC`,
      [ledgerId, from, to],
    );

    return res.rows.map((r) => ({
      bucket: r.bucket,
      total: Number(r.total),
    }));
  }
}
