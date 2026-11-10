import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { DateColumnTransformer } from './transformers';
import { Budget } from './budget.entity';

@Entity({ name: 'budget_alerts' })
@Unique(['budgetId', 'threshold', 'month'])
export class BudgetAlert {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'budget_id' })
  budgetId: string;

  @Column({ type: 'int' })
  threshold: number;

  @Column({
    type: 'date',
    transformer: DateColumnTransformer,
  })
  month: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Budget, (budget) => budget.alerts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'budget_id' })
  budget: Budget;
}
