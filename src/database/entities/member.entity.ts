import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Ledger } from './ledger.entity';
import { Profile } from './profile.entity';

@Entity({ name: 'members' })
@Unique(['ledgerId', 'userId'])
export class Member {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'ledger_id' })
  ledgerId: string;

  @Column('uuid', { name: 'user_id' })
  userId: string;

  @Column({ type: 'text' })
  status: 'active' | 'removed';

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Ledger, (ledger) => ledger.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ledger_id' })
  ledger: Ledger;

  @ManyToOne(() => Profile, { nullable: true })
  @JoinColumn({ name: 'user_id' })
  profile?: Profile;
}
