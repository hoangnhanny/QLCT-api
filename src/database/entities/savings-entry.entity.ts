import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BigIntTransformer } from './transformers';
import { SavingsGoal } from './savings-goal.entity';

@Entity({ name: 'savings_entries' })
export class SavingsEntry {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'goal_id' })
  goalId: string;

  @Column({ type: 'text' })
  type: 'deposit' | 'withdrawal';

  @Column({
    type: 'bigint',
    transformer: BigIntTransformer,
  })
  amount: number;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => SavingsGoal, (goal) => goal.entries, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'goal_id' })
  goal: SavingsGoal;
}
