import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { DEFAULT_CATEGORIES } from './default-categories';
import { formatMonthDate } from '../budgets/budgets.types';
import { monthKey } from '../common/month';
import {
  Category,
  CategoryRow,
  Ledger,
  LedgerRow,
  mapCategory,
  mapLedger,
  mapMember,
  Member,
  MemberRow,
} from './ledgers.types';

@Injectable()
export class LedgersService {
  constructor(private readonly supabase: SupabaseService) {}

  private get db() {
    return this.supabase.db;
  }

  /** Creates a ledger, admin membership, and default categories atomically. */
  async create(userId: string, dto: CreateLedgerDto): Promise<Ledger> {
    const client = await this.db.connect();
    const targetMonth = dto.month
      ? formatMonthDate(dto.month)
      : monthKey(new Date());

    try {
      await client.query('BEGIN');

      const ledgerResult = await client.query<LedgerRow>(
        `insert into public.ledgers (kind, name, admin_id, month)
         values ($1, $2, $3, $4) returning *`,
        [dto.kind, dto.name, userId, targetMonth],
      );
      const ledgerRow = ledgerResult.rows[0];

      await client.query(
        `insert into public.members (ledger_id, user_id, status)
         values ($1, $2, 'active')`,
        [ledgerRow.id, userId],
      );

      const defaults = DEFAULT_CATEGORIES[dto.kind];
      for (const [index, category] of defaults.entries()) {
        await client.query(
          `insert into public.categories (ledger_id, name, icon, sort)
           values ($1, $2, $3, $4)`,
          [ledgerRow.id, category.name, category.icon, index],
        );
      }

      await client.query('COMMIT');
      return mapLedger(ledgerRow);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async listForUser(userId: string, monthStr?: string): Promise<Ledger[]> {
    const targetMonth = monthStr ? formatMonthDate(monthStr) : null;
    const result = await this.db.query<LedgerRow>(
      `select l.* from public.ledgers l
       join public.members m on m.ledger_id = l.id
       where m.user_id = $1 and m.status = 'active'
         and ($2::date is null or l.month = $2)
       order by l.created_at`,
      [userId, targetMonth],
    );
    return result.rows.map(mapLedger);
  }

  async listMembers(ledgerId: string): Promise<Member[]> {
    await this.getLedgerOrThrow(ledgerId);
    const result = await this.db.query<MemberRow>(
      `select * from public.members where ledger_id = $1 order by created_at`,
      [ledgerId],
    );
    return result.rows.map(mapMember);
  }

  async removeMember(
    ledgerId: string,
    actorId: string,
    memberUserId: string,
  ): Promise<void> {
    const ledger = await this.assertAdmin(ledgerId, actorId);
    if (memberUserId === ledger.adminId) {
      throw new ForbiddenException('Cannot remove the ledger admin');
    }

    const result = await this.db.query(
      `update public.members set status = 'removed'
       where ledger_id = $1 and user_id = $2 and status = 'active'
       returning id`,
      [ledgerId, memberUserId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Member not found');
    }
  }

  async leave(ledgerId: string, userId: string): Promise<void> {
    const ledger = await this.getLedgerOrThrow(ledgerId);
    if (ledger.adminId === userId) {
      throw new ForbiddenException(
        'Transfer admin rights to another member before leaving',
      );
    }

    const result = await this.db.query(
      `update public.members set status = 'removed'
       where ledger_id = $1 and user_id = $2 and status = 'active'
       returning id`,
      [ledgerId, userId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Member not found');
    }
  }

  async transferAdmin(
    ledgerId: string,
    actorId: string,
    newAdminUserId: string,
  ): Promise<void> {
    const ledger = await this.assertAdmin(ledgerId, actorId);
    if (newAdminUserId === ledger.adminId) {
      throw new BadRequestException('User is already the admin');
    }

    const memberResult = await this.db.query(
      `select id from public.members
       where ledger_id = $1 and user_id = $2 and status = 'active'`,
      [ledgerId, newAdminUserId],
    );
    if (memberResult.rowCount === 0) {
      throw new NotFoundException(
        'Target user is not an active member of this ledger',
      );
    }

    await this.db.query(
      `update public.ledgers set admin_id = $1 where id = $2`,
      [newAdminUserId, ledgerId],
    );
  }

  async listCategories(ledgerId: string): Promise<Category[]> {
    await this.getLedgerOrThrow(ledgerId);
    const result = await this.db.query<CategoryRow>(
      `select * from public.categories where ledger_id = $1 order by sort, created_at`,
      [ledgerId],
    );
    return result.rows.map(mapCategory);
  }

  async addCategory(
    ledgerId: string,
    actorId: string,
    dto: CreateCategoryDto,
  ): Promise<Category> {
    await this.assertAdmin(ledgerId, actorId);
    const result = await this.db.query<CategoryRow>(
      `insert into public.categories (ledger_id, name, icon, sort)
       values ($1, $2, $3, $4) returning *`,
      [ledgerId, dto.name, dto.icon ?? null, dto.sort ?? null],
    );
    return mapCategory(result.rows[0]);
  }

  async updateCategory(
    ledgerId: string,
    actorId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    await this.assertAdmin(ledgerId, actorId);
    const result = await this.db.query<CategoryRow>(
      `update public.categories set
         name = coalesce($3, name),
         icon = coalesce($4, icon),
         sort = coalesce($5, sort)
       where ledger_id = $1 and id = $2
       returning *`,
      [
        ledgerId,
        categoryId,
        dto.name ?? null,
        dto.icon ?? null,
        dto.sort ?? null,
      ],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Category not found');
    }
    return mapCategory(result.rows[0]);
  }

  async deleteCategory(
    ledgerId: string,
    actorId: string,
    categoryId: string,
  ): Promise<void> {
    await this.assertAdmin(ledgerId, actorId);
    const result = await this.db.query(
      `delete from public.categories where ledger_id = $1 and id = $2 returning id`,
      [ledgerId, categoryId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Category not found');
    }
  }

  private async getLedgerOrThrow(ledgerId: string): Promise<Ledger> {
    const result = await this.db.query<LedgerRow>(
      `select * from public.ledgers where id = $1`,
      [ledgerId],
    );
    if (result.rowCount === 0) {
      throw new NotFoundException('Ledger not found');
    }
    return mapLedger(result.rows[0]);
  }

  private async assertAdmin(
    ledgerId: string,
    actorId: string,
  ): Promise<Ledger> {
    const ledger = await this.getLedgerOrThrow(ledgerId);
    if (ledger.adminId !== actorId) {
      throw new ForbiddenException('Only the ledger admin can do this');
    }
    return ledger;
  }
}
