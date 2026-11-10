import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateCategoryDto } from './dto/create-category.dto';
import { CreateLedgerDto } from './dto/create-ledger.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { DEFAULT_CATEGORIES } from './default-categories';
import { formatMonthDate } from '../budgets/budgets.types';
import { monthKey } from '../common/month';
import {
  Category,
  Ledger,
  mapCategory,
  mapLedger,
  mapMember,
  Member,
} from './ledgers.types';
import { Ledger as LedgerEntity } from '../database/entities/ledger.entity';
import { Member as MemberEntity } from '../database/entities/member.entity';
import { Category as CategoryEntity } from '../database/entities/category.entity';

@Injectable()
export class LedgersService {
  private readonly ledgerRepo?: Repository<LedgerEntity>;
  private readonly memberRepo?: Repository<MemberEntity>;
  private readonly categoryRepo?: Repository<CategoryEntity>;
  private readonly dataSource?: DataSource;
  private readonly legacyDb?: any;

  constructor(
    @InjectRepository(LedgerEntity)
    ledgerRepo: Repository<LedgerEntity> | { db: any },
    @InjectRepository(MemberEntity)
    @Optional()
    memberRepo?: Repository<MemberEntity>,
    @InjectRepository(CategoryEntity)
    @Optional()
    categoryRepo?: Repository<CategoryEntity>,
    @InjectDataSource()
    @Optional()
    dataSource?: DataSource,
  ) {
    if ((ledgerRepo as any)?.db) {
      this.legacyDb = (ledgerRepo as any).db;
    } else {
      this.ledgerRepo = ledgerRepo as Repository<LedgerEntity>;
      this.memberRepo = memberRepo;
      this.categoryRepo = categoryRepo;
      this.dataSource = dataSource;
    }
  }

  /** Creates a ledger, admin membership, and default categories atomically. */
  async create(userId: string, dto: CreateLedgerDto): Promise<Ledger> {
    const targetMonth = dto.month
      ? formatMonthDate(dto.month)
      : monthKey(new Date());

    if (this.legacyDb) {
      const client = await this.legacyDb.connect();
      try {
        await client.query('BEGIN');
        const ledgerResult = await client.query(
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

    return this.dataSource.transaction(async (manager) => {
      const ledger = manager.create(LedgerEntity, {
        kind: dto.kind,
        name: dto.name,
        adminId: userId,
        month: targetMonth,
      });
      const savedLedger = await manager.save(LedgerEntity, ledger);

      const member = manager.create(MemberEntity, {
        ledgerId: savedLedger.id,
        userId,
        status: 'active',
      });
      await manager.save(MemberEntity, member);

      const defaults = DEFAULT_CATEGORIES[dto.kind];
      const categories = defaults.map((cat, index) =>
        manager.create(CategoryEntity, {
          ledgerId: savedLedger.id,
          name: cat.name,
          icon: cat.icon ?? null,
          sort: index,
        }),
      );
      await manager.save(CategoryEntity, categories);

      return mapLedger(savedLedger);
    });
  }

  async listForUser(userId: string, monthStr?: string): Promise<Ledger[]> {
    const targetMonth = monthStr ? formatMonthDate(monthStr) : null;

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `select l.* from public.ledgers l
         join public.members m on m.ledger_id = l.id
         where m.user_id = $1 and m.status = 'active'
           and ($2::date is null or l.month = $2)
         order by l.created_at`,
        [userId, targetMonth],
      );
      return result.rows.map(mapLedger);
    }

    const qb = this.ledgerRepo
      .createQueryBuilder('l')
      .innerJoin(MemberEntity, 'm', 'm.ledger_id = l.id')
      .where('m.user_id = :userId AND m.status = :status', {
        userId,
        status: 'active',
      })
      .orderBy('l.created_at', 'ASC');

    if (targetMonth) {
      qb.andWhere('l.month = :month', { month: targetMonth });
    }

    const ledgers = await qb.getMany();
    return ledgers.map(mapLedger);
  }

  async listMembers(ledgerId: string): Promise<Member[]> {
    await this.getLedgerOrThrow(ledgerId);

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `select m.*, p.display_name, p.avatar_url, p.email
         from public.members m
         left join public.profiles p on p.user_id = m.user_id
         where m.ledger_id = $1
         order by m.created_at`,
        [ledgerId],
      );
      return result.rows.map(mapMember);
    }

    const members = await this.memberRepo.find({
      where: { ledgerId },
      relations: { profile: true },
      order: { createdAt: 'ASC' },
    });
    return members.map(mapMember);
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

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `update public.members set status = 'removed'
         where ledger_id = $1 and user_id = $2 and status = 'active'
         returning id`,
        [ledgerId, memberUserId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('Member not found');
      }
      return;
    }

    const result = await this.memberRepo.update(
      { ledgerId, userId: memberUserId, status: 'active' },
      { status: 'removed' },
    );
    if (result.affected === 0) {
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

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `update public.members set status = 'removed'
         where ledger_id = $1 and user_id = $2 and status = 'active'
         returning id`,
        [ledgerId, userId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('Member not found');
      }
      return;
    }

    const result = await this.memberRepo.update(
      { ledgerId, userId, status: 'active' },
      { status: 'removed' },
    );
    if (result.affected === 0) {
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

    if (this.legacyDb) {
      const memberResult = await this.legacyDb.query(
        `select id from public.members
         where ledger_id = $1 and user_id = $2 and status = 'active'`,
        [ledgerId, newAdminUserId],
      );
      if (memberResult.rowCount === 0) {
        throw new NotFoundException(
          'Target user is not an active member of this ledger',
        );
      }

      await this.legacyDb.query(
        `update public.ledgers set admin_id = $1 where id = $2`,
        [newAdminUserId, ledgerId],
      );
      return;
    }

    const member = await this.memberRepo.findOne({
      where: { ledgerId, userId: newAdminUserId, status: 'active' },
    });
    if (!member) {
      throw new NotFoundException(
        'Target user is not an active member of this ledger',
      );
    }

    await this.ledgerRepo.update({ id: ledgerId }, { adminId: newAdminUserId });
  }

  async listCategories(ledgerId: string): Promise<Category[]> {
    await this.getLedgerOrThrow(ledgerId);

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `select * from public.categories where ledger_id = $1 order by sort, created_at`,
        [ledgerId],
      );
      return result.rows.map(mapCategory);
    }

    const categories = await this.categoryRepo.find({
      where: { ledgerId },
      order: { sort: 'ASC', createdAt: 'ASC' },
    });
    return categories.map(mapCategory);
  }

  async addCategory(
    ledgerId: string,
    actorId: string,
    dto: CreateCategoryDto,
  ): Promise<Category> {
    await this.assertAdmin(ledgerId, actorId);

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `insert into public.categories (ledger_id, name, icon, sort)
         values ($1, $2, $3, $4) returning *`,
        [ledgerId, dto.name, dto.icon ?? null, dto.sort ?? null],
      );
      return mapCategory(result.rows[0]);
    }

    const cat = this.categoryRepo.create({
      ledgerId,
      name: dto.name,
      icon: dto.icon ?? null,
      sort: dto.sort ?? null,
    });
    const saved = await this.categoryRepo.save(cat);
    return mapCategory(saved);
  }

  async updateCategory(
    ledgerId: string,
    actorId: string,
    categoryId: string,
    dto: UpdateCategoryDto,
  ): Promise<Category> {
    await this.assertAdmin(ledgerId, actorId);

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
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

    const category = await this.categoryRepo.findOne({
      where: { id: categoryId, ledgerId },
    });
    if (!category) {
      throw new NotFoundException('Category not found');
    }

    if (dto.name !== undefined) category.name = dto.name;
    if (dto.icon !== undefined) category.icon = dto.icon ?? null;
    if (dto.sort !== undefined) category.sort = dto.sort ?? null;

    const saved = await this.categoryRepo.save(category);
    return mapCategory(saved);
  }

  async deleteCategory(
    ledgerId: string,
    actorId: string,
    categoryId: string,
  ): Promise<void> {
    await this.assertAdmin(ledgerId, actorId);

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `delete from public.categories where ledger_id = $1 and id = $2 returning id`,
        [ledgerId, categoryId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('Category not found');
      }
      return;
    }

    const result = await this.categoryRepo.delete({
      id: categoryId,
      ledgerId,
    });
    if (result.affected === 0) {
      throw new NotFoundException('Category not found');
    }
  }

  private async getLedgerOrThrow(ledgerId: string): Promise<Ledger> {
    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `select * from public.ledgers where id = $1`,
        [ledgerId],
      );
      if (result.rowCount === 0) {
        throw new NotFoundException('Ledger not found');
      }
      return mapLedger(result.rows[0]);
    }

    const ledger = await this.ledgerRepo.findOne({
      where: { id: ledgerId },
    });
    if (!ledger) {
      throw new NotFoundException('Ledger not found');
    }
    return mapLedger(ledger);
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
