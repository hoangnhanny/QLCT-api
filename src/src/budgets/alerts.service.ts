import { Injectable, Logger } from '@nestjs/common';
import { monthRange } from '../common/month';
import { PushService } from '../push/push.service';
import { SupabaseService } from '../supabase/supabase.service';
import { formatMonthDate } from './budgets.types';
import { reachedThresholds } from './threshold';

interface BudgetWithDetails {
  id: string;
  ledger_id: string;
  member_user_id: string | null;
  category_id: string | null;
  month: Date | string;
  amount: string | number | bigint;
  category_name?: string | null;
  member_display_name?: string | null;
}

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly pushService: PushService,
  ) {}

  private get db() {
    return this.supabase.db;
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

    // 1. Fetch ledger admin
    const ledgerRes = await this.db.query<{ admin_id: string }>(
      `SELECT admin_id FROM public.ledgers WHERE id = $1`,
      [ledgerId],
    );
    if (!ledgerRes.rows[0]) {
      return;
    }
    const adminId = ledgerRes.rows[0].admin_id;

    // 2. Fetch all active members in ledger
    const membersRes = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM public.members WHERE ledger_id = $1 AND status = 'active'`,
      [ledgerId],
    );
    const activeMemberIds = membersRes.rows.map((r) => r.user_id);

    // 3. Fetch budgets for this ledger and month
    const budgetsRes = await this.db.query<BudgetWithDetails>(
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
      // If it's a member-level budget and affectedUserIds is provided,
      // skip if this member was not affected
      if (
        budget.member_user_id &&
        affectedUserIds.length > 0 &&
        !affectedUserIds.includes(budget.member_user_id)
      ) {
        continue;
      }

      // Calculate total spent for this budget in the given month interval
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

      const spentRes = await this.db.query<{ spent: string | number }>(
        sql,
        params,
      );
      const spent = Number(spentRes.rows[0]?.spent ?? 0);
      const limit = Number(budget.amount);

      const thresholds = reachedThresholds(spent, limit);
      if (thresholds.length === 0) {
        continue;
      }

      // For each reached threshold, record in budget_alerts ON CONFLICT DO NOTHING
      for (const threshold of thresholds) {
        const insertRes = await this.db.query<{ id: string }>(
          `INSERT INTO public.budget_alerts (budget_id, threshold, month)
           VALUES ($1, $2, $3)
           ON CONFLICT (budget_id, threshold, month) DO NOTHING
           RETURNING id`,
          [budget.id, threshold, month],
        );

        // If newly inserted, send push notification
        if (insertRes.rows.length > 0) {
          let recipients: string[];
          if (budget.member_user_id) {
            // Member-level budget: notify member + admin
            recipients = [...new Set([budget.member_user_id, adminId])];
          } else {
            // Ledger-level budget: notify all active members
            recipients = activeMemberIds;
          }

          // Build message text
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
  }
}
