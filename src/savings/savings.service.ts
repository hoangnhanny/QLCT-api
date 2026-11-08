import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateSavingsEntryDto, CreateSavingsGoalDto } from './savings.dto';

interface GoalRow {
  id: string;
  name: string;
  target: string | number;
  balance: string | number;
  due_date: string | Date | null;
}

function mapGoal(row: GoalRow) {
  return {
    id: row.id,
    name: row.name,
    target: Number(row.target),
    balance: Number(row.balance),
    dueDate:
      row.due_date instanceof Date
        ? row.due_date.toISOString().slice(0, 10)
        : row.due_date,
  };
}

@Injectable()
export class SavingsService {
  constructor(private readonly supabase: SupabaseService) {}

  async list(userId: string) {
    const result = await this.supabase.db.query<GoalRow>(
      'SELECT id, name, target, balance, due_date FROM public.savings_goals WHERE user_id = $1 ORDER BY created_at DESC',
      [userId],
    );
    return result.rows.map(mapGoal);
  }

  async create(userId: string, dto: CreateSavingsGoalDto) {
    if (!dto.name.trim())
      throw new BadRequestException('Goal name is required');
    const result = await this.supabase.db.query<GoalRow>(
      'INSERT INTO public.savings_goals (user_id, name, target, due_date) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, dto.name.trim(), dto.target, dto.dueDate ?? null],
    );
    return mapGoal(result.rows[0]);
  }

  async entries(userId: string, goalId: string) {
    const result = await this.supabase.db.query<{
      id: string;
      type: string;
      amount: string | number;
      note: string | null;
      created_at: Date;
    }>(
      `SELECT e.id, e.type, e.amount, e.note, e.created_at
       FROM public.savings_entries e JOIN public.savings_goals g ON g.id = e.goal_id
       WHERE g.id = $1 AND g.user_id = $2 ORDER BY e.created_at DESC LIMIT 100`,
      [goalId, userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      type: row.type,
      amount: Number(row.amount),
      note: row.note,
      createdAt: row.created_at,
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
    const client = await this.supabase.db.connect();
    try {
      await client.query('BEGIN');
      const goal = await client.query<{ balance: string | number }>(
        'SELECT balance FROM public.savings_goals WHERE id = $1 AND user_id = $2 FOR UPDATE',
        [goalId, userId],
      );
      if (!goal.rows[0]) throw new NotFoundException('Savings goal not found');
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
}
