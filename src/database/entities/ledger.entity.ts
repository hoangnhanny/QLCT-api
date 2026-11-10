import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { DateColumnTransformer } from './transformers';
import { Member } from './member.entity';
import { Category } from './category.entity';
import { Expense } from './expense.entity';
import { Budget } from './budget.entity';

@Entity({ name: 'ledgers' })
export class Ledger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  kind: 'family' | 'business';

  @Column({ type: 'text' })
  name: string;

  @Column('uuid', { name: 'admin_id' })
  adminId: string;

  @Column({
    type: 'date',
    transformer: DateColumnTransformer,
  })
  month: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany(() => Member, (member) => member.ledger)
  members: Member[];

  @OneToMany(() => Category, (category) => category.ledger)
  categories: Category[];

  @OneToMany(() => Expense, (expense) => expense.ledger)
  expenses: Expense[];

  @OneToMany(() => Budget, (budget) => budget.ledger)
  budgets: Budget[];
}
