import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { BigIntTransformer } from './transformers';
import { Ledger } from './ledger.entity';
import { Category } from './category.entity';
import { Profile } from './profile.entity';

@Entity({ name: 'expenses' })
export class Expense {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'ledger_id' })
  ledgerId: string;

  @Column('uuid', { name: 'created_by' })
  createdBy: string;

  @Column({
    type: 'bigint',
    transformer: BigIntTransformer,
  })
  amount: number;

  @Column({ type: 'text' })
  content: string;

  @Column('uuid', { name: 'category_id', nullable: true })
  categoryId: string | null;

  @Column({ name: 'image_path', type: 'text', nullable: true })
  imagePath: string | null;

  @Column({ name: 'spent_at', type: 'timestamptz' })
  spentAt: Date;

  @Column({ type: 'text', default: 'expense' })
  type: 'expense' | 'income';

  @Column({ name: 'payment_method', type: 'text', default: 'cash' })
  paymentMethod: 'cash' | 'transfer';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Ledger, (ledger) => ledger.expenses, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @ManyToOne(() => Category, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  @ManyToOne(() => Profile, { nullable: true })
  @JoinColumn({ name: 'created_by' })
  creatorProfile?: Profile | null;
}
