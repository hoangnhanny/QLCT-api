import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BigIntTransformer, DateColumnTransformer } from './transformers';
import { Ledger } from './ledger.entity';
import { Category } from './category.entity';
import { Profile } from './profile.entity';
import { BudgetAlert } from './budget-alert.entity';

@Entity({ name: 'budgets' })
export class Budget {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'ledger_id' })
  ledgerId: string;

  @Column('uuid', { name: 'member_user_id', nullable: true })
  memberUserId: string | null;

  @Column('uuid', { name: 'category_id', nullable: true })
  categoryId: string | null;

  @Column({
    type: 'date',
    transformer: DateColumnTransformer,
  })
  month: string;

  @Column({
    type: 'bigint',
    transformer: BigIntTransformer,
  })
  amount: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Ledger, (ledger) => ledger.budgets, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  @ManyToOne(() => Profile, { nullable: true })
  @JoinColumn({ name: 'member_user_id' })
  memberProfile?: Profile | null;

  @OneToMany(() => BudgetAlert, (alert) => alert.budget)
  alerts: BudgetAlert[];
}
