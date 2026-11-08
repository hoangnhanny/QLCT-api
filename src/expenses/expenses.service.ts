import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { AlertsService } from '../budgets/alerts.service';
import { monthKey, monthRange } from '../common/month';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateExpenseItemDto } from './dto/create-expense-batch.dto';
import { ListExpensesDto } from './dto/list-expenses.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { Expense, ExpenseRow, mapExpense } from './expenses.types';

@Injectable()
export class ExpensesService {
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly alertsService?: AlertsService,
  ) {}

  private get db() {
    return this.supabase.db;
  }

  /**
   * Creates a batch of expenses atomically (all-or-nothing).
   * Validates all items and verifies that referenced categories belong to the ledger.
   */
  async createBatch(
    ledgerId: string,
    userId: string,
    items: CreateExpenseItemDto[],
  ): Promise<Expense[]> {
    if (!items || items.length === 0) {
      throw new BadRequestException('At least one expense item is required');
    }

    const client = await this.db.connect();
    try {
      await client.query('BEGIN');

      if (items.some((item) => item.type === 'income')) {
        const ledger = await client.query<{ kind: string }>(
          'SELECT kind FROM public.ledgers WHERE id = $1',
          [ledgerId],
        );
        if (ledger.rows[0]?.kind !== 'business') {
          throw new BadRequestException(
            'Income is only available in business ledgers',
          );
        }
      }

      // Verify all categoryIds belong to this ledger
      const categoryIds = [
        ...new Set(
          items
            .map((i) => i.categoryId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      if (categoryIds.length > 0) {
        const catRes = await client.query<{ id: string }>(
          `SELECT id FROM public.categories WHERE ledger_id = $1 AND id = ANY($2::uuid[])`,
          [ledgerId, categoryIds],
        );
        const validIds = new Set(catRes.rows.map((r) => r.id));
        for (const catId of categoryIds) {
          if (!validIds.has(catId)) {
            throw new BadRequestException(
              `Category does not belong to this ledger`,
            );
          }
        }
      }

      // Validate all items
      for (const item of items) {
        if (item.amount <= 0) {
          throw new BadRequestException('Amount must be positive');
        }
        if (!item.content || item.content.trim().length === 0) {
          throw new BadRequestException('Content is required');
        }
      }

      const insertedIds: string[] = [];
      for (const item of items) {
        const spentAt = item.spentAt ? new Date(item.spentAt) : new Date();
        const insertRes = await client.query<{ id: string }>(
          `INSERT INTO public.expenses (ledger_id, created_by, amount, content, category_id, image_path, spent_at, type)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            ledgerId,
            userId,
            item.amount,
            item.content.trim(),
            item.categoryId ?? null,
            item.imagePath ?? null,
            spentAt,
            item.type ?? 'expense',
          ],
        );
        insertedIds.push(insertRes.rows[0].id);
      }

      await client.query('COMMIT');

      // Fetch newly created expenses with joined category & creator profile
      const result = await this.db.query<ExpenseRow>(
        `SELECT
          e.id,
          e.type,
          e.ledger_id,
          e.created_by,
          e.amount,
          e.content,
          e.category_id,
          e.image_path,
          e.spent_at,
          e.created_at,
          c.name as category_name,
          c.icon as category_icon,
          p.display_name as creator_display_name,
          p.avatar_url as creator_avatar_url
        FROM public.expenses e
        LEFT JOIN public.categories c ON e.category_id = c.id
        LEFT JOIN public.profiles p ON e.created_by = p.user_id
        WHERE e.id = ANY($1::uuid[])
        ORDER BY e.spent_at DESC, e.created_at DESC`,
        [insertedIds],
      );

      const expenses = result.rows.map(mapExpense);

      // Trigger alerts evaluation if service is wired
      if (this.alertsService?.evaluate) {
        const affectedMonths = new Set<string>();
        for (const item of items) {
          if (item.type === 'income') continue;
          const spentAt = item.spentAt ? new Date(item.spentAt) : new Date();
          affectedMonths.add(monthKey(spentAt));
        }
        for (const mKey of affectedMonths) {
          await this.alertsService
            .evaluate(ledgerId, mKey, [userId])
            .catch(() => {});
        }
      }

      return expenses;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Lists expenses for a ledger with filtering by month/date range, category, and user.
   */
  async list(ledgerId: string, filter?: ListExpensesDto): Promise<Expense[]> {
    const conditions: string[] = ['e.ledger_id = $1'];
    const params: any[] = [ledgerId];

    if (filter?.type) {
      params.push(filter.type);
      conditions.push(`e.type = $${params.length}`);
    }

    if (filter?.from || filter?.to) {
      if (filter.from) {
        params.push(new Date(filter.from));
        conditions.push(`e.spent_at >= $${params.length}`);
      }
      if (filter.to) {
        params.push(new Date(filter.to));
        conditions.push(`e.spent_at <= $${params.length}`);
      }
    } else {
      const targetMonthKey = filter?.month ?? monthKey(new Date());
      const range = monthRange(targetMonthKey);
      params.push(range.from);
      conditions.push(`e.spent_at >= $${params.length}`);
      params.push(range.to);
      conditions.push(`e.spent_at < $${params.length}`);
    }

    if (filter?.categoryId) {
      params.push(filter.categoryId);
      conditions.push(`e.category_id = $${params.length}`);
    }

    if (filter?.userId) {
      params.push(filter.userId);
      conditions.push(`e.created_by = $${params.length}`);
    }

    const query = `
      SELECT
        e.id,
        e.type,
        e.ledger_id,
        e.created_by,
        e.amount,
        e.content,
        e.category_id,
        e.image_path,
        e.spent_at,
        e.created_at,
        c.name as category_name,
        c.icon as category_icon,
        p.display_name as creator_display_name,
        p.avatar_url as creator_avatar_url
      FROM public.expenses e
      LEFT JOIN public.categories c ON e.category_id = c.id
      LEFT JOIN public.profiles p ON e.created_by = p.user_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.spent_at DESC, e.created_at DESC
    `;

    const res = await this.db.query<ExpenseRow>(query, params);
    return res.rows.map(mapExpense);
  }

  /**
   * Retrieves single expense details.
   */
  async getById(ledgerId: string, expenseId: string): Promise<Expense> {
    const res = await this.db.query<ExpenseRow>(
      `SELECT
        e.id,
        e.type,
        e.ledger_id,
        e.created_by,
        e.amount,
        e.content,
        e.category_id,
        e.image_path,
        e.spent_at,
        e.created_at,
        c.name as category_name,
        c.icon as category_icon,
        p.display_name as creator_display_name,
        p.avatar_url as creator_avatar_url
      FROM public.expenses e
      LEFT JOIN public.categories c ON e.category_id = c.id
      LEFT JOIN public.profiles p ON e.created_by = p.user_id
      WHERE e.id = $1 AND e.ledger_id = $2`,
      [expenseId, ledgerId],
    );

    if (res.rows.length === 0) {
      throw new NotFoundException('Expense not found');
    }

    return mapExpense(res.rows[0]);
  }

  /**
   * Updates an expense. Only the original creator may edit it.
   */
  async update(
    ledgerId: string,
    userId: string,
    expenseId: string,
    dto: UpdateExpenseDto,
  ): Promise<Expense> {
    const existingRes = await this.db.query<{ created_by: string }>(
      `SELECT * FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
      [expenseId, ledgerId],
    );

    if (existingRes.rows.length === 0) {
      throw new NotFoundException('Expense not found');
    }

    const existing = existingRes.rows[0];
    if (existing.created_by !== userId) {
      throw new ForbiddenException('Only the creator can edit this expense');
    }

    if (dto.amount !== undefined && dto.amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    if (dto.content !== undefined && !dto.content.trim()) {
      throw new BadRequestException('Content cannot be empty');
    }

    if (dto.categoryId) {
      const catRes = await this.db.query(
        `SELECT id FROM public.categories WHERE id = $1 AND ledger_id = $2`,
        [dto.categoryId, ledgerId],
      );
      if (catRes.rows.length === 0) {
        throw new BadRequestException(
          'Category does not belong to this ledger',
        );
      }
    }

    const updates: string[] = [];
    const params: any[] = [expenseId, ledgerId];

    if (dto.amount !== undefined) {
      params.push(dto.amount);
      updates.push(`amount = $${params.length}`);
    }
    if (dto.content !== undefined) {
      params.push(dto.content.trim());
      updates.push(`content = $${params.length}`);
    }
    if (dto.spentAt !== undefined) {
      params.push(new Date(dto.spentAt));
      updates.push(`spent_at = $${params.length}`);
    }
    if (dto.categoryId !== undefined) {
      params.push(dto.categoryId);
      updates.push(`category_id = $${params.length}`);
    }
    if (dto.imagePath !== undefined) {
      params.push(dto.imagePath);
      updates.push(`image_path = $${params.length}`);
    }

    if (updates.length > 0) {
      await this.db.query(
        `UPDATE public.expenses SET ${updates.join(', ')} WHERE id = $1 AND ledger_id = $2`,
        params,
      );
    }

    return this.getById(ledgerId, expenseId);
  }

  /**
   * Deletes an expense. Only the original creator may delete it.
   */
  async remove(
    ledgerId: string,
    userId: string,
    expenseId: string,
  ): Promise<void> {
    const existingRes = await this.db.query<{ created_by: string }>(
      `SELECT * FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
      [expenseId, ledgerId],
    );

    if (existingRes.rows.length === 0) {
      throw new NotFoundException('Expense not found');
    }

    const existing = existingRes.rows[0];
    if (existing.created_by !== userId) {
      throw new ForbiddenException('Only the creator can delete this expense');
    }

    await this.db.query(
      `DELETE FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
      [expenseId, ledgerId],
    );
  }
}
