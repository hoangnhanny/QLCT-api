import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupabaseService } from '../supabase/supabase.service';
import { Budget, formatMonthDate, mapBudget } from './budgets.types';
import { UpsertBudgetDto } from './dto/upsert-budget.dto';
import { Budget as BudgetEntity } from '../database/entities/budget.entity';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Category as CategoryEntity } from '../database/entities/category.entity';
import { Member as MemberEntity } from '../database/entities/member.entity';

@Injectable()
export class BudgetsService {
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
  };
  private readonly budgetRepo?: Repository<BudgetEntity>;
  private readonly ledgerRepo?: Repository<LedgerEntity>;
  private readonly categoryRepo?: Repository<CategoryEntity>;
  private readonly memberRepo?: Repository<MemberEntity>;

  constructor(
    @InjectRepository(BudgetEntity)
    budgetRepoOrSupabase: Repository<BudgetEntity> | SupabaseService | any,
    @InjectRepository(LedgerEntity)
    @Optional()
    ledgerRepo?: Repository<LedgerEntity>,
    @InjectRepository(CategoryEntity)
    @Optional()
    categoryRepo?: Repository<CategoryEntity>,
    @InjectRepository(MemberEntity)
    @Optional()
    memberRepo?: Repository<MemberEntity>,
  ) {
    if (budgetRepoOrSupabase?.db) {
      this.legacyDb = budgetRepoOrSupabase.db;
    } else {
      this.budgetRepo = budgetRepoOrSupabase as Repository<BudgetEntity>;
      this.ledgerRepo = ledgerRepo;
      this.categoryRepo = categoryRepo;
      this.memberRepo = memberRepo;
    }
  }

  /**
   * Helper to verify that the actor is admin of the ledger.
   */
  private async assertAdmin(ledgerId: string, actorId: string): Promise<void> {
    if (this.legacyDb) {
      const res = await this.legacyDb.query(
        `SELECT admin_id FROM public.ledgers WHERE id = $1`,
        [ledgerId],
      );
      if (!res.rows[0]) {
        throw new NotFoundException('Ledger not found');
      }
      if (res.rows[0].admin_id !== actorId) {
        throw new ForbiddenException('Only the ledger admin can do this');
      }
      return;
    }

    const ledger = await this.ledgerRepo!.findOne({
      where: { id: ledgerId },
      select: { adminId: true },
    });
    if (!ledger) {
      throw new NotFoundException('Ledger not found');
    }
    if (ledger.adminId !== actorId) {
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

    if (this.legacyDb) {
      if (dto.categoryId) {
        const catRes = await this.legacyDb.query(
          `SELECT id FROM public.categories WHERE id = $1 AND ledger_id = $2`,
          [dto.categoryId, ledgerId],
        );
        if (!catRes.rows[0]) {
          throw new BadRequestException(
            'Category does not belong to this ledger',
          );
        }
      }

      if (dto.memberUserId) {
        const memRes = await this.legacyDb.query(
          `SELECT id FROM public.members WHERE user_id = $1 AND ledger_id = $2 AND status = 'active'`,
          [dto.memberUserId, ledgerId],
        );
        if (!memRes.rows[0]) {
          throw new BadRequestException(
            'Member not found or not active in this ledger',
          );
        }
      }

      const upsertRes = await this.legacyDb.query(
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

    if (dto.categoryId) {
      const cat = await this.categoryRepo!.findOne({
        where: { id: dto.categoryId, ledgerId },
        select: { id: true },
      });
      if (!cat) {
        throw new BadRequestException(
          'Category does not belong to this ledger',
        );
      }
    }

    if (dto.memberUserId) {
      const mem = await this.memberRepo!.findOne({
        where: { userId: dto.memberUserId, ledgerId, status: 'active' },
        select: { id: true },
      });
      if (!mem) {
        throw new BadRequestException(
          'Member not found or not active in this ledger',
        );
      }
    }

    await this.budgetRepo!.upsert(
      {
        ledgerId,
        memberUserId: dto.memberUserId ?? null,
        categoryId: dto.categoryId ?? null,
        month,
        amount: dto.amount,
      },
      ['ledgerId', 'memberUserId', 'categoryId', 'month'],
    );

    const budget = await this.budgetRepo!.createQueryBuilder('b')
      .leftJoinAndSelect('b.category', 'c')
      .leftJoinAndSelect('b.memberProfile', 'p')
      .where(
        'b.ledger_id = :ledgerId AND b.month = :month AND ' +
          (dto.memberUserId
            ? 'b.member_user_id = :memberUserId'
            : 'b.member_user_id IS NULL') +
          ' AND ' +
          (dto.categoryId
            ? 'b.category_id = :categoryId'
            : 'b.category_id IS NULL'),
        {
          ledgerId,
          month,
          memberUserId: dto.memberUserId,
          categoryId: dto.categoryId,
        },
      )
      .getOne();

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    return mapBudget(budget);
  }

  /**
   * Lists all budgets for a ledger in a given month.
   */
  async list(ledgerId: string, monthStr: string): Promise<Budget[]> {
    const month = formatMonthDate(monthStr);

    if (this.legacyDb) {
      const res = await this.legacyDb.query(
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

    const budgets = await this.budgetRepo!.createQueryBuilder('b')
      .leftJoinAndSelect('b.category', 'c')
      .leftJoinAndSelect('b.memberProfile', 'p')
      .where('b.ledger_id = :ledgerId AND b.month = :month', {
        ledgerId,
        month,
      })
      .orderBy('b.member_user_id', 'ASC', 'NULLS FIRST')
      .addOrderBy('b.category_id', 'ASC', 'NULLS FIRST')
      .addOrderBy('b.created_at', 'ASC')
      .getMany();

    return budgets.map(mapBudget);
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

    if (this.legacyDb) {
      const res = await this.legacyDb.query(
        `DELETE FROM public.budgets WHERE id = $1 AND ledger_id = $2`,
        [budgetId, ledgerId],
      );

      if (res.rowCount === 0) {
        throw new NotFoundException('Budget not found');
      }
      return;
    }

    const res = await this.budgetRepo!.delete({ id: budgetId, ledgerId });
    if (res.affected === 0) {
      throw new NotFoundException('Budget not found');
    }
  }

  /**
   * Internal helper to fetch a single budget with joins.
   */
  private async getById(ledgerId: string, budgetId: string): Promise<Budget> {
    if (this.legacyDb) {
      const res = await this.legacyDb.query(
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

    const budget = await this.budgetRepo!.createQueryBuilder('b')
      .leftJoinAndSelect('b.category', 'c')
      .leftJoinAndSelect('b.memberProfile', 'p')
      .where('b.id = :budgetId AND b.ledger_id = :ledgerId', {
        budgetId,
        ledgerId,
      })
      .getOne();

    if (!budget) {
      throw new NotFoundException('Budget not found');
    }

    return mapBudget(budget);
  }
}
