import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { monthRange } from '../common/month';
import { PushService } from '../push/push.service';
import { SupabaseService } from '../supabase/supabase.service';
import { BudgetAlertItem, formatMonthDate } from './budgets.types';
import { reachedThresholds } from './threshold';
import { BudgetAlert as BudgetAlertEntity } from '../database/entities/budget-alert.entity';
import { Budget as BudgetEntity } from '../database/entities/budget.entity';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Member as MemberEntity } from '../database/entities/member.entity';
import { Expense as ExpenseEntity } from '../database/entities/expense.entity';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly budgetAlertRepo?: Repository<BudgetAlertEntity>;
  private readonly budgetRepo?: Repository<BudgetEntity>;
  private readonly ledgerRepo?: Repository<LedgerEntity>;
  private readonly memberRepo?: Repository<MemberEntity>;
  private readonly expenseRepo?: Repository<ExpenseEntity>;

  constructor(
    @InjectRepository(BudgetAlertEntity)
    budgetAlertRepoOrSupabase:
      Repository<BudgetAlertEntity> | SupabaseService | any,
    @Optional() private readonly pushService?: PushService,
    @InjectRepository(BudgetEntity)
    @Optional()
    budgetRepo?: Repository<BudgetEntity>,
    @InjectRepository(LedgerEntity)
    @Optional()
    ledgerRepo?: Repository<LedgerEntity>,
    @InjectRepository(MemberEntity)
    @Optional()
    memberRepo?: Repository<MemberEntity>,
    @InjectRepository(ExpenseEntity)
    @Optional()
    expenseRepo?: Repository<ExpenseEntity>,
  ) {
    if (budgetAlertRepoOrSupabase?.db) {
      this.legacyDb = budgetAlertRepoOrSupabase.db;
    } else {
      this.budgetAlertRepo =
        budgetAlertRepoOrSupabase as Repository<BudgetAlertEntity>;
      this.budgetRepo = budgetRepo;
      this.ledgerRepo = ledgerRepo;
      this.memberRepo = memberRepo;
      this.expenseRepo = expenseRepo;
    }
  }

  private async computeSpentLegacy(
    ledgerId: string,
    from: Date,
    to: Date,
    memberUserId: string | null,
    categoryId: string | null,
  ): Promise<number> {
    const params: any[] = [ledgerId, from, to];
    let sql = `SELECT coalesce(sum(amount), 0) as spent
               FROM public.expenses
               WHERE ledger_id = $1 AND spent_at >= $2 AND spent_at < $3 AND type = 'expense'`;

    if (memberUserId) {
      params.push(memberUserId);
      sql += ` AND created_by = $${params.length}`;
    }

    if (categoryId) {
      params.push(categoryId);
      sql += ` AND (category_id = $${params.length} OR category_id IN (SELECT id FROM public.categories WHERE parent_id = $${params.length}))`;
    }

    const spentRes = await this.legacyDb!.query(sql, params);
    return Number(spentRes.rows[0]?.spent ?? 0);
  }

  private async computeSpentOrm(
    ledgerId: string,
    from: Date,
    to: Date,
    memberUserId: string | null,
    categoryId: string | null,
  ): Promise<number> {
    const qb = this.expenseRepo!.createQueryBuilder('e')
      .select('coalesce(sum(e.amount), 0)', 'spent')
      .where(
        'e.ledger_id = :ledgerId AND e.spent_at >= :from AND e.spent_at < :to AND e.type = :type',
        {
          ledgerId,
          from,
          to,
          type: 'expense',
        },
      );

    if (memberUserId) {
      qb.andWhere('e.created_by = :userId', { userId: memberUserId });
    }

    if (categoryId) {
      qb.andWhere(
        '(e.category_id = :categoryId OR e.category_id IN (SELECT id FROM public.categories WHERE parent_id = :categoryId))',
        { categoryId },
      );
    }

    const spentRes = await qb.getRawOne();
    return Number(spentRes?.spent ?? 0);
  }

  /**
   * Lists budget threshold alerts visible to `userId` across active ledgers.
   * Member-scoped budgets are only returned to that member and the ledger admin.
   */
  async listForUser(
    userId: string,
    options?: { ledgerId?: string; month?: string },
  ): Promise<BudgetAlertItem[]> {
    const normalizedMonth = options?.month
      ? formatMonthDate(options.month)
      : undefined;

    let rows: Array<{
      id: string;
      budgetId: string;
      ledgerId: string;
      ledgerName: string;
      ledgerKind: 'family' | 'business';
      threshold: 80 | 100;
      month: string;
      limit: number;
      memberUserId: string | null;
      categoryId: string | null;
      categoryName: string | null;
      memberDisplayName: string | null;
      createdAt: Date;
    }> = [];

    if (this.legacyDb) {
      const params: any[] = [userId];
      const conditions: string[] = [];
      if (options?.ledgerId) {
        params.push(options.ledgerId);
        conditions.push(`b.ledger_id = $${params.length}`);
      }
      if (normalizedMonth) {
        params.push(normalizedMonth);
        conditions.push(`ba.month = $${params.length}`);
      }
      const whereClause =
        conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const res = await this.legacyDb.query(
        `SELECT
          ba.id,
          ba.budget_id,
          ba.threshold,
          ba.month,
          ba.created_at,
          b.ledger_id,
          b.member_user_id,
          b.category_id,
          b.amount,
          l.name as ledger_name,
          l.kind as ledger_kind,
          c.name as category_name,
          p.display_name as member_display_name
        FROM public.budget_alerts ba
        INNER JOIN public.budgets b ON ba.budget_id = b.id
        INNER JOIN public.ledgers l ON b.ledger_id = l.id
        INNER JOIN public.members m ON m.ledger_id = l.id AND m.user_id = $1 AND m.status = 'active'
        LEFT JOIN public.categories c ON b.category_id = c.id
        LEFT JOIN public.profiles p ON b.member_user_id = p.user_id
        ${whereClause}
        ORDER BY ba.created_at DESC
        LIMIT 50`,
        params,
      );

      rows = res.rows.map((r: any) => ({
        id: r.id,
        budgetId: r.budget_id,
        ledgerId: r.ledger_id,
        ledgerName: r.ledger_name,
        ledgerKind: r.ledger_kind,
        threshold: Number(r.threshold) >= 100 ? 100 : 80,
        month: formatMonthDate(r.month),
        limit: Number(r.amount),
        memberUserId: r.member_user_id ?? null,
        categoryId: r.category_id ?? null,
        categoryName: r.category_name ?? null,
        memberDisplayName: r.member_display_name ?? null,
        createdAt:
          r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
      }));
    } else {
      const qb = this.budgetAlertRepo!.createQueryBuilder('ba')
        .innerJoinAndSelect('ba.budget', 'b')
        .innerJoinAndSelect('b.ledger', 'l')
        .innerJoin(
          MemberEntity,
          'm',
          "m.ledger_id = l.id AND m.user_id = :userId AND m.status = 'active'",
          { userId },
        )
        .leftJoinAndSelect('b.category', 'c')
        .leftJoinAndSelect('b.memberProfile', 'p');

      if (options?.ledgerId) {
        qb.andWhere('b.ledger_id = :ledgerId', { ledgerId: options.ledgerId });
      }
      if (normalizedMonth) {
        qb.andWhere('ba.month = :month', { month: normalizedMonth });
      }

      const entities = await qb
        .orderBy('ba.created_at', 'DESC')
        .take(50)
        .getMany();

      rows = entities.map((ba) => ({
        id: ba.id,
        budgetId: ba.budgetId,
        ledgerId: ba.budget.ledgerId,
        ledgerName: ba.budget.ledger.name,
        ledgerKind: ba.budget.ledger.kind,
        threshold: ba.threshold >= 100 ? 100 : 80,
        month: formatMonthDate(ba.month),
        limit: Number(ba.budget.amount),
        memberUserId: ba.budget.memberUserId ?? null,
        categoryId: ba.budget.categoryId ?? null,
        categoryName: ba.budget.category?.name ?? null,
        memberDisplayName: ba.budget.memberProfile?.displayName ?? null,
        createdAt:
          ba.createdAt instanceof Date ? ba.createdAt : new Date(ba.createdAt),
      }));
    }

    const spentCache = new Map<string, number>();
    const results: BudgetAlertItem[] = [];

    for (const row of rows) {
      const cacheKey = `${row.budgetId}:${row.month}`;
      let spent = spentCache.get(cacheKey);
      if (spent === undefined) {
        const { from, to } = monthRange(row.month);
        spent = this.legacyDb
          ? await this.computeSpentLegacy(
              row.ledgerId,
              from,
              to,
              row.memberUserId,
              row.categoryId,
            )
          : await this.computeSpentOrm(
              row.ledgerId,
              from,
              to,
              row.memberUserId,
              row.categoryId,
            );
        spentCache.set(cacheKey, spent);
      }

      const percent = row.limit > 0 ? Math.round((spent / row.limit) * 100) : 0;

      results.push({
        id: row.id,
        budgetId: row.budgetId,
        ledgerId: row.ledgerId,
        ledgerName: row.ledgerName,
        ledgerKind: row.ledgerKind,
        threshold: row.threshold,
        month: row.month,
        limit: row.limit,
        spent,
        percent,
        scope: row.memberUserId ? 'member' : 'ledger',
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        memberUserId: row.memberUserId,
        memberDisplayName: row.memberDisplayName,
        createdAt: row.createdAt,
      });
    }

    return results;
  }

  /**
   * Evaluates all applicable budgets for the ledger and month.
   * If a budget has reached 80% or 100%, an alert is inserted into `budget_alerts`.
   * Newly inserted alerts trigger a push notification via `PushService`.
   */
  async evaluate(
    ledgerId: string,
    monthKeyStr: string,
    affectedUserIds: string[] = [],
  ): Promise<void> {
    const month = formatMonthDate(monthKeyStr);
    const { from, to } = monthRange(month);

    if (this.legacyDb) {
      // 1. Fetch ledger admin
      const ledgerRes = await this.legacyDb.query(
        `SELECT admin_id FROM public.ledgers WHERE id = $1`,
        [ledgerId],
      );
      if (!ledgerRes.rows[0]) {
        return;
      }
      const adminId = ledgerRes.rows[0].admin_id;

      // 2. Fetch all active members in ledger
      const membersRes = await this.legacyDb.query(
        `SELECT user_id FROM public.members WHERE ledger_id = $1 AND status = 'active'`,
        [ledgerId],
      );
      const activeMemberIds = membersRes.rows.map((r: any) => r.user_id);

      // 3. Fetch budgets for this ledger and month
      const budgetsRes = await this.legacyDb.query(
        `SELECT
          b.id,
          b.ledger_id,
          b.member_user_id,
          b.category_id,
          b.month,
          b.amount,
          c.name as category_name,
          p.display_name as member_display_name
        FROM public.budgets b
        LEFT JOIN public.categories c ON b.category_id = c.id
        LEFT JOIN public.profiles p ON b.member_user_id = p.user_id
        WHERE b.ledger_id = $1 AND b.month = $2`,
        [ledgerId, month],
      );

      const budgets = budgetsRes.rows;
      if (budgets.length === 0) {
        return;
      }

      // 4. Evaluate each budget
      for (const budget of budgets) {
        if (
          budget.member_user_id &&
          affectedUserIds.length > 0 &&
          !affectedUserIds.includes(budget.member_user_id)
        ) {
          continue;
        }

        const spent = await this.computeSpentLegacy(
          ledgerId,
          from,
          to,
          budget.member_user_id ?? null,
          budget.category_id ?? null,
        );
        const limit = Number(budget.amount);

        const thresholds = reachedThresholds(spent, limit);
        if (thresholds.length === 0) {
          continue;
        }

        for (const threshold of thresholds) {
          const insertRes = await this.legacyDb.query(
            `INSERT INTO public.budget_alerts (budget_id, threshold, month)
             VALUES ($1, $2, $3)
             ON CONFLICT (budget_id, threshold, month) DO NOTHING
             RETURNING id`,
            [budget.id, threshold, month],
          );

          if (insertRes.rows.length > 0 && this.pushService) {
            const recipients = [
              ...new Set([...activeMemberIds, adminId].filter(Boolean)),
            ];

            const targetName = budget.category_name
              ? `danh mục "${budget.category_name}"`
              : 'tổng chi tiêu';
            const memberPrefix = budget.member_display_name
              ? `[${budget.member_display_name}] `
              : '';

            const title = `Cảnh báo hạn mức ${threshold}%`;
            const body =
              threshold >= 100
                ? `${memberPrefix}Đã vượt 100% hạn mức cho ${targetName}!`
                : `${memberPrefix}Đã chi tiêu đạt 80% hạn mức cho ${targetName}.`;

            await this.pushService
              .send(recipients, {
                title,
                body,
                url: `/${ledgerId}`,
              })
              .catch((err) => {
                this.logger.error('Failed to send push notification', err);
              });
          }
        }
      }
      return;
    }

    // TypeORM implementation
    const ledger = await this.ledgerRepo!.findOne({
      where: { id: ledgerId },
      select: { adminId: true },
    });
    if (!ledger) return;
    const adminId = ledger.adminId;

    const members = await this.memberRepo!.find({
      where: { ledgerId, status: 'active' },
      select: { userId: true },
    });
    const activeMemberIds = members.map((m) => m.userId);

    const budgets = await this.budgetRepo!.createQueryBuilder('b')
      .leftJoinAndSelect('b.category', 'c')
      .leftJoinAndSelect('b.memberProfile', 'p')
      .where('b.ledger_id = :ledgerId AND b.month = :month', {
        ledgerId,
        month,
      })
      .getMany();

    if (budgets.length === 0) return;

    for (const budget of budgets) {
      if (
        budget.memberUserId &&
        affectedUserIds.length > 0 &&
        !affectedUserIds.includes(budget.memberUserId)
      ) {
        continue;
      }

      const spent = await this.computeSpentOrm(
        ledgerId,
        from,
        to,
        budget.memberUserId ?? null,
        budget.categoryId ?? null,
      );
      const limit = Number(budget.amount);

      const thresholds = reachedThresholds(spent, limit);
      if (thresholds.length === 0) continue;

      for (const threshold of thresholds) {
        const insertRes = await this.budgetAlertRepo!.createQueryBuilder()
          .insert()
          .into(BudgetAlertEntity)
          .values({
            budgetId: budget.id,
            threshold,
            month,
          })
          .orIgnore()
          .returning('id')
          .execute();

        if (insertRes.raw?.length > 0 && this.pushService) {
          const recipients = [
            ...new Set([...activeMemberIds, adminId].filter(Boolean)),
          ];

          const targetName = budget.category?.name
            ? `danh mục "${budget.category.name}"`
            : 'tổng chi tiêu';
          const memberPrefix = budget.memberProfile?.displayName
            ? `[${budget.memberProfile.displayName}] `
            : '';

          const title = `Cảnh báo hạn mức ${threshold}%`;
          const body =
            threshold >= 100
              ? `${memberPrefix}Đã vượt 100% hạn mức cho ${targetName}!`
              : `${memberPrefix}Đã chi tiêu đạt 80% hạn mức cho ${targetName}.`;

          await this.pushService
            .send(recipients, {
              title,
              body,
              url: `/${ledgerId}`,
            })
            .catch((err) => {
              this.logger.error('Failed to send push notification', err);
            });
        }
      }
    }
  }
}
