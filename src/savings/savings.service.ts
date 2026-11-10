import {
  BadRequestException,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateSavingsEntryDto, CreateSavingsGoalDto } from './savings.dto';
import { SavingsGoal as SavingsGoalEntity } from '../database/entities/savings-goal.entity';
import { SavingsEntry as SavingsEntryEntity } from '../database/entities/savings-entry.entity';

interface GoalRow {
  id: string;
  name: string;
  target: string | number;
  balance: string | number;
  due_date?: string | Date | null;
  dueDate?: string | Date | null;
}

function mapGoal(row: GoalRow | SavingsGoalEntity) {
  const dueDate =
    'dueDate' in row && row.dueDate ? row.dueDate : (row as any).due_date;
  return {
    id: row.id,
    name: row.name,
    target: Number(row.target),
    balance: Number(row.balance),
    dueDate:
      dueDate instanceof Date
        ? dueDate.toISOString().slice(0, 10)
        : (dueDate ?? null),
  };
}

@Injectable()
export class SavingsService {
  private readonly legacyDb?: {
    query: (sql: string, params?: any[]) => Promise<any>;
    connect?: () => Promise<any>;
  };
  private readonly goalRepo?: Repository<SavingsGoalEntity>;
  private readonly entryRepo?: Repository<SavingsEntryEntity>;
  private readonly dataSource?: DataSource;

  constructor(
    @InjectRepository(SavingsGoalEntity)
    goalRepoOrSupabase: Repository<SavingsGoalEntity> | SupabaseService | any,
    @InjectRepository(SavingsEntryEntity)
    @Optional()
    entryRepo?: Repository<SavingsEntryEntity>,
    @InjectDataSource()
    @Optional()
    dataSource?: DataSource,
  ) {
    if (goalRepoOrSupabase?.db) {
      this.legacyDb = goalRepoOrSupabase.db;
    } else {
      this.goalRepo = goalRepoOrSupabase as Repository<SavingsGoalEntity>;
      this.entryRepo = entryRepo;
      this.dataSource = dataSource;
    }
  }

  async list(userId: string) {
    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        'SELECT id, name, target, balance, due_date FROM public.savings_goals WHERE user_id = $1 ORDER BY created_at DESC',
        [userId],
      );
      return result.rows.map(mapGoal);
    }

    const goals = await this.goalRepo!.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
    return goals.map(mapGoal);
  }

  async create(userId: string, dto: CreateSavingsGoalDto) {
    if (!dto.name.trim())
      throw new BadRequestException('Goal name is required');

    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        'INSERT INTO public.savings_goals (user_id, name, target, due_date) VALUES ($1, $2, $3, $4) RETURNING *',
        [userId, dto.name.trim(), dto.target, dto.dueDate ?? null],
      );
      return mapGoal(result.rows[0]);
    }

    const goal = this.goalRepo!.create({
      userId,
      name: dto.name.trim(),
      target: dto.target,
      dueDate: dto.dueDate ?? null,
    });
    const saved = await this.goalRepo!.save(goal);
    return mapGoal(saved);
  }

  async entries(userId: string, goalId: string) {
    if (this.legacyDb) {
      const result = await this.legacyDb.query(
        `SELECT e.id, e.type, e.amount, e.note, e.created_at
         FROM public.savings_entries e JOIN public.savings_goals g ON g.id = e.goal_id
         WHERE g.id = $1 AND g.user_id = $2 ORDER BY e.created_at DESC LIMIT 100`,
        [goalId, userId],
      );
      return result.rows.map((row: any) => ({
        id: row.id,
        type: row.type,
        amount: Number(row.amount),
        note: row.note,
        createdAt: row.created_at,
      }));
    }

    const entries = await this.entryRepo!.createQueryBuilder('e')
      .innerJoin(SavingsGoalEntity, 'g', 'g.id = e.goal_id')
      .where('g.id = :goalId AND g.user_id = :userId', { goalId, userId })
      .orderBy('e.created_at', 'DESC')
      .limit(100)
      .getMany();

    return entries.map((e) => ({
      id: e.id,
      type: e.type,
      amount: Number(e.amount),
      note: e.note,
      createdAt: e.createdAt,
    }));
  }

  async addEntry(userId: string, goalId: string, dto: CreateSavingsEntryDto) {
    if (
      !Number.isSafeInteger(dto.amount) ||
      dto.amount <= 0 ||
      !['deposit', 'withdrawal'].includes(dto.type)
    ) {
      throw new BadRequestException('Invalid savings entry');
    }

    if (this.legacyDb) {
      const client = await this.legacyDb.connect!();
      try {
        await client.query('BEGIN');
        const goal = await client.query(
          'SELECT balance FROM public.savings_goals WHERE id = $1 AND user_id = $2 FOR UPDATE',
          [goalId, userId],
        );
        if (!goal.rows[0])
          throw new NotFoundException('Savings goal not found');
        const delta = dto.type === 'deposit' ? dto.amount : -dto.amount;
        if (Number(goal.rows[0].balance) + delta < 0)
          throw new BadRequestException('Số tiền rút vượt quá số dư tiết kiệm');
        await client.query(
          'INSERT INTO public.savings_entries (goal_id, type, amount, note) VALUES ($1, $2, $3, $4)',
          [goalId, dto.type, dto.amount, dto.note ?? null],
        );
        await client.query(
          'UPDATE public.savings_goals SET balance = balance + $1 WHERE id = $2 AND user_id = $3',
          [delta, goalId, userId],
        );
        await client.query('COMMIT');
        return { ok: true };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    }

    return this.dataSource!.transaction(async (manager) => {
      const goal = await manager.findOne(SavingsGoalEntity, {
        where: { id: goalId, userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!goal) throw new NotFoundException('Savings goal not found');

      const delta = dto.type === 'deposit' ? dto.amount : -dto.amount;
      if (Number(goal.balance) + delta < 0) {
        throw new BadRequestException('Số tiền rút vượt quá số dư tiết kiệm');
      }

      const entry = manager.create(SavingsEntryEntity, {
        goalId,
        type: dto.type,
        amount: dto.amount,
        note: dto.note ?? null,
      });
      await manager.save(SavingsEntryEntity, entry);

      goal.balance = Number(goal.balance) + delta;
      await manager.save(SavingsGoalEntity, goal);

      return { ok: true };
    });
  }
}
