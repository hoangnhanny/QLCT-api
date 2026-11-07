import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { Budget, BudgetRow, formatMonthDate, mapBudget } from './budgets.types';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';

@Injectable()
export class BudgetsService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.db;
  }

  /**
   * Helper to verify that the actor is admin of the ledger.
   */
  private async assertAdmin(ledgerId: string, actorId: string): Promise<void> {
    const res = await this.db.query<{ admin_id: string }>(
      `SELECT admin_id FROM public.ledgers WHERE id = $1`,
      [ledgerId],
    );
    if (!res.rows[0]) {
      throw new NotFoundException('Ledger not found');
    }
    if (res.rows[0].admin_id !== actorId) {
      throw new ForbiddenException('Only the ledger admin can do this');
    }
  }

  /**
   * Upserts a budget (ledger total, ledger category, member total, or member category).
   * Only the ledger admin may upsert budgets.
   */
  async upsert(
    ledgerId: string,
    adminId: string,
    dto: UpsertBudgetDto,
  ): Promise<Budget> {
    await this.assertAdmin(ledgerId, adminId);

    if (dto.amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }

    const month = formatMonthDate(dto.month);

    // If categoryId is provided, verify it belongs to this ledger
    if (dto.categoryId) {
      const catRes = await this.db.query(
        `SELECT id FROM public.categories WHERE id = $1 AND ledger_id = $2`,
        [dto.categoryId, ledgerId],
      );
      if (!catRes.rows[0]) {
        throw new BadRequestException(
          'Category does not belong to this ledger',
        );
      }
    }

    // If memberUserId is provided, verify they are an active member
    if (dto.memberUserId) {
      const memRes = await this.db.query(
        `SELECT id FROM public.members WHERE user_id = $1 AND ledger_id = $2 AND status = 'active'`,
        [dto.memberUserId, ledgerId],
      );
      if (!memRes.rows[0]) {
        throw new BadRequestException(
          'Member not found or not active in this ledger',
        );
      }
    }

    const upsertRes = await this.db.query<BudgetRow>(
      `INSERT INTO public.budgets (ledger_id, member_user_id, category_id, month, amount)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (ledger_id, member_user_id, category_id, month)
       DO UPDATE SET amount = EXCLUDED.amount
       RETURNING *`,
      [
        ledgerId,
        dto.memberUserId ?? null,
        dto.categoryId ?? null,
        month,
        dto.amount,
      ],
    );

    const budgetId = upsertRes.rows[0].id;
    return this.getById(ledgerId, budgetId);
  }

  /**
   * Lists all budgets for a ledger in a given month.
   */
  async list(ledgerId: string, monthStr: string): Promise<Budget[]> {
    const month = formatMonthDate(monthStr);

    const res = await this.db.query<BudgetRow>(
      `SELECT
        b.id,
        b.ledger_id,
        b.member_user_id,
        b.category_id,
        b.month,
        b.amount,
        b.created_at,
        c.name as category_name,
        c.icon as category_icon,
        p.display_name as member_display_name,
        p.avatar_url as member_avatar_url
      FROM public.budgets b
      LEFT JOIN public.categories c ON b.category_id = c.id
      LEFT JOIN public.profiles p ON b.member_user_id = p.user_id
      WHERE b.ledger_id = $1 AND b.month = $2
      ORDER BY b.member_user_id NULLS FIRST, b.category_id NULLS FIRST, b.created_at ASC`,
      [ledgerId, month],
    );

    return res.rows.map(mapBudget);
  }

  /**
   * Removes a budget by id (admin only).
   */
  async remove(
    ledgerId: string,
    adminId: string,
    budgetId: string,
  ): Promise<void> {
    await this.assertAdmin(ledgerId, adminId);

    const res = await this.db.query(
      `DELETE FROM public.budgets WHERE id = $1 AND ledger_id = $2`,
      [budgetId, ledgerId],
    );

    if (res.rowCount === 0) {
      throw new NotFoundException('Budget not found');
    }
  }

  /**
   * Internal helper to fetch a single budget with joins.
   */
  private async getById(ledgerId: string, budgetId: string): Promise<Budget> {
    const res = await this.db.query<BudgetRow>(
      `SELECT
        b.id,
        b.ledger_id,
        b.member_user_id,
        b.category_id,
        b.month,
        b.amount,
        b.created_at,
        c.name as category_name,
        c.icon as category_icon,
        p.display_name as member_display_name,
        p.avatar_url as member_avatar_url
      FROM public.budgets b
      LEFT JOIN public.categories c ON b.category_id = c.id
      LEFT JOIN public.profiles p ON b.member_user_id = p.user_id
      WHERE b.id = $1 AND b.ledger_id = $2`,
      [budgetId, ledgerId],
    );

    if (!res.rows[0]) {
      throw new NotFoundException('Budget not found');
    }

    return mapBudget(res.rows[0]);
  }
}
