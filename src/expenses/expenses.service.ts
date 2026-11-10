import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AlertsService } from '../budgets/alerts.service';
import { monthKey, monthRange } from '../common/month';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateExpenseItemDto } from './dto/create-expense-batch.dto';
import { ListExpensesDto } from './dto/list-expenses.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { Expense, mapExpense } from './expenses.types';
import { Expense as ExpenseEntity } from '../database/entities/expense.entity';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Category as CategoryEntity } from '../database/entities/category.entity';

@Injectable()
export class ExpensesService {
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
    connect?: () => Promise<any>;
  };
  private readonly expenseRepo?: Repository<ExpenseEntity>;
  private readonly dataSource?: DataSource;
  private readonly alertsService?: AlertsService;

  constructor(
    @InjectRepository(ExpenseEntity)
    expenseRepoOrSupabase: Repository<ExpenseEntity> | SupabaseService | any,
    @InjectDataSource()
    @Optional()
    dataSourceOrAlerts?: DataSource | AlertsService | any,
    @Optional() alertsService?: AlertsService,
  ) {
    if (expenseRepoOrSupabase?.db) {
      this.legacyDb = expenseRepoOrSupabase.db;
      this.alertsService = dataSourceOrAlerts as AlertsService;
    } else {
      this.expenseRepo = expenseRepoOrSupabase as Repository<ExpenseEntity>;
      this.dataSource = dataSourceOrAlerts as DataSource;
      this.alertsService = alertsService;
    }
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

    if (this.legacyDb) {
      const client = await this.legacyDb.connect();
      try {
        await client.query('BEGIN');

        if (items.some((item) => item.type === 'income')) {
          const ledger = await client.query(
            'SELECT kind FROM public.ledgers WHERE id = $1',
            [ledgerId],
          );
          if (ledger.rows[0]?.kind !== 'business') {
            throw new BadRequestException(
              'Income is only available in business ledgers',
            );
          }
        }

        const categoryIds = [
          ...new Set(
            items
              .map((i) => i.categoryId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];

        if (categoryIds.length > 0) {
          const catRes = await client.query(
            `SELECT id FROM public.categories WHERE ledger_id = $1 AND id = ANY($2::uuid[])`,
            [ledgerId, categoryIds],
          );
          const validIds = new Set(catRes.rows.map((r: any) => r.id));
          for (const catId of categoryIds) {
            if (!validIds.has(catId)) {
              throw new BadRequestException(
                `Category does not belong to this ledger`,
              );
            }
          }
        }

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
          const insertRes = await client.query(
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

        const result = await this.legacyDb.query(
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

    return this.dataSource!.transaction(async (manager) => {
      if (items.some((item) => item.type === 'income')) {
        const ledger = await manager.findOne(LedgerEntity, {
          where: { id: ledgerId },
          select: { kind: true },
        });
        if (ledger?.kind !== 'business') {
          throw new BadRequestException(
            'Income is only available in business ledgers',
          );
        }
      }

      const categoryIds = [
        ...new Set(
          items
            .map((i) => i.categoryId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];

      if (categoryIds.length > 0) {
        const validCats = await manager.find(CategoryEntity, {
          where: { ledgerId, id: In(categoryIds) },
          select: { id: true },
        });
        const validIds = new Set(validCats.map((c) => c.id));
        for (const catId of categoryIds) {
          if (!validIds.has(catId)) {
            throw new BadRequestException(
              `Category does not belong to this ledger`,
            );
          }
        }
      }

      for (const item of items) {
        if (item.amount <= 0) {
          throw new BadRequestException('Amount must be positive');
        }
        if (!item.content || item.content.trim().length === 0) {
          throw new BadRequestException('Content is required');
        }
      }

      const entities = items.map((item) =>
        manager.create(ExpenseEntity, {
          ledgerId,
          createdBy: userId,
          amount: item.amount,
          content: item.content.trim(),
          categoryId: item.categoryId ?? null,
          imagePath: item.imagePath ?? null,
          spentAt: item.spentAt ? new Date(item.spentAt) : new Date(),
          type: item.type ?? 'expense',
        }),
      );

      const saved = await manager.save(ExpenseEntity, entities);
      const insertedIds = saved.map((e) => e.id);

      const results = await manager
        .createQueryBuilder(ExpenseEntity, 'e')
        .leftJoinAndSelect('e.category', 'c')
        .leftJoinAndSelect('e.creatorProfile', 'p')
        .where('e.id IN (:...insertedIds)', { insertedIds })
        .orderBy('e.spentAt', 'DESC')
        .addOrderBy('e.createdAt', 'DESC')
        .getMany();

      const expenses = results.map(mapExpense);

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
    });
  }

  /**
   * Lists expenses for a ledger with filtering by month/date range, category, and user.
   */
  async list(ledgerId: string, filter?: ListExpensesDto): Promise<Expense[]> {
    if (this.legacyDb) {
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

      const res = await this.legacyDb.query(query, params);
      return res.rows.map(mapExpense);
    }

    const qb = this.expenseRepo!.createQueryBuilder('e')
      .leftJoinAndSelect('e.category', 'c')
      .leftJoinAndSelect('e.creatorProfile', 'p')
      .where('e.ledger_id = :ledgerId', { ledgerId });

    if (filter?.type) {
      qb.andWhere('e.type = :type', { type: filter.type });
    }

    if (filter?.from || filter?.to) {
      if (filter.from) {
        qb.andWhere('e.spent_at >= :from', { from: new Date(filter.from) });
      }
      if (filter.to) {
        qb.andWhere('e.spent_at <= :to', { to: new Date(filter.to) });
      }
    } else {
      const targetMonthKey = filter?.month ?? monthKey(new Date());
      const range = monthRange(targetMonthKey);
      qb.andWhere('e.spent_at >= :from AND e.spent_at < :to', {
        from: range.from,
        to: range.to,
      });
    }

    if (filter?.categoryId) {
      qb.andWhere('e.category_id = :catId', { catId: filter.categoryId });
    }

    if (filter?.userId) {
      qb.andWhere('e.created_by = :userId', { userId: filter.userId });
    }

    qb.orderBy('e.spent_at', 'DESC').addOrderBy('e.created_at', 'DESC');
    const res = await qb.getMany();
    return res.map(mapExpense);
  }

  /**
   * Retrieves single expense details.
   */
  async getById(ledgerId: string, expenseId: string): Promise<Expense> {
    if (this.legacyDb) {
      const res = await this.legacyDb.query(
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

    const res = await this.expenseRepo!.createQueryBuilder('e')
      .leftJoinAndSelect('e.category', 'c')
      .leftJoinAndSelect('e.creatorProfile', 'p')
      .where('e.id = :expenseId AND e.ledger_id = :ledgerId', {
        expenseId,
        ledgerId,
      })
      .getOne();

    if (!res) {
      throw new NotFoundException('Expense not found');
    }

    return mapExpense(res);
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
    if (this.legacyDb) {
      const existingRes = await this.legacyDb.query(
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

      if (dto.type === 'income') {
        const ledger = await this.legacyDb.query(
          'SELECT kind FROM public.ledgers WHERE id = $1',
          [ledgerId],
        );
        if (ledger.rows[0]?.kind !== 'business') {
          throw new BadRequestException(
            'Income is only available in business ledgers',
          );
        }
      }

      if (dto.categoryId) {
        const catRes = await this.legacyDb.query(
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

      if (dto.type !== undefined) {
        params.push(dto.type);
        updates.push(`type = $${params.length}`);
      }
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
        await this.legacyDb.query(
          `UPDATE public.expenses SET ${updates.join(', ')} WHERE id = $1 AND ledger_id = $2`,
          params,
        );
      }

      return this.getById(ledgerId, expenseId);
    }

    const existing = await this.expenseRepo!.findOne({
      where: { id: expenseId, ledgerId },
    });
    if (!existing) {
      throw new NotFoundException('Expense not found');
    }
    if (existing.createdBy !== userId) {
      throw new ForbiddenException('Only the creator can edit this expense');
    }

    if (dto.amount !== undefined && dto.amount <= 0) {
      throw new BadRequestException('Amount must be positive');
    }
    if (dto.content !== undefined && !dto.content.trim()) {
      throw new BadRequestException('Content cannot be empty');
    }

    if (dto.type === 'income') {
      const ledger = await this.dataSource!.getRepository(LedgerEntity).findOne(
        {
          where: { id: ledgerId },
          select: { kind: true },
        },
      );
      if (ledger?.kind !== 'business') {
        throw new BadRequestException(
          'Income is only available in business ledgers',
        );
      }
    }

    if (dto.categoryId) {
      const cat = await this.dataSource!.getRepository(CategoryEntity).findOne({
        where: { id: dto.categoryId, ledgerId },
      });
      if (!cat) {
        throw new BadRequestException(
          'Category does not belong to this ledger',
        );
      }
    }

    if (dto.type !== undefined) existing.type = dto.type;
    if (dto.amount !== undefined) existing.amount = dto.amount;
    if (dto.content !== undefined) existing.content = dto.content.trim();
    if (dto.spentAt !== undefined) existing.spentAt = new Date(dto.spentAt);
    if (dto.categoryId !== undefined) existing.categoryId = dto.categoryId;
    if (dto.imagePath !== undefined) existing.imagePath = dto.imagePath;

    await this.expenseRepo!.save(existing);
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
    if (this.legacyDb) {
      const existingRes = await this.legacyDb.query(
        `SELECT * FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
        [expenseId, ledgerId],
      );

      if (existingRes.rows.length === 0) {
        throw new NotFoundException('Expense not found');
      }

      const existing = existingRes.rows[0];
      if (existing.created_by !== userId) {
        throw new ForbiddenException(
          'Only the creator can delete this expense',
        );
      }

      await this.legacyDb.query(
        `DELETE FROM public.expenses WHERE id = $1 AND ledger_id = $2`,
        [expenseId, ledgerId],
      );
      return;
    }

    const existing = await this.expenseRepo!.findOne({
      where: { id: expenseId, ledgerId },
    });
    if (!existing) {
      throw new NotFoundException('Expense not found');
    }
    if (existing.createdBy !== userId) {
      throw new ForbiddenException('Only the creator can delete this expense');
    }

    await this.expenseRepo!.delete({ id: expenseId, ledgerId });
  }
}
