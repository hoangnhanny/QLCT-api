import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { monthRange } from '../common/month';
import { PushService } from '../push/push.service';
import { SupabaseService } from '../supabase/supabase.service';
import { formatMonthDate } from './budgets.types';
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

        const params: any[] = [ledgerId, from, to];
        let sql = `SELECT coalesce(sum(amount), 0) as spent
                   FROM public.expenses
                   WHERE ledger_id = $1 AND spent_at >= $2 AND spent_at < $3 AND type = 'expense'`;

        if (budget.member_user_id) {
          params.push(budget.member_user_id);
          sql += ` AND created_by = $${params.length}`;
        }

        if (budget.category_id) {
          params.push(budget.category_id);
          sql += ` AND category_id = $${params.length}`;
        }

        const spentRes = await this.legacyDb.query(sql, params);
        const spent = Number(spentRes.rows[0]?.spent ?? 0);
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
            let recipients: string[];
            if (budget.member_user_id) {
              recipients = [...new Set([budget.member_user_id, adminId])];
            } else {
              recipients = activeMemberIds;
            }

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

      if (budget.memberUserId) {
        qb.andWhere('e.created_by = :userId', { userId: budget.memberUserId });
      }

      if (budget.categoryId) {
        qb.andWhere('e.category_id = :categoryId', {
          categoryId: budget.categoryId,
        });
      }

      const spentRes = await qb.getRawOne();
      const spent = Number(spentRes?.spent ?? 0);
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
          let recipients: string[];
          if (budget.memberUserId) {
            recipients = [...new Set([budget.memberUserId, adminId])];
          } else {
            recipients = activeMemberIds;
          }

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
