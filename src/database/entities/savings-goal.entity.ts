import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BigIntTransformer, DateColumnTransformer } from './transformers';
import { SavingsEntry } from './savings-entry.entity';

@Entity({ name: 'savings_goals' })
export class SavingsGoal {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({
    type: 'bigint',
    transformer: BigIntTransformer,
  })
  target: number;

  @Column({
    type: 'bigint',
    default: 0,
    transformer: BigIntTransformer,
  })
  balance: number;

  @Column({
    name: 'due_date',
    type: 'date',
    nullable: true,
    transformer: DateColumnTransformer,
  })
  dueDate: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => SavingsEntry, (entry) => entry.goal)
  entries: SavingsEntry[];
}
